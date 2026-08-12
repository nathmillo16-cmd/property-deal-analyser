require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getComps, ComparablesLookupError } = require('./get-comps');
const { PostcodeLookupError, lookupPostcode, reverseGeocodeMsoa } = require('./postcodes-io');

// Service-role client used ONLY by the Stripe webhook handler below, to flip
// a user's plan when Stripe (not the user) is the caller. Never exposed to
// any user-facing route.
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
async function getUserPlan(supabase) {
  try {
    const { data, error } = await supabase.from('profiles').select('plan').single();
    if (error || !data || data.plan !== 'paid') return 'free';
    return 'paid';
  } catch (e) {
    return 'free';
  }
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

  const { deal_type, deal_data, force } = req.body;
  if (!['btl', 'hmo', 'sa', 'flip'].includes(deal_type)) {
    return res.status(400).json({ error: 'deal_type must be "btl", "hmo", "sa", or "flip".' });
  }
  if (!deal_data || typeof deal_data !== 'object') {
    return res.status(400).json({ error: 'Missing deal_data.' });
  }

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    const { count, error: countError } = await supabase
      .from('deals')
      .select('id', { count: 'exact', head: true });
    if (countError) return res.status(400).json({ error: countError.message });
    if (count >= 2) {
      return res.status(403).json({ error: 'Free plan limit reached — upgrade to save more deals.' });
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
    .insert({ deal_type, deal_data })
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date')
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date')
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date')
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date')
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date')
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage, address, updated_at, viewing_date')
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

app.get('/api/profile', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to load your defaults.' });

  const { data, error } = await supabase
    .from('profiles')
    .select('target_yield, target_roi, default_mortgage_rate, standard_fees, plan')
    .single();

  if (error || !data) {
    return res.json({ target_yield: null, target_roi: null, default_mortgage_rate: null, standard_fees: null, plan: 'free' });
  }
  res.json({ ...data, plan: data.plan === 'paid' ? 'paid' : 'free' });
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
    return res.status(403).json({ error: 'Monthly analysis limit reached (50) — resets next month.' });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Running on port ${PORT}`));
