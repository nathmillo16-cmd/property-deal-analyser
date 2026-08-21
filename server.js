require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getComps, ComparablesLookupError } = require('./get-comps');
const { PostcodeLookupError, lookupPostcode, reverseGeocodeMsoa } = require('./postcodes-io');
const { getEmploymentData } = require('./nomis-employment');
const { isAtRisk, isStale } = require('./crm-thresholds');
const { listAllAuthUsers } = require('./admin-users');
const cron = require('node-cron');
const { sendWeeklyDigest } = require('./weekly-digest');

// Service-role client. Originally used ONLY by the Stripe webhook handler
// below, to flip a user's plan when Stripe (not the user) is the caller.
// Now also used by GET /api/admin/users (Tier 1 roster) — that route needs
// email/signup-date/last-login for every user, which lives in Supabase's
// auth.users, not in any RLS-queryable table a normal per-request client
// can reach. Every caller of supabaseAdmin outside the webhook MUST gate
// on requireSuperuser(req, res) first, same as every other CRM route — this
// client bypasses RLS entirely, so that gate is the only thing standing
// between "superuser roster view" and "any logged-in user reads everyone's
// email."
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const app = express();
app.use(cors());

// Must be registered with express.raw(), and BEFORE app.use(express.json())
// below, so Stripe's signature check gets the exact raw bytes it signed.
// The handler responds without calling next(), so express.json() (mounted
// after) never touches this route — every other route is unaffected.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${e.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.mode === 'subscription') {
      const userId = session.client_reference_id || (session.metadata && session.metadata.user_id);
      if (userId) {
        const { error } = await supabaseAdmin.from('profiles').update({ plan: 'paid' }).eq('user_id', userId);
        if (error) console.error('Webhook: failed to set plan=paid for', userId, error.message);

        // Separate, failure-tolerant update — stripe_customer_id/
        // stripe_subscription_id (db/020_profiles_stripe_ids.sql) are
        // newer columns that may not exist yet on a database that hasn't
        // run that migration. Kept as its own call, not folded into the
        // plan update above, specifically so a missing column here can
        // never block the plan flip itself (the same "one bad column
        // fails the whole query" lesson already fixed once in
        // GET /api/profile for the `name` column).
        const { error: stripeIdError } = await supabaseAdmin
          .from('profiles')
          .update({ stripe_customer_id: session.customer || null, stripe_subscription_id: session.subscription || null })
          .eq('user_id', userId);
        if (stripeIdError) console.error('Webhook: failed to store stripe ids for', userId, stripeIdError.message);
      } else {
        console.error('Webhook: checkout.session.completed with no user_id on session', session.id);
      }
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// The bare root now serves the public landing page, not the calculator, so a
// logged-out visitor lands on marketing content with sign-up/login CTAs
// rather than the app itself. Registered before express.static so it takes
// precedence over static's default "index.html answers /" behavior. The
// calculator remains reachable at its own explicit /index.html path.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

app.use(express.static('.'));

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY
  });
});

// Builds a Supabase client scoped to the logged-in user's own token, so
// Row Level Security (not this server) is what enforces "own deals only".
function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

function supabaseForRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(v) {
  const n = toNumberOrNull(v);
  return n === null ? null : Math.round(n);
}

function toStandardFeesOrNull(v) {
  if (!v || typeof v !== 'object') return null;
  const fees = {
    solicitor: toNumberOrNull(v.solicitor),
    mortgage: toNumberOrNull(v.mortgage),
    searches: toNumberOrNull(v.searches)
  };
  if (fees.solicitor === null && fees.mortgage === null && fees.searches === null) return null;
  return fees;
}

const PORTFOLIO_PROPERTY_TYPES = ['BTL', 'HMO', 'SA', 'Flip'];

// Yield excludes mortgage on purpose (it's a return-on-asset figure);
// monthly_cashflow includes it, treating a null/blank mortgage (bought
// cash) as 0. price_paid of 0 returns null rather than Infinity/NaN.
function computePropertyFigures(p) {
  const mortgage = p.monthly_mortgage || 0;
  const annualNet = (p.monthly_rent * 12) - (p.monthly_running_costs * 12);
  return {
    yield: p.price_paid > 0 ? (annualNet / p.price_paid) * 100 : null,
    monthly_cashflow: p.monthly_rent - p.monthly_running_costs - mortgage,
  };
}

// £-weighted blend (sum of net income over sum of price paid), not an
// average of each property's own yield — a £1m property and a £50k
// property shouldn't count equally toward the portfolio figure.
function computePortfolioTotals(properties) {
  const totalCashflow = properties.reduce((sum, p) => sum + computePropertyFigures(p).monthly_cashflow, 0);
  const totalPricePaid = properties.reduce((sum, p) => sum + p.price_paid, 0);
  const totalAnnualNet = properties.reduce((sum, p) => sum + (p.monthly_rent * 12) - (p.monthly_running_costs * 12), 0);
  return {
    total_monthly_cashflow: totalCashflow,
    blended_yield: totalPricePaid > 0 ? (totalAnnualNet / totalPricePaid) * 100 : null,
    total_price_paid: totalPricePaid,
  };
}

function validatePortfolioInput(body) {
  const { address, price_paid, property_type, monthly_rent, monthly_running_costs, monthly_mortgage } = body;

  if (typeof address !== 'string' || !address.trim()) {
    return { error: 'Enter an address.' };
  }
  if (!PORTFOLIO_PROPERTY_TYPES.includes(property_type)) {
    return { error: `property_type must be one of ${PORTFOLIO_PROPERTY_TYPES.join('/')}.` };
  }
  const pricePaid = Number(price_paid);
  const rent = Number(monthly_rent);
  const runningCosts = Number(monthly_running_costs);
  if (!Number.isFinite(pricePaid) || pricePaid < 0) return { error: 'Price paid must be a number ≥ 0.' };
  if (!Number.isFinite(rent) || rent < 0) return { error: 'Monthly rent must be a number ≥ 0.' };
  if (!Number.isFinite(runningCosts) || runningCosts < 0) return { error: 'Monthly running costs must be a number ≥ 0.' };

  let mortgage = null;
  if (monthly_mortgage !== null && monthly_mortgage !== undefined && monthly_mortgage !== '') {
    mortgage = Number(monthly_mortgage);
    if (!Number.isFinite(mortgage) || mortgage < 0) return { error: 'Monthly mortgage must be a number ≥ 0, or blank if bought cash.' };
  }

  return {
    value: {
      address: address.trim(),
      price_paid: pricePaid,
      property_type,
      monthly_rent: rent,
      monthly_running_costs: runningCosts,
      monthly_mortgage: mortgage,
    },
  };
}

// Fail-closed: a missing profile row, or any error looking it up, is always
// treated as 'free'. This is the one place that decision is made.
// Both helpers below resolve the caller's own user_id via
// supabase.auth.getUser() (no explicit jwt arg) before filtering their
// select by it. supabase here is always built by supabaseForRequest(),
// which configures a custom Authorization header rather than a real
// client-side session — auth-js's getUser() specifically supports that via
// its hasCustomAuthorizationHeader check (GoTrueClient.js _getUser()), so
// this resolves correctly without needing to thread req/token through
// every one of getUserPlan's 28+ call sites. Filtering explicitly is
// required, not optional: an unfiltered .select(...).single() against
// profiles relies on RLS to implicitly narrow the result to one row, which
// is only true for a non-superuser. A superuser's "select all profiles"
// policy (db/021, recursion fixed in db/028) legitimately returns every
// row, and .single() against multiple rows fails with PGRST116 ("Cannot
// coerce the result to a single JSON object") — which this file's fail-
// closed try/catch shape was silently swallowing into 'free'/'user',
// locking a superuser out of every paid feature and the CRM itself the
// moment db/028 made "select all" actually work. Same root cause and same
// fix shape as GET /api/profile above.
async function getUserPlan(supabase) {
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData || !userData.user) return 'free';
    const { data, error } = await supabase.from('profiles').select('plan').eq('user_id', userData.user.id).single();
    if (error || !data || data.plan !== 'paid') return 'free';
    return 'paid';
  } catch (e) {
    return 'free';
  }
}

// Same fail-closed shape as getUserPlan above, for the superuser-only CRM
// (db/021_profiles_role.sql). This is defense-in-depth on top of RLS, which
// is the real, unbypassable boundary on every crm_* table — this just turns
// a non-superuser's request into a clean 403 instead of RLS silently
// returning empty rows.
async function getUserRole(supabase) {
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData || !userData.user) return 'user';
    const { data, error } = await supabase.from('profiles').select('role').eq('user_id', userData.user.id).single();
    if (error || !data || data.role !== 'superuser') return 'user';
    return 'superuser';
  } catch (e) {
    return 'user';
  }
}

async function requireSuperuser(req, res) {
  const supabase = supabaseForRequest(req);
  if (!supabase) {
    res.status(401).json({ error: 'Log in to use the CRM.' });
    return null;
  }
  const role = await getUserRole(supabase);
  if (role !== 'superuser') {
    res.status(403).json({ error: 'Superuser only.' });
    return null;
  }
  return supabase;
}

function startOfCurrentMonthISO() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// The stored INPUT fields per strategy (never the computed outputs, and
// never name) — used to detect "this is the same property/figures saved
// again", per deal_type since each strategy stores a different shape.
const DEAL_INPUT_FIELDS = {
  btl: ['pp', 'emv', 'rent', 'mr', 'dp', 'ref', 'sol', 'mf', 'srch', 'ins', 'mgmt', 'maint', 'ty', 'tr'],
  hmo: ['pp', 'emv', 'totalRent', 'mr', 'dp', 'ref', 'sol', 'mf', 'lic', 'srch', 'ins', 'wifi', 'ctMonthly', 'maint', 'mgmt', 'ty', 'troi'],
  sa: ['rate', 'occ', 'pp', 'emv', 'mr', 'dp', 'sol', 'mf', 'srch', 'ref', 'furn', 'wg', 'mgmt', 'util', 'maint', 'clean', 'ins', 'ct', 'ty', 'troi'],
  flip: ['pp', 'bf', 'ref', 'sv', 'agentPct', 'contPct', 'troi']
};

function normalizedField(obj, field) {
  const n = Number(obj && obj[field]) || 0;
  return Math.round(n * 100) / 100;
}

function isDuplicateDeal(newData, existingData, dealType) {
  const fields = DEAL_INPUT_FIELDS[dealType] || [];
  if (!fields.length) return false;
  return fields.every(f => normalizedField(newData, f) === normalizedField(existingData, f));
}

app.post('/api/deals', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to save deals.' });

  const { deal_type, deal_data, comps_snapshot, force } = req.body;
  if (!['btl', 'hmo', 'sa', 'flip'].includes(deal_type)) {
    return res.status(400).json({ error: 'deal_type must be "btl", "hmo", "sa", or "flip".' });
  }
  if (!deal_data || typeof deal_data !== 'object') {
    return res.status(400).json({ error: 'Missing deal_data.' });
  }
  // Optional — a snapshot of the Comps tab captured once at save time
  // (Option A: never updated after). null/absent means no comps were run
  // before saving, which is a normal, valid state, not an error.
  if (comps_snapshot !== undefined && comps_snapshot !== null && typeof comps_snapshot !== 'object') {
    return res.status(400).json({ error: 'comps_snapshot must be an object or null.' });
  }
  const compsSnapshotToStore = comps_snapshot == null ? null : comps_snapshot;

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    const { count, error: countError } = await supabase
      .from('deals')
      .select('id', { count: 'exact', head: true });
    if (countError) return res.status(400).json({ error: countError.message });
    if (count >= 2) {
      return res.status(403).json({ error: 'Free plan limit reached. Upgrade to save more deals.' });
    }
  }

  if (!force) {
    const { data: existing, error: existingErr } = await supabase
      .from('deals')
      .select('deal_data')
      .eq('deal_type', deal_type);
    if (!existingErr && existing && existing.some(row => isDuplicateDeal(deal_data, row.deal_data, deal_type))) {
      return res.status(409).json({ duplicate: true, error: 'You already have a saved deal with these figures.' });
    }
  }

  const { data, error } = await supabase
    .from('deals')
    .insert({ deal_type, deal_data, comps_snapshot: compsSnapshotToStore })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/deals', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to see saved deals.' });

  const { data, error } = await supabase
    .from('deals')
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date, comps_snapshot')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

const NEEDS_ATTENTION_CHASE_DAYS = 3;
const NEEDS_ATTENTION_REVIEW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// viewing_date is a plain date column (no time) — parsed as a UTC midnight
// timestamp so "has it passed" / "days ago" math is exact and independent
// of the server's own local timezone, the same way created_at/updated_at
// (timestamptz, always UTC) already are.
function parseDateOnlyUTCms(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// GET /api/needs-attention — three criteria, thresholds live only here:
//   (i)   "chase"  — a Pending offer whose created_at is >3 days old.
//   (ii)  "update" — a Viewing-stage deal whose viewing_date has passed
//                    with no note logged on or after that date.
//   (iii) "review" — an Analysing-stage deal whose updated_at is >7 days old.
// Three queries total (deals, pending offers, notes), not one per deal —
// grouped/joined in JS below rather than looping fetches per deal.
// Deduped to ONE reason per deal, in priority order chase > update >
// review, rather than returning multiple rows for the same deal.
app.get('/api/needs-attention', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to see what needs attention.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });
  }

  const [dealsRes, offersRes, notesRes] = await Promise.all([
    supabase.from('deals').select('id, deal_data, pipeline_stage, updated_at, viewing_date'),
    supabase.from('deal_offers').select('id, deal_id, created_at').eq('outcome', 'Pending'),
    supabase.from('deal_notes').select('deal_id, created_at'),
  ]);

  if (dealsRes.error) return res.status(400).json({ error: dealsRes.error.message });
  if (offersRes.error) return res.status(400).json({ error: offersRes.error.message });
  if (notesRes.error) return res.status(400).json({ error: notesRes.error.message });

  const deals = dealsRes.data || [];
  const pendingOffers = offersRes.data || [];
  const notes = notesRes.data || [];

  const dealsById = new Map(deals.map((d) => [d.id, d]));
  const dealName = (d) => (d.deal_data && d.deal_data.name) || null;

  // Latest note timestamp per deal_id.
  const latestNoteMsByDeal = new Map();
  for (const n of notes) {
    const ms = new Date(n.created_at).getTime();
    const existing = latestNoteMsByDeal.get(n.deal_id);
    if (existing === undefined || ms > existing) latestNoteMsByDeal.set(n.deal_id, ms);
  }

  const nowMs = Date.now();
  const todayUTCms = parseDateOnlyUTCms(new Date().toISOString().slice(0, 10));

  const results = [];
  const flaggedDealIds = new Set();

  // (i) chase — oldest qualifying Pending offer per deal.
  const oldestPendingByDeal = new Map();
  for (const o of pendingOffers) {
    const ageMs = nowMs - new Date(o.created_at).getTime();
    if (ageMs <= NEEDS_ATTENTION_CHASE_DAYS * MS_PER_DAY) continue;
    const existing = oldestPendingByDeal.get(o.deal_id);
    if (!existing || ageMs > existing.ageMs) oldestPendingByDeal.set(o.deal_id, { offerId: o.id, ageMs });
  }
  for (const [dealId, info] of oldestPendingByDeal) {
    const deal = dealsById.get(dealId);
    if (!deal) continue; // offer's deal was deleted or isn't this user's (RLS already scopes both, just a defensive guard)
    const days = Math.floor(info.ageMs / MS_PER_DAY);
    results.push({
      deal_id: dealId,
      deal_name: dealName(deal),
      reason: 'chase',
      detail: `Offer pending ${days} day${days === 1 ? '' : 's'}`,
    });
    flaggedDealIds.add(dealId);
  }

  // (ii) update — Viewing stage, viewing_date passed, no note since.
  for (const deal of deals) {
    if (flaggedDealIds.has(deal.id)) continue;
    if (deal.pipeline_stage !== 'viewing' || !deal.viewing_date) continue;
    const viewingMs = parseDateOnlyUTCms(deal.viewing_date);
    if (viewingMs >= todayUTCms) continue; // hasn't passed yet
    const latestNoteMs = latestNoteMsByDeal.get(deal.id);
    const noteSinceViewing = latestNoteMs !== undefined && latestNoteMs >= viewingMs;
    if (noteSinceViewing) continue;
    const days = Math.floor((todayUTCms - viewingMs) / MS_PER_DAY);
    results.push({
      deal_id: deal.id,
      deal_name: dealName(deal),
      reason: 'update',
      detail: `Viewing was ${days} day${days === 1 ? '' : 's'} ago`,
    });
    flaggedDealIds.add(deal.id);
  }

  // (iii) review — Analysing stage, untouched >7 days.
  for (const deal of deals) {
    if (flaggedDealIds.has(deal.id)) continue;
    if (deal.pipeline_stage !== 'analysing') continue;
    const ageMs = nowMs - new Date(deal.updated_at).getTime();
    if (ageMs <= NEEDS_ATTENTION_REVIEW_DAYS * MS_PER_DAY) continue;
    const days = Math.floor(ageMs / MS_PER_DAY);
    results.push({
      deal_id: deal.id,
      deal_name: dealName(deal),
      reason: 'review',
      detail: `Untouched ${days} day${days === 1 ? '' : 's'}`,
    });
    flaggedDealIds.add(deal.id);
  }

  res.json(results);
});

app.post('/api/deals/:id/name', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to rename deals.' });

  const { name } = req.body;
  if (typeof name !== 'string') {
    return res.status(400).json({ error: 'Missing name.' });
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('deals')
    .select('deal_data')
    .eq('id', req.params.id)
    .single();
  if (fetchErr || !existing) return res.status(404).json({ error: 'Deal not found.' });

  const updatedData = { ...existing.deal_data, name };

  const { data, error } = await supabase
    .from('deals')
    .update({ deal_data: updatedData })
    .eq('id', req.params.id)
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date, comps_snapshot')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Deal not found.' });
  res.json(data);
});

app.post('/api/deals/:id/viewing-date', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to update deals.' });

  // Blank/null clears it (per the agreed decision); a non-empty value must
  // be a plain YYYY-MM-DD date string — viewing_date is a date column, no
  // time component.
  let { viewing_date } = req.body;
  if (viewing_date === undefined || viewing_date === '') viewing_date = null;
  if (viewing_date !== null) {
    if (typeof viewing_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(viewing_date)) {
      return res.status(400).json({ error: 'viewing_date must be a YYYY-MM-DD string, or blank to clear.' });
    }
  }

  // Same ownership pattern as the rename/stage-change endpoints above: RLS
  // scopes the update to the requester's own rows, and a null result (no
  // row matched, whether nonexistent or someone else's) reports as 404
  // rather than silently succeeding.
  const { data, error } = await supabase
    .from('deals')
    .update({ viewing_date })
    .eq('id', req.params.id)
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date, comps_snapshot')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Deal not found.' });
  res.json(data);
});

app.post('/api/deals/:id/delete', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to delete deals.' });

  const { error } = await supabase
    .from('deals')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
});

const PIPELINE_STAGES = ['analysing', 'viewing', 'offered', 'agreed', 'completed'];

app.post('/api/pipeline', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });
  }

  const { deal_id } = req.body;
  if (!deal_id) return res.status(400).json({ error: 'Missing deal_id.' });

  const { data, error } = await supabase
    .from('deals')
    .update({ pipeline_stage: 'analysing' })
    .eq('id', deal_id)
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date, comps_snapshot')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Deal not found.' });
  res.json(data);
});

app.get('/api/pipeline', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });
  }

  const { data, error } = await supabase
    .from('deals')
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date, comps_snapshot')
    .not('pipeline_stage', 'is', null)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/pipeline/:id/stage', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });
  }

  const { stage } = req.body;
  if (stage !== null && !PIPELINE_STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of ${PIPELINE_STAGES.join(', ')}, or null to remove from pipeline.` });
  }

  const { data, error } = await supabase
    .from('deals')
    .update({ pipeline_stage: stage })
    .eq('id', req.params.id)
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date, comps_snapshot')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Deal not found.' });
  res.json(data);
});

// Cheap ownership check before attaching a note/offer to a deal_id — RLS on
// deal_notes/deal_offers alone would still let someone attach a row to an
// arbitrary deal_id that isn't theirs (it just wouldn't leak anything, since
// their own select policy only ever returns their own rows), but this is a
// correct, nearly-free guard rather than relying on that being harmless.
async function dealBelongsToRequester(supabase, dealId) {
  const { data, error } = await supabase.from('deals').select('id').eq('id', dealId).single();
  return !error && !!data;
}

function validateNoteInput(body) {
  const { note_text } = body;
  if (typeof note_text !== 'string' || !note_text.trim()) {
    return { error: 'Enter a note.' };
  }
  return { value: { note_text: note_text.trim() } };
}

const OFFER_OUTCOMES = ['Pending', 'Rejected', 'Accepted', 'Withdrawn'];

function validateOfferInput(body) {
  const { amount, offer_date, outcome } = body;
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) return { error: 'Amount must be a number ≥ 0.' };
  if (typeof offer_date !== 'string' || !offer_date.trim()) return { error: 'Enter an offer date.' };
  const resolvedOutcome = outcome || 'Pending';
  if (!OFFER_OUTCOMES.includes(resolvedOutcome)) {
    return { error: `outcome must be one of ${OFFER_OUTCOMES.join('/')}.` };
  }
  return { value: { amount: amt, offer_date, outcome: resolvedOutcome } };
}

app.post('/api/deals/:dealId/notes', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });

  if (!(await dealBelongsToRequester(supabase, req.params.dealId))) {
    return res.status(404).json({ error: 'Deal not found.' });
  }

  const { value, error: validationError } = validateNoteInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase
    .from('deal_notes')
    .insert({ deal_id: req.params.dealId, note_text: value.note_text })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/deals/:dealId/notes', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });

  const { data, error } = await supabase
    .from('deal_notes')
    .select('*')
    .eq('deal_id', req.params.dealId)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/notes/:id', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });

  const { error } = await supabase
    .from('deal_notes')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
});

app.post('/api/deals/:dealId/offers', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });

  if (!(await dealBelongsToRequester(supabase, req.params.dealId))) {
    return res.status(404).json({ error: 'Deal not found.' });
  }

  const { value, error: validationError } = validateOfferInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase
    .from('deal_offers')
    .insert({ deal_id: req.params.dealId, ...value })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/deals/:dealId/offers', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });

  const { data, error } = await supabase
    .from('deal_offers')
    .select('*')
    .eq('deal_id', req.params.dealId)
    .order('offer_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.put('/api/offers/:id', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });

  const { outcome } = req.body;
  if (!OFFER_OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of ${OFFER_OUTCOMES.join('/')}.` });
  }

  const { data, error } = await supabase
    .from('deal_offers')
    .update({ outcome })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Offer not found.' });
  res.json(data);
});

app.delete('/api/offers/:id', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the pipeline.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock the pipeline.' });

  const { error } = await supabase
    .from('deal_offers')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
});

app.post('/api/portfolio', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the portfolio.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the portfolio.' });
  }

  const { value, error: validationError } = validatePortfolioInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase
    .from('portfolio_properties')
    .insert(value)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ ...data, ...computePropertyFigures(data) });
});

app.get('/api/portfolio', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the portfolio.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the portfolio.' });
  }

  const { data, error } = await supabase
    .from('portfolio_properties')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  const properties = data.map((p) => ({ ...p, ...computePropertyFigures(p) }));
  res.json({ properties, totals: computePortfolioTotals(data) });
});

app.delete('/api/portfolio/:id', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the portfolio.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the portfolio.' });
  }

  const { error } = await supabase
    .from('portfolio_properties')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
});

app.put('/api/portfolio/:id', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the portfolio.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the portfolio.' });
  }

  const { value, error: validationError } = validatePortfolioInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase
    .from('portfolio_properties')
    .update(value)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Property not found.' });
  res.json({ ...data, ...computePropertyFigures(data) });
});

const REFURB_MODES = ['detailed', 'quick'];
const REFURB_VAT_RATES = [0, 5, 20];
const REFURB_NAME_MAX_LENGTH = 120;
const REFURB_LINE_ITEMS_MAX_KEYS = 300;
const REFURB_LINE_ITEMS_MAX_JSON_LENGTH = 20000;

// line_items is opaque, per-mode-shaped jsonb the estimator never computes
// against server-side (unlike portfolio's figures) — validated structurally
// (object, bounded key count, bounded serialized size) rather than
// field-by-field, same lighter touch already applied to deals.deal_data.
function validateRefurbEstimateInput(body) {
  const { name, mode, line_items, contingency_enabled, contingency_pct, vat_rate } = body;

  if (typeof name !== 'string' || !name.trim()) {
    return { error: 'Enter a name for this estimate.' };
  }
  if (name.trim().length > REFURB_NAME_MAX_LENGTH) {
    return { error: `Name must be ${REFURB_NAME_MAX_LENGTH} characters or fewer.` };
  }
  if (!REFURB_MODES.includes(mode)) {
    return { error: `mode must be one of ${REFURB_MODES.join('/')}.` };
  }
  if (line_items === null || typeof line_items !== 'object' || Array.isArray(line_items)) {
    return { error: 'line_items must be an object.' };
  }
  if (Object.keys(line_items).length > REFURB_LINE_ITEMS_MAX_KEYS) {
    return { error: 'Too many line items.' };
  }
  if (JSON.stringify(line_items).length > REFURB_LINE_ITEMS_MAX_JSON_LENGTH) {
    return { error: 'Estimate data is too large.' };
  }
  if (typeof contingency_enabled !== 'boolean') {
    return { error: 'contingency_enabled must be true or false.' };
  }
  const contingencyPct = Number(contingency_pct);
  if (!Number.isFinite(contingencyPct) || contingencyPct < 0) {
    return { error: 'Contingency % must be a number ≥ 0.' };
  }
  const vatRate = Number(vat_rate);
  if (!REFURB_VAT_RATES.includes(vatRate)) {
    return { error: `vat_rate must be one of ${REFURB_VAT_RATES.join('/')}.` };
  }

  return {
    value: {
      name: name.trim(),
      mode,
      line_items,
      contingency_enabled,
      contingency_pct: contingencyPct,
      vat_rate: vatRate,
    },
  };
}

app.post('/api/refurb-estimates', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the refurb estimator.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the refurb estimator.' });
  }

  const { value, error: validationError } = validateRefurbEstimateInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase
    .from('refurb_estimates')
    .insert(value)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/refurb-estimates', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the refurb estimator.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the refurb estimator.' });
  }

  const { data, error } = await supabase
    .from('refurb_estimates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ estimates: data });
});

app.put('/api/refurb-estimates/:id', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the refurb estimator.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the refurb estimator.' });
  }

  const { value, error: validationError } = validateRefurbEstimateInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase
    .from('refurb_estimates')
    .update(value)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Estimate not found.' });
  res.json(data);
});

app.delete('/api/refurb-estimates/:id', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the refurb estimator.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the refurb estimator.' });
  }

  const { error } = await supabase
    .from('refurb_estimates')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
});

const COMPS_PROPERTY_TYPES = ['D', 'S', 'T', 'F', 'O'];

// Accepts any postcode format (no space, extra spaces, lower case) and
// converts to the canonical uppercase/single-space format postcodes.io
// expects. The inward code (after the space) is always 3 characters in
// UK postcodes, so the space goes there if it's missing.
function normalisePostcodeInput(raw) {
  const stripped = raw.replace(/\s+/g, '').toUpperCase();
  if (stripped.length <= 3) return stripped;
  return `${stripped.slice(0, -3)} ${stripped.slice(-3)}`;
}

app.post('/api/comps', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use Comparables.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock Comparables.' });

  const { postcode, propertyType } = req.body;
  if (typeof postcode !== 'string' || !postcode.trim()) {
    return res.status(400).json({ error: 'Enter a postcode.' });
  }
  if (!COMPS_PROPERTY_TYPES.includes(propertyType)) {
    return res.status(400).json({ error: 'propertyType must be one of D/S/T/F/O.' });
  }

  try {
    const result = await getComps(supabase, normalisePostcodeInput(postcode), propertyType);
    res.json(result);
  } catch (e) {
    if (e instanceof ComparablesLookupError || e instanceof PostcodeLookupError) {
      const clientCodes = ['invalid_property_type', 'invalid_postcode', 'postcode_not_found', 'postcode_no_coordinates', 'invalid_radius'];
      return res.status(clientCodes.includes(e.code) ? 400 : 502).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

// Crime rate: resolves the subject postcode's MSOA via the same
// postcodes.io lookup comps uses, then reads the precomputed benchmark
// (msoa_crime_rate / crime_benchmark_meta — see db/013/014/015 and
// scripts/compute-crime-benchmark.js). percentile is the primary signal
// (national percentile rank by rate_per_1000 — a band alone is too coarse,
// it labels a moderately-high and a very-high area both "High"); band is
// kept as a secondary descriptor. Read-only against both tables, nothing
// is written here. A postcode postcodes.io can't resolve at all is a real
// error (400/502), same as comps; a TERMINATED postcode (real, retired —
// has coordinates but no MSOA of its own) falls back to reverseGeocodeMsoa
// (postcodes-io.js); an MSOA that simply isn't in the benchmark, or that
// the fallback couldn't resolve either, is a clean { available: false },
// not an error.
//
// Crime Stage 4: also reads msoa_crime_breakdown (db/016) for the same
// resolvedMsoaCode, alongside the meta read (independent queries, run in
// parallel). breakdown is null if there's no row, or its total is 0 — a
// percentage-of-zero breakdown is meaningless, not worth sending as six
// 0% rows.
app.get('/api/crime', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to see crime data.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock crime data.' });

  const { postcode } = req.query;
  if (typeof postcode !== 'string' || !postcode.trim()) {
    return res.status(400).json({ error: 'Enter a postcode.' });
  }

  try {
    const { lat, lng, msoaCode, terminated } = await lookupPostcode(normalisePostcodeInput(postcode));
    // A terminated postcode has coordinates but no MSOA of its own (see
    // postcodes-io.js) — fall back to the MSOA of the nearest live
    // postcode rather than failing outright. If that also finds nothing,
    // this degrades to the same clean { available: false } used below for
    // "valid MSOA just isn't in the benchmark", not an error.
    let resolvedMsoaCode = msoaCode;
    if (!resolvedMsoaCode && terminated) {
      resolvedMsoaCode = await reverseGeocodeMsoa(lat, lng);
    }
    if (!resolvedMsoaCode) return res.json({ available: false });

    const { data, error } = await supabase
      .from('msoa_crime_rate')
      .select('rate_per_1000, band, percentile')
      .eq('msoa_code', resolvedMsoaCode)
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.json({ available: false });

    const [{ data: meta }, { data: breakdownRow }] = await Promise.all([
      supabase.from('crime_benchmark_meta').select('data_month').eq('id', 1).maybeSingle(),
      supabase
        .from('msoa_crime_breakdown')
        .select('violence, asb, shoplifting, burglary, vehicle, other, total')
        .eq('msoa_code', resolvedMsoaCode)
        .maybeSingle(),
    ]);

    const CRIME_GROUP_LABELS = {
      violence: 'Violence & sexual offences',
      asb: 'Anti-social behaviour',
      shoplifting: 'Shoplifting',
      burglary: 'Burglary',
      vehicle: 'Vehicle crime',
      other: 'Other',
    };
    const breakdown = (breakdownRow && breakdownRow.total > 0)
      ? Object.keys(CRIME_GROUP_LABELS)
          .map((key) => ({ key, label: CRIME_GROUP_LABELS[key], count: breakdownRow[key], pct: (breakdownRow[key] / breakdownRow.total) * 100 }))
          .sort((a, b) => b.pct - a.pct)
      : null;

    res.json({ available: true, rate_per_1000: data.rate_per_1000, band: data.band, percentile: data.percentile, data_month: meta ? meta.data_month : null, breakdown });
  } catch (e) {
    if (e instanceof PostcodeLookupError) {
      const clientCodes = ['invalid_postcode', 'postcode_not_found'];
      return res.status(clientCodes.includes(e.code) ? 400 : 502).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

// Planning constraints: live point-in-polygon lookup against
// planning.data.gov.uk (free, Open Government Licence, no key) for the
// subject postcode's coordinates. No storage — resolved fresh per request,
// same live-lookup pattern as comps/crime, via the same lookupPostcode()
// (postcodes-io.js). Only needs lat/lng, not an MSOA, so (unlike crime)
// there's no reverseGeocodeMsoa fallback needed for a terminated postcode —
// its last-known coordinates from lookupPostcode() are enough on their own.
//
// One call covers all six dataset types (article-4-direction-area,
// conservation-area, listed-building, flood-risk-zone, green-belt,
// tree-preservation-zone) — confirmed live against the real API before
// building this, response shape is `{ entities: [...], count }`, each
// entity carrying `dataset`/`name`/`reference` among other fields. Grouped
// here into the 6 known buckets; active constraints sorted first so the
// client doesn't have to.
//
// planning.data.gov.uk being slow/unreachable/rate-limited (429) all
// degrade to the same clean { available: false } — this panel must never
// break or block the comps results it sits under. An 8s timeout via
// AbortController guards against it hanging the request indefinitely.
const PLANNING_DATASETS = {
  article4: 'article-4-direction-area',
  conservationArea: 'conservation-area',
  listedBuilding: 'listed-building',
  floodRiskZone: 'flood-risk-zone',
  greenBelt: 'green-belt',
  treePreservationZone: 'tree-preservation-zone',
};
const PLANNING_LABELS = {
  article4: 'Article 4 direction',
  conservationArea: 'Conservation area',
  listedBuilding: 'Listed building',
  floodRiskZone: 'Flood risk zone',
  greenBelt: 'Green belt',
  treePreservationZone: 'Tree preservation zone',
};

app.get('/api/planning-constraints', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to see planning constraints.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock planning constraints.' });

  const { postcode } = req.query;
  if (typeof postcode !== 'string' || !postcode.trim()) {
    return res.status(400).json({ error: 'Enter a postcode.' });
  }

  try {
    const { lat, lng, adminDistrict } = await lookupPostcode(normalisePostcodeInput(postcode));

    const params = new URLSearchParams({ latitude: lat, longitude: lng, limit: '100' });
    Object.values(PLANNING_DATASETS).forEach((slug) => params.append('dataset', slug));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let planningRes;
    try {
      planningRes = await fetch(`https://www.planning.data.gov.uk/entity.json?${params}`, { signal: controller.signal });
    } catch (fetchErr) {
      return res.json({ available: false });
    } finally {
      clearTimeout(timeout);
    }
    if (!planningRes.ok) {
      return res.json({ available: false });
    }

    const body = await planningRes.json();
    const entities = Array.isArray(body.entities) ? body.entities : [];

    const constraints = Object.keys(PLANNING_DATASETS).map((key) => {
      const matches = entities.filter((e) => e.dataset === PLANNING_DATASETS[key]);
      return {
        key,
        label: PLANNING_LABELS[key],
        active: matches.length > 0,
        entries: matches.map((e) => ({ name: e.name || null, reference: e.reference || null })),
      };
    });
    // Active constraints first — a sourcer should see what applies before
    // scanning past the "none found" rows.
    constraints.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));

    res.json({ available: true, constraints, councilName: adminDistrict });
  } catch (e) {
    if (e instanceof PostcodeLookupError) {
      const clientCodes = ['invalid_postcode', 'postcode_not_found'];
      return res.status(clientCodes.includes(e.code) ? 400 : 502).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/employment', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to see employment data.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') return res.status(403).json({ error: 'Upgrade to unlock employment data.' });

  const { postcode } = req.query;
  if (typeof postcode !== 'string' || !postcode.trim()) {
    return res.status(400).json({ error: 'Enter a postcode.' });
  }

  try {
    const { adminDistrict, adminDistrictCode } = await lookupPostcode(normalisePostcodeInput(postcode));
    if (!adminDistrictCode) {
      // A terminated postcode has no admin district of its own (see
      // postcodes-io.js) — nothing to query Nomis with. A clean
      // "unavailable" degrade, not an error.
      return res.json({ available: false });
    }

    let data;
    try {
      data = await getEmploymentData(adminDistrictCode);
    } catch (nomisErr) {
      // Nomis unreachable/erroring — degrade cleanly, never break Comps.
      return res.json({ available: false });
    }

    if (!data.available) return res.json({ available: false });
    res.json({ ...data, councilName: adminDistrict });
  } catch (e) {
    if (e instanceof PostcodeLookupError) {
      const clientCodes = ['invalid_postcode', 'postcode_not_found'];
      return res.status(clientCodes.includes(e.code) ? 400 : 502).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/profile', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to load your defaults.' });

  // Every query below now explicitly filters to the caller's own row via
  // .eq('user_id', userId). Previously these relied on RLS to implicitly
  // narrow each unfiltered .single() query to exactly one row — true for
  // every normal user, but false for a superuser, whose "select all
  // profiles" policy (db/021, fixed for recursion in db/028) legitimately
  // returns every row. An unfiltered .single() against multiple rows
  // fails with PGRST116 ("Cannot coerce the result to a single JSON
  // object"), which was silently swallowed into the generic free/user
  // fallback below — a superuser's own plan/role effectively stopped
  // loading the moment db/028 made their "select all" policy actually
  // work. Filtering explicitly makes every query correct regardless of
  // how many rows RLS otherwise allows the caller to see.
  const token = getBearerToken(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.json({ target_yield: null, target_roi: null, default_mortgage_rate: null, standard_fees: null, plan: 'free', name: null, role: 'user', default_deposit_pct: null, default_mortgage_term_years: null, default_mortgage_type: null, default_insurance: null, default_management_pct: null, default_maintenance_pct: null, default_refurb_contingency_pct: null });
  }
  const userId = userData.user.id;

  const { data, error } = await supabase
    .from('profiles')
    .select('target_yield, target_roi, default_mortgage_rate, standard_fees, plan')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return res.json({ target_yield: null, target_roi: null, default_mortgage_rate: null, standard_fees: null, plan: 'free', name: null, role: 'user', default_deposit_pct: null, default_mortgage_term_years: null, default_mortgage_type: null, default_insurance: null, default_management_pct: null, default_maintenance_pct: null, default_refurb_contingency_pct: null });
  }

  // name is selected separately and tolerated failing on its own — it's a
  // newer column (db/019_profiles_name.sql) that may not exist yet on a
  // database that hasn't run that migration. Folding it into the select
  // above once failed the WHOLE query (a single unknown column errors the
  // entire select, not just that field), which silently reported plan as
  // 'free' for every user regardless of their real plan. This decouples
  // it permanently, not just for today.
  let name = null;
  try {
    const { data: nameRow, error: nameError } = await supabase.from('profiles').select('name').eq('user_id', userId).single();
    if (!nameError && nameRow) name = nameRow.name;
  } catch (e) {}

  // role: same decoupled-query treatment as name, same reason — a newer
  // column (db/021_profiles_role.sql) that may not exist yet everywhere.
  // Fails closed to 'user', same as getUserRole() below.
  let role = 'user';
  try {
    const { data: roleRow, error: roleError } = await supabase.from('profiles').select('role').eq('user_id', userId).single();
    if (!roleError && roleRow && roleRow.role === 'superuser') role = 'superuser';
  } catch (e) {}

  // Investment Defaults (settings.html) — same decoupled-query treatment,
  // same reason: newer columns (db/030_profiles_investment_defaults.sql)
  // that may not exist yet on a database that hasn't run that migration.
  // Every field defaults to null on failure, matching what a genuinely
  // unset value already looks like — so a missing migration degrades to
  // "no investment defaults saved" rather than an error.
  let investmentDefaults = {
    default_deposit_pct: null,
    default_mortgage_term_years: null,
    default_mortgage_type: null,
    default_insurance: null,
    default_management_pct: null,
    default_maintenance_pct: null,
    default_refurb_contingency_pct: null
  };
  try {
    const { data: defaultsRow, error: defaultsError } = await supabase
      .from('profiles')
      .select('default_deposit_pct, default_mortgage_term_years, default_mortgage_type, default_insurance, default_management_pct, default_maintenance_pct, default_refurb_contingency_pct')
      .eq('user_id', userId)
      .single();
    if (!defaultsError && defaultsRow) investmentDefaults = defaultsRow;
  } catch (e) {}

  res.json({ ...data, plan: data.plan === 'paid' ? 'paid' : 'free', name, role, ...investmentDefaults });
});

// Separate from POST /api/profile above on purpose: that endpoint always
// upserts the full calculator-defaults payload (target_yield/target_roi/
// default_mortgage_rate/standard_fees), so reusing it for a name-only save
// from Settings would silently null out a user's saved defaults. This does
// a targeted update of just `name`, nothing else on the row.
app.post('/api/profile/name', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to update your name.' });

  const token = getBearerToken(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Log in to update your name.' });
  }

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Enter a name.' });

  const { data, error } = await supabase
    .from('profiles')
    .update({ name })
    .eq('user_id', userData.user.id)
    .select('name')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

const MORTGAGE_TYPE_VALUES = ['cash', 'interest_only', 'repayment'];

// Investment Defaults (settings.html's new section, replacing the old
// "Preferences — coming soon" stub). A targeted update, same shape and
// reasoning as POST /api/profile/name above: reusing POST /api/profile
// (the existing full calculator-defaults upsert used by index.html's
// three per-tab "Save as my defaults" buttons) here would have meant this
// page also had to carry standard_fees.mortgage/standard_fees.searches
// through every save — fields this form never shows — or risk silently
// nulling them out on every save from Settings.
//
// standard_fees is jsonb shared with those same three index.html buttons,
// which write mortgage/searches sub-fields this form doesn't show at
// all — solicitor costs are merged into the EXISTING standard_fees object
// here, not written as a bare {solicitor: X}, so a save from this page can
// never wipe out a mortgage/searches value set from index.html. Same
// {...existing, field} merge reasoning as the deal-rename endpoint uses
// for deal_data.
app.post('/api/profile/investment-defaults', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to update your investment defaults.' });

  const token = getBearerToken(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Log in to update your investment defaults.' });
  }
  const userId = userData.user.id;
  const body = req.body || {};

  const mortgageType = toTrimmedOrNull(body.default_mortgage_type);
  if (mortgageType !== null && !MORTGAGE_TYPE_VALUES.includes(mortgageType)) {
    return res.status(400).json({ error: `default_mortgage_type must be one of ${MORTGAGE_TYPE_VALUES.join('/')}, or blank.` });
  }

  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('standard_fees')
    .eq('user_id', userId)
    .single();
  if (existingError) return res.status(400).json({ error: existingError.message });

  const mergedStandardFees = {
    ...(existing && existing.standard_fees ? existing.standard_fees : {}),
    solicitor: toNumberOrNull(body.solicitor_costs)
  };

  const payload = {
    target_yield: toNumberOrNull(body.target_yield),
    target_roi: toNumberOrNull(body.target_roi),
    default_mortgage_rate: toNumberOrNull(body.default_mortgage_rate),
    standard_fees: mergedStandardFees,
    default_deposit_pct: toNumberOrNull(body.default_deposit_pct),
    default_mortgage_term_years: toIntOrNull(body.default_mortgage_term_years),
    default_mortgage_type: mortgageType,
    default_insurance: toNumberOrNull(body.default_insurance),
    default_management_pct: toNumberOrNull(body.default_management_pct),
    default_maintenance_pct: toNumberOrNull(body.default_maintenance_pct),
    default_refurb_contingency_pct: toNumberOrNull(body.default_refurb_contingency_pct)
  };

  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Reads stripe_subscription_id in isolation, tolerant of the column not
// existing yet (db/020_profiles_stripe_ids.sql may not be applied). Two
// distinct outcomes on failure: a genuinely missing column means "nothing
// has ever recorded a subscription id for anyone" (verified true of this
// app today) — safe to treat as no subscription. Any OTHER read failure
// is ambiguous and must NOT be treated as "no subscription", since that
// could delete an account that's actually still being billed — the one
// failure mode this whole feature exists to prevent.
//
// Takes an explicit userId rather than resolving "the caller's own" via
// auth.getUser() (which is what this did originally, when its only caller
// was the account-deletion route below, always looking up itself). Now
// also called by GET /api/admin/users (Tier 1 roster) to look up each
// listed user's subscription id in turn, not just the caller's — the
// account-deletion call site already had its own userId resolved one line
// above where this was called, so passing it explicitly there was a
// zero-behaviour-change edit, not a new lookup path.
async function getStripeSubscriptionId(supabase, userId) {
  try {
    const { data, error } = await supabase.from('profiles').select('stripe_subscription_id').eq('user_id', userId).single();
    if (error) {
      if (error.message && error.message.toLowerCase().includes('does not exist')) {
        return { subscriptionId: null, ambiguous: false };
      }
      return { subscriptionId: null, ambiguous: true };
    }
    return { subscriptionId: data ? data.stripe_subscription_id : null, ambiguous: false };
  } catch (e) {
    return { subscriptionId: null, ambiguous: true };
  }
}

// In-memory cache for live Stripe subscription lookups, keyed by
// subscription id. A few minutes' TTL — with a handful of users today the
// actual savings are close to nothing, but this is the pattern that needs
// to already be in place before admin/index.html would otherwise be
// hitting Stripe's API fresh for every user on every single page load.
// Deliberately a plain in-process Map, not Redis or similar — proportionate
// to today's scale (a single server instance), and cheap to swap out later
// if this app ever runs on more than one instance at once. Failed lookups
// (a bad/deleted subscription id) are cached too, briefly, for the same
// reason — a permanently-broken id shouldn't get retried against Stripe on
// every load either.
const STRIPE_SUB_CACHE_TTL_MS = 5 * 60 * 1000;
const stripeSubCache = new Map();

async function getStripeSubscriptionInfo(subscriptionId) {
  const cached = stripeSubCache.get(subscriptionId);
  if (cached && Date.now() - cached.fetchedAt < STRIPE_SUB_CACHE_TTL_MS) {
    return cached.info;
  }

  let info;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const item = sub.items && sub.items.data && sub.items.data[0];
    const price = item && item.price;
    info = {
      status: sub.status,
      amount: price && typeof price.unit_amount === 'number' ? price.unit_amount / 100 : null,
      currency: price ? price.currency : null,
      interval: price && price.recurring ? price.recurring.interval : null
    };
  } catch (e) {
    info = { status: 'error', amount: null, currency: null, interval: null, error: e.message };
  }

  stripeSubCache.set(subscriptionId, { info, fetchedAt: Date.now() });
  return info;
}

// Destructive, irreversible — deletes the requesting user's own account
// only (userId always comes from the authed session below, never the
// request body). Order matters and is deliberate:
//   1. Stripe FIRST. If there's a real subscription and cancelling it
//      fails (or we can't even tell whether one exists), ABORT before
//      touching any data — never delete an account that might still be
//      billed.
//   2. DB rows next, via the request-scoped (RLS-enforced) client, not
//      the service-role one — Postgres itself enforces "own rows only"
//      here, not just this query's own .eq(user_id). deal_notes/
//      deal_offers cascade automatically once their deals row is deleted
//      (deal_id references deals(id) on delete cascade — db/007, db/008);
//      comps_snapshot is a jsonb column on deals, not a separate table,
//      so it goes with the row. If a step here fails, Stripe is ALREADY
//      cancelled (no billing risk), so this logs clearly for manual
//      cleanup rather than proceeding to step 3 — leaving the auth user
//      in place means the account can still be logged into and the
//      deletion retried, rather than stranding orphaned data with no way
//      back in.
//   3. auth.users LAST, via the service-role admin client (the only one
//      with .auth.admin access) — deliberately last, for the same reason:
//      if this one step fails after 1 and 2 already succeeded, there's no
//      data left to orphan, just a login shell to clean up manually.
app.post('/api/account/delete', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to delete your account.' });

  const token = getBearerToken(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Log in to delete your account.' });
  }
  const userId = userData.user.id;

  const { subscriptionId, ambiguous } = await getStripeSubscriptionId(supabase, userId);
  if (ambiguous) {
    return res.status(502).json({ error: "Couldn't verify your subscription status. Your account was not deleted. Try again or contact support." });
  }
  if (subscriptionId) {
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (stripeErr) {
      console.error('Account deletion aborted — Stripe cancel failed for user', userId, ':', stripeErr.message);
      return res.status(502).json({ error: "Couldn't cancel your subscription. Your account was not deleted. Try again or contact support." });
    }
  }

  const dbDeleteSteps = [
    ['portfolio_properties', () => supabase.from('portfolio_properties').delete().eq('user_id', userId)],
    ['refurb_estimates', () => supabase.from('refurb_estimates').delete().eq('user_id', userId)],
    ['deals', () => supabase.from('deals').delete().eq('user_id', userId)],
    ['profiles', () => supabase.from('profiles').delete().eq('user_id', userId)],
  ];
  for (const [table, run] of dbDeleteSteps) {
    const { error } = await run();
    if (error) {
      console.error(
        'Account deletion PARTIAL FAILURE for user', userId,
        '— failed deleting from', table, ':', error.message,
        '— Stripe subscription (if any) was already cancelled, no billing risk. Needs manual cleanup.'
      );
      return res.status(500).json({ error: 'Something went wrong deleting your data. Your subscription (if any) has already been cancelled. Please contact support to finish removing your account.' });
    }
  }

  const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    console.error(
      'Account deletion PARTIAL FAILURE for user', userId,
      '— all data deleted and Stripe (if any) cancelled, but auth user deletion failed:', authDeleteError.message,
      '— needs manual cleanup.'
    );
    return res.status(500).json({ error: 'Your data has been deleted, but something went wrong finishing the process. Please contact support.' });
  }

  res.json({ success: true });
});

app.post('/api/profile', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to save your defaults.' });

  const token = getBearerToken(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Log in to save your defaults.' });
  }

  const payload = {
    user_id: userData.user.id,
    target_yield: toNumberOrNull(req.body.target_yield),
    target_roi: toNumberOrNull(req.body.target_roi),
    default_mortgage_rate: toNumberOrNull(req.body.default_mortgage_rate),
    standard_fees: toStandardFeesOrNull(req.body.standard_fees)
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select('target_yield, target_roi, default_mortgage_rate, standard_fees')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/create-checkout-session', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to upgrade.' });

  const token = getBearerToken(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Log in to upgrade.' });
  }

  const plan = await getUserPlan(supabase);
  if (plan === 'paid') {
    return res.status(400).json({ error: 'You already have a paid plan.' });
  }

  const origin = `${req.protocol}://${req.get('host')}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_MAIN, quantity: 1 }],
      customer_email: userData.user.email,
      client_reference_id: userData.user.id,
      metadata: { user_id: userData.user.id },
      success_url: `${origin}/index.html?upgraded=1`,
      cancel_url: `${origin}/index.html`
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/analyse', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use the Full Analysis.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock the Full Analysis.' });
  }

  const { count, error: countError } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfCurrentMonthISO());
  if (countError) return res.status(400).json({ error: countError.message });
  if (count >= 50) {
    return res.status(403).json({ error: 'Monthly analysis limit reached (50). Resets next month.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (response.ok) {
      await supabase.from('ai_usage').insert({});
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// Internal CRM (superuser-only). Every route below starts with
// requireSuperuser(), which returns a request-scoped Supabase client on
// success or has already written the response (401/403) and returned null
// on failure — RLS on every crm_* table (db/022 onward) is the real,
// unbypassable boundary; this is the defense-in-depth app-level check that
// turns a non-superuser's request into a clean error instead of RLS
// silently returning empty rows. Unlike deals/portfolio (owned by
// auth.uid()), crm_* tables are NOT owner-scoped — any superuser can see
// and edit any contact, so there's no per-row "belongs to requester" check
// anywhere below, only the superuser gate itself.
// ---------------------------------------------------------------------

const CRM_CONTACT_CATEGORIES = ['lead', 'client', 'referral_partner'];
const CRM_TIERS = ['tier1_software', 'tier2_acquisition_partner', 'tier3_private_sourcing'];
const CRM_STAGES = ['new', 'contacted', 'qualified', 'active', 'converted', 'lost', 'churned'];
const CRM_BUSINESS_CATEGORIES = ['mortgage_broker', 'accountant', 'solicitor', 'surveyor', 'builder', 'letting_agent'];
const CRM_MANUAL_EVENT_TYPES = ['note', 'call_logged', 'email_sent'];
const CRM_DEAL_REVIEW_OUTCOMES = ['pursue', 'negotiate', 'reject'];
const CRM_REFERRAL_DIRECTIONS = ['sent', 'received'];

function toTrimmedOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Shared by create (requireCore: true — name/contact_category mandatory)
// and update (requireCore: false — every field optional, only keys
// actually present in body are validated/applied, so a PUT can touch just
// one field, e.g. {is_archived: true} for the Archive action).
function validateCrmContactInput(body, { requireCore }) {
  const value = {};

  if (requireCore || body.name !== undefined) {
    const name = toTrimmedOrNull(body.name);
    if (!name) return { error: 'Enter a name.' };
    value.name = name;
  }
  if (requireCore || body.contact_category !== undefined) {
    if (!CRM_CONTACT_CATEGORIES.includes(body.contact_category)) {
      return { error: `contact_category must be one of ${CRM_CONTACT_CATEGORIES.join('/')}.` };
    }
    value.contact_category = body.contact_category;
  }

  if (body.email !== undefined) value.email = toTrimmedOrNull(body.email);
  if (body.phone !== undefined) value.phone = toTrimmedOrNull(body.phone);
  if (body.source !== undefined) value.source = toTrimmedOrNull(body.source);
  if (body.business_name !== undefined) value.business_name = toTrimmedOrNull(body.business_name);
  if (body.linked_user_id !== undefined) value.linked_user_id = toTrimmedOrNull(body.linked_user_id);
  if (body.owner_id !== undefined) value.owner_id = toTrimmedOrNull(body.owner_id);

  if (body.tier !== undefined) {
    const tier = toTrimmedOrNull(body.tier);
    if (tier !== null && !CRM_TIERS.includes(tier)) {
      return { error: `tier must be one of ${CRM_TIERS.join('/')}, or blank.` };
    }
    value.tier = tier;
  }
  if (body.stage !== undefined) {
    if (!CRM_STAGES.includes(body.stage)) {
      return { error: `stage must be one of ${CRM_STAGES.join('/')}.` };
    }
    value.stage = body.stage;
  }
  if (body.business_category !== undefined) {
    const cat = toTrimmedOrNull(body.business_category);
    if (cat !== null && !CRM_BUSINESS_CATEGORIES.includes(cat)) {
      return { error: `business_category must be one of ${CRM_BUSINESS_CATEGORIES.join('/')}, or blank.` };
    }
    value.business_category = cat;
  }
  if (body.partner_tier !== undefined) {
    if (body.partner_tier === null || body.partner_tier === '') {
      value.partner_tier = null;
    } else {
      const pt = Number(body.partner_tier);
      if (![1, 2, 3].includes(pt)) return { error: 'partner_tier must be 1, 2, 3, or blank.' };
      value.partner_tier = pt;
    }
  }
  if (body.is_archived !== undefined) value.is_archived = !!body.is_archived;

  return { value };
}

function validateCrmActivityInput(body) {
  if (!CRM_MANUAL_EVENT_TYPES.includes(body.event_type)) {
    return { error: `event_type must be one of ${CRM_MANUAL_EVENT_TYPES.join('/')}.` };
  }
  const text = toTrimmedOrNull(body.text);
  if (!text) return { error: 'Enter some text.' };
  return { value: { event_type: body.event_type, text } };
}

function validateCrmTaskInput(body) {
  const title = toTrimmedOrNull(body.title);
  if (!title) return { error: 'Enter a task title.' };
  const value = { title };
  if (body.assigned_to !== undefined) value.assigned_to = toTrimmedOrNull(body.assigned_to);
  if (body.due_date !== undefined) value.due_date = toTrimmedOrNull(body.due_date);
  return { value };
}

function validateCrmTaskUpdate(body) {
  const value = {};
  if (body.title !== undefined) {
    const title = toTrimmedOrNull(body.title);
    if (!title) return { error: 'Enter a task title.' };
    value.title = title;
  }
  if (body.assigned_to !== undefined) value.assigned_to = toTrimmedOrNull(body.assigned_to);
  if (body.due_date !== undefined) value.due_date = toTrimmedOrNull(body.due_date);
  if (body.completed !== undefined) value.completed = !!body.completed;
  return { value };
}

function validateCrmDealReviewInput(body) {
  const property_address = toTrimmedOrNull(body.property_address);
  if (!property_address) return { error: 'Enter a property address.' };
  if (!CRM_DEAL_REVIEW_OUTCOMES.includes(body.outcome)) {
    return { error: `outcome must be one of ${CRM_DEAL_REVIEW_OUTCOMES.join('/')}.` };
  }
  const value = { property_address, outcome: body.outcome };
  const reviewDate = body.review_date !== undefined ? toTrimmedOrNull(body.review_date) : null;
  if (reviewDate) value.review_date = reviewDate;
  if (body.notes !== undefined) value.notes = toTrimmedOrNull(body.notes);
  return { value };
}

function validateCrmReferralInput(body) {
  if (!CRM_REFERRAL_DIRECTIONS.includes(body.direction)) {
    return { error: `direction must be one of ${CRM_REFERRAL_DIRECTIONS.join('/')}.` };
  }
  const referred_name = toTrimmedOrNull(body.referred_name);
  if (!referred_name) return { error: 'Enter who was referred.' };
  const value = { direction: body.direction, referred_name };
  if (body.outcome !== undefined) value.outcome = toTrimmedOrNull(body.outcome);
  if (body.value_estimate !== undefined && body.value_estimate !== null && body.value_estimate !== '') {
    const v = Number(body.value_estimate);
    if (!Number.isFinite(v)) return { error: 'value_estimate must be a number.' };
    value.value_estimate = v;
  }
  return { value };
}

app.get('/api/admin/crm/contacts', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { contact_category, tier, stage, owner_id, linked_user_id, q, sort, dir, include_archived } = req.query;

  let query = supabase.from('crm_contacts').select('*');
  if (contact_category) query = query.eq('contact_category', contact_category);
  if (tier) query = query.eq('tier', tier);
  if (stage) query = query.eq('stage', stage);
  if (owner_id) query = query.eq('owner_id', owner_id);
  // Used by admin/contact.html to find the crm_contacts row (if any) linked
  // to a real Tier 1 signup, so a superuser can leave notes/tasks against a
  // real user without Tier 1's own roster (GET /api/admin/users, profiles-
  // driven) ever needing a crm_contacts row of its own to exist.
  if (linked_user_id) query = query.eq('linked_user_id', linked_user_id);
  if (include_archived !== 'true') query = query.eq('is_archived', false);
  if (q && String(q).trim()) {
    // Commas break PostgREST's .or() filter syntax — stripped rather than
    // escaped, fine for a plain name/email/business_name search box.
    const term = `%${String(q).trim().replace(/,/g, '')}%`;
    query = query.or(`name.ilike.${term},email.ilike.${term},business_name.ilike.${term}`);
  }

  const sortableColumns = ['name', 'contact_category', 'tier', 'stage', 'owner_id', 'business_name', 'created_at', 'updated_at'];
  const sortColumn = sortableColumns.includes(sort) ? sort : 'created_at';
  query = query.order(sortColumn, { ascending: dir === 'asc' });

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  if (!data.length) return res.json(data);

  // last_activity_at / is_stale, added for admin/tier2.html and
  // tier3.html's stale-lead flag — computed here, not client-side, via the
  // shared isStale() in crm-thresholds.js (also used by weekly-digest.js,
  // so the digest email and this live endpoint can never disagree on the
  // threshold). One extra query for every contact_id on this page,
  // ordered newest-first so the first row seen per contact_id in the
  // reduce below is that contact's most recent activity — no separate
  // "latest per group" query needed against a small table like this one.
  const { data: activityRows, error: activityError } = await supabase
    .from('crm_activity_log')
    .select('contact_id, created_at')
    .in('contact_id', data.map(c => c.id))
    .order('created_at', { ascending: false });
  if (activityError) return res.status(400).json({ error: activityError.message });

  const lastActivityByContactId = {};
  for (const row of activityRows) {
    if (!lastActivityByContactId[row.contact_id]) lastActivityByContactId[row.contact_id] = row.created_at;
  }

  const enriched = data.map(c => {
    const lastActivityAt = lastActivityByContactId[c.id] || null;
    return {
      ...c,
      last_activity_at: lastActivityAt,
      is_stale: isStale(lastActivityAt)
    };
  });
  res.json(enriched);
});

app.post('/api/admin/crm/contacts', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { value, error: validationError } = validateCrmContactInput(req.body, { requireCore: true });
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase.from('crm_contacts').insert(value).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/admin/crm/contacts/:id', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { data: contact, error } = await supabase.from('crm_contacts').select('*').eq('id', req.params.id).single();
  if (error || !contact) return res.status(404).json({ error: 'Contact not found.' });

  const isTier23 = contact.tier === 'tier2_acquisition_partner' || contact.tier === 'tier3_private_sourcing';

  const [activityResult, tasksResult, reviewsResult, referralsResult] = await Promise.all([
    supabase.from('crm_activity_log').select('*').eq('contact_id', contact.id).order('created_at', { ascending: false }),
    supabase.from('crm_tasks').select('*').eq('contact_id', contact.id).order('due_date', { ascending: true }),
    isTier23
      ? supabase.from('crm_deal_reviews').select('*').eq('contact_id', contact.id).order('review_date', { ascending: false })
      : Promise.resolve({ data: [] }),
    contact.contact_category === 'referral_partner'
      ? supabase.from('crm_partner_referrals').select('*').eq('contact_id', contact.id).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] })
  ]);

  res.json({
    contact,
    activity: activityResult.data || [],
    tasks: tasksResult.data || [],
    deal_reviews: reviewsResult.data || [],
    referrals: referralsResult.data || []
  });
});

app.put('/api/admin/crm/contacts/:id', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { value, error: validationError } = validateCrmContactInput(req.body, { requireCore: false });
  if (validationError) return res.status(400).json({ error: validationError });
  if (Object.keys(value).length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  const { data, error } = await supabase.from('crm_contacts').update(value).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Contact not found.' });
  res.json(data);
});

// Manual quick-add for note/call_logged/email_sent — writes straight to
// the log, since these ARE the log entry, not a separate table. The other
// four event_types (stage_changed, field_updated, task_completed,
// deal_reviewed) only ever get written by the DB triggers in db/023-025,
// never through this route.
app.post('/api/admin/crm/contacts/:id/activity', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { value, error: validationError } = validateCrmActivityInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('crm_activity_log')
    .insert({ contact_id: req.params.id, actor_id: user ? user.id : null, event_type: value.event_type, event_detail: { text: value.text } })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/crm/contacts/:id/tasks', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { value, error: validationError } = validateCrmTaskInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase
    .from('crm_tasks')
    .insert({ contact_id: req.params.id, ...value })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/admin/crm/tasks', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { assigned_to, include_completed } = req.query;
  let query = supabase.from('crm_tasks').select('*, crm_contacts(name)').order('due_date', { ascending: true });
  if (assigned_to) query = query.eq('assigned_to', assigned_to);
  if (include_completed !== 'true') query = query.eq('completed', false);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.put('/api/admin/crm/tasks/:id', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { value, error: validationError } = validateCrmTaskUpdate(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  if (Object.keys(value).length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  const { data, error } = await supabase.from('crm_tasks').update(value).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Task not found.' });
  res.json(data);
});

app.post('/api/admin/crm/contacts/:id/deal-reviews', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { value, error: validationError } = validateCrmDealReviewInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase
    .from('crm_deal_reviews')
    .insert({ contact_id: req.params.id, ...value })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// All deal reviews across every contact, same shape/purpose as GET
// .../crm/tasks above — added for admin/tier3.html to surface open reviews
// inline per contact, without a per-contact round trip for every row on
// the page. crm_deal_reviews itself is untouched; this is a new read path
// only, same pattern as the tasks list route already had.
app.get('/api/admin/crm/deal-reviews', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { data, error } = await supabase
    .from('crm_deal_reviews')
    .select('*, crm_contacts(name)')
    .order('review_date', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/admin/crm/partners', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { data: partners, error } = await supabase
    .from('crm_contacts')
    .select('*')
    .eq('contact_category', 'referral_partner')
    .eq('is_archived', false)
    .order('name', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });

  const { data: referrals, error: refError } = await supabase
    .from('crm_partner_referrals')
    .select('contact_id, direction');
  if (refError) return res.status(400).json({ error: refError.message });

  const counts = {};
  for (const r of (referrals || [])) {
    if (!counts[r.contact_id]) counts[r.contact_id] = { sent: 0, received: 0 };
    counts[r.contact_id][r.direction]++;
  }

  res.json(partners.map(p => ({ ...p, referral_counts: counts[p.id] || { sent: 0, received: 0 } })));
});

app.post('/api/admin/crm/contacts/:id/referrals', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { value, error: validationError } = validateCrmReferralInput(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { data, error } = await supabase
    .from('crm_partner_referrals')
    .insert({ contact_id: req.params.id, ...value })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Last 20 activity_log rows across every contact. Not currently surfaced
// by any page after the /admin rebuild (the old shared /admin/crm/index.html
// this fed was retired in favour of four separate tier/partner sections,
// none of which show a global cross-contact feed) — left in place since
// it's a harmless, generically useful read endpoint, not dead in the
// sense of being broken, just currently unused.
app.get('/api/admin/crm/activity', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { data, error } = await supabase
    .from('crm_activity_log')
    .select('*, crm_contacts(name)')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Superuser roster, for the owner filter/dropdown (Cameron/Nathan). Relies
// on the "superuser select all profiles" policy in db/021 — without it
// this would only ever return the caller's own row.
app.get('/api/admin/crm/owners', async (req, res) => {
  const supabase = await requireSuperuser(req, res);
  if (!supabase) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, name')
    .eq('role', 'superuser');

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Tier 1 — Software roster: real signed-up users, not crm_contacts. Merges
// three sources that no single RLS-scoped query can reach at once:
//   - auth.users (via supabaseAdmin, service role) for email, signup date
//     (created_at), and last login (last_sign_in_at) — none of that lives
//     in profiles or any other table PostgREST exposes to a normal client.
//   - profiles (name, plan) — also read via supabaseAdmin here rather than
//     the caller's own RLS-scoped client, purely so this route only needs
//     one client instead of two; the superuser-select-all policy (db/021,
//     fixed for recursion in db/028) would have allowed the RLS-scoped
//     client to read every row too, but auth.users still requires the
//     admin client regardless, so there's no RLS benefit to splitting this.
//   - deals (user_id only, one row per saved deal) — tallied into a per-
//     user count in JS; RLS on deals is strictly auth.uid() = user_id with
//     no superuser-all policy (deals was deliberately left alone per the
//     "keep everything else" instruction this route was built under), so
//     only the service-role client can see every user's deals at all.
// No new table, no new column — revenue is a static "Awaiting Stripe
// integration" placeholder client-side, never persisted, since faking or
// half-persisting a number here would be worse than admitting it's not
// wired up yet.
app.get('/api/admin/users', async (req, res) => {
  const authCheck = await requireSuperuser(req, res);
  if (!authCheck) return;

  try {
    const users = await listAllAuthUsers(supabaseAdmin);

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('user_id, name, plan');
    if (profilesError) return res.status(400).json({ error: profilesError.message });
    const profileByUserId = {};
    for (const p of profiles) profileByUserId[p.user_id] = p;

    const { data: deals, error: dealsError } = await supabaseAdmin.from('deals').select('user_id');
    if (dealsError) return res.status(400).json({ error: dealsError.message });
    const dealCountByUserId = {};
    for (const d of deals) dealCountByUserId[d.user_id] = (dealCountByUserId[d.user_id] || 0) + 1;

    // Computed via the shared isAtRisk() in crm-thresholds.js, not inline
    // here — not in admin/index.html either — so the 7-day threshold lives
    // in exactly one place, read identically by this endpoint and by
    // weekly-digest.js. Same "server computes it, page just renders it"
    // pattern as home.html's Needs Attention panel.
    //
    // Stripe: reuses getStripeSubscriptionId() (per-user, one DB query
    // each — see that function's own comment for why this is called once
    // per user here rather than folded into the profiles select above) to
    // find each user's subscription id, then getStripeSubscriptionInfo()
    // (cached — see its own comment) to get that subscription's live
    // status/amount from Stripe. A user with no subscription id gets
    // stripe_status: null (rendered as "No subscription"/"—" client-side,
    // never left blank); one with an id but paid=false in profiles still
    // gets looked up as-is, since profiles.plan and the Stripe id are two
    // separately-written fields (see the webhook handler above) that could
    // in principle disagree — better to show what Stripe actually says.
    const roster = await Promise.all(users.map(async u => {
      const profile = profileByUserId[u.id];
      const { subscriptionId, ambiguous } = await getStripeSubscriptionId(supabaseAdmin, u.id);
      const stripeInfo = subscriptionId ? await getStripeSubscriptionInfo(subscriptionId) : null;

      return {
        user_id: u.id,
        email: u.email,
        name: profile ? profile.name : null,
        plan: profile && profile.plan === 'paid' ? 'paid' : 'free',
        signup_date: u.created_at,
        last_login: u.last_sign_in_at || null,
        deals_saved: dealCountByUserId[u.id] || 0,
        is_at_risk: isAtRisk(u.last_sign_in_at || null),
        stripe_subscription_id: subscriptionId,
        stripe_lookup_failed: ambiguous,
        stripe_status: stripeInfo ? stripeInfo.status : null,
        stripe_amount: stripeInfo ? stripeInfo.amount : null,
        stripe_currency: stripeInfo ? stripeInfo.currency : null,
        stripe_interval: stripeInfo ? stripeInfo.interval : null
      };
    }));
    roster.sort((a, b) => new Date(b.signup_date) - new Date(a.signup_date));

    // Test-mode is derived from the configured key itself (sk_test_ vs
    // sk_live_), not a separate flag to keep in sync — so this banner
    // disappears on its own the day this app switches to a live Stripe
    // key, rather than needing someone to remember to update it then.
    const stripeTestMode = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');

    res.json({ roster, stripe_test_mode: stripeTestMode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual trigger for the weekly digest (weekly-digest.js) — same
// superuser gate as every other admin route, no separate shared-secret
// mechanism. Exists for testing without waiting for Monday morning, and as
// an escape hatch: if the in-process cron schedule below ever proves
// unreliable (e.g. the dyno spins down on inactivity), an external
// scheduler (Render Cron Jobs, etc.) could be pointed at this endpoint
// instead — not built now since nothing asked for it yet, but this route
// is what that would call.
app.post('/api/admin/digest/send-now', async (req, res) => {
  const authCheck = await requireSuperuser(req, res);
  if (!authCheck) return;

  try {
    const result = await sendWeeklyDigest();
    res.json({ sent: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Weekly digest, automatic: Monday 8am Europe/London. In-process — only
// fires if this server process is actually running at that moment, which
// this app has no way to guarantee beyond "the web dyno stays up" (no
// existing cron/edge-function infrastructure to lean on instead). Errors
// are logged, not thrown — an unhandled rejection here must never crash
// the whole server over a failed email send.
cron.schedule('0 8 * * 1', () => {
  sendWeeklyDigest()
    .then(() => console.log('Weekly digest sent.'))
    .catch(e => console.error('Weekly digest failed:', e.message));
}, { timezone: 'Europe/London' });

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Running on port ${PORT}`));
