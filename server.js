require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY
  });
});

// Builds a Supabase client scoped to the logged-in user's own token, so
// Row Level Security (not this server) is what enforces "own deals only".
function supabaseForRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
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

app.post('/api/deals', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to save deals.' });

  const { deal_type, deal_data } = req.body;
  if (deal_type !== 'btl' && deal_type !== 'hmo') {
    return res.status(400).json({ error: 'deal_type must be "btl" or "hmo".' });
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
    .select('id, deal_type, deal_data, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/analyse', async (req, res) => {
  const supabase = supabaseForRequest(req);
  if (!supabase) return res.status(401).json({ error: 'Log in to use AI analysis.' });

  const plan = await getUserPlan(supabase);
  if (plan !== 'paid') {
    return res.status(403).json({ error: 'Upgrade to unlock AI analysis.' });
  }

  const { count, error: countError } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfCurrentMonthISO());
  if (countError) return res.status(400).json({ error: countError.message });
  if (count >= 50) {
    return res.status(403).json({ error: 'Monthly AI analysis limit reached (50) — resets next month.' });
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
