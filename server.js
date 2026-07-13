require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    .select('id, deal_type, deal_data, created_at, pipeline_stage')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage')
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage')
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage')
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
    .select('id, deal_type, deal_data, created_at, pipeline_stage')
    .single();

  if (error || !data) return res.status(404).json({ error: 'Deal not found.' });
  res.json(data);
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
