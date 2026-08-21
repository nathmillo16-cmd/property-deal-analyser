// weekly-digest.js — Monday-morning admin digest: new Tier 1 signups this
// week, Tier 1 users currently flagged at-risk, Tier 2/3 contacts currently
// flagged stale, and every currently-overdue crm_tasks row. One email to
// every superuser (profiles.role = 'superuser'), sent via Resend
// (RESEND_API_KEY / DIGEST_FROM_EMAIL in .env — the sending domain,
// propulsionproperty.co.uk, is configured on the Resend account itself,
// not hardcoded here).
//
// Reuses the exact same is_at_risk / is_stale thresholds the live admin
// pages use (crm-thresholds.js), so this email can never disagree with
// what a superuser would see by actually opening the admin pages that same
// morning. "Overdue" for tasks matches the same definition
// tier2.html/tier3.html/contact.html already use client-side (completed =
// false, due_date before today).
//
// Called two ways (both wired in server.js): automatically, by an
// in-process node-cron schedule (Monday 8am Europe/London), and manually
// via the superuser-gated POST /api/admin/digest/send-now, for testing.
// The in-process schedule only fires if the server process is actually
// running at that moment — flagged to the user as a real limitation, not
// hidden, since this app has no existing cron/edge-function infrastructure
// to fall back on instead.

require('dotenv').config();
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { isAtRisk, isStale, AT_RISK_DAYS, STALE_DAYS } = require('./crm-thresholds');
const { listAllAuthUsers } = require('./admin-users');

const NEW_SIGNUP_DAYS = 7;

function supabaseAdminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// New signups + at-risk users, both derived from the same full auth-user
// list — also resolves which of those users are superusers, and their
// emails, since that's this email's own recipient list.
async function getTier1Section(supabaseAdmin) {
  const users = await listAllAuthUsers(supabaseAdmin);
  const { data: profiles, error } = await supabaseAdmin.from('profiles').select('user_id, name, role');
  if (error) throw new Error(error.message);
  const profileByUserId = {};
  for (const p of profiles) profileByUserId[p.user_id] = p;

  const signupCutoff = Date.now() - NEW_SIGNUP_DAYS * 24 * 60 * 60 * 1000;

  const newSignups = [];
  const atRiskUsers = [];
  const superuserEmails = [];
  for (const u of users) {
    const profile = profileByUserId[u.id];
    const name = (profile && profile.name) || u.email;
    if (new Date(u.created_at).getTime() >= signupCutoff) {
      newSignups.push({ name, email: u.email, signup_date: u.created_at });
    }
    if (isAtRisk(u.last_sign_in_at || null)) {
      atRiskUsers.push({ name, email: u.email, last_login: u.last_sign_in_at || null });
    }
    if (profile && profile.role === 'superuser') superuserEmails.push(u.email);
  }

  return { newSignups, atRiskUsers, superuserEmails };
}

async function getStaleTier23Contacts(supabaseAdmin) {
  const { data: contacts, error } = await supabaseAdmin
    .from('crm_contacts')
    .select('id, name, tier, stage')
    .in('tier', ['tier2_acquisition_partner', 'tier3_private_sourcing'])
    .eq('is_archived', false);
  if (error) throw new Error(error.message);
  if (!contacts.length) return [];

  const { data: activityRows, error: activityError } = await supabaseAdmin
    .from('crm_activity_log')
    .select('contact_id, created_at')
    .in('contact_id', contacts.map(c => c.id))
    .order('created_at', { ascending: false });
  if (activityError) throw new Error(activityError.message);

  const lastActivityByContactId = {};
  for (const row of activityRows) {
    if (!lastActivityByContactId[row.contact_id]) lastActivityByContactId[row.contact_id] = row.created_at;
  }

  return contacts
    .filter(c => isStale(lastActivityByContactId[c.id] || null))
    .map(c => ({ name: c.name, tier: c.tier, stage: c.stage }));
}

async function getOverdueTasks(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from('crm_tasks')
    .select('title, due_date, crm_contacts(name)')
    .eq('completed', false)
    .lt('due_date', todayDateString())
    .order('due_date', { ascending: true });
  if (error) throw new Error(error.message);
  return data.map(t => ({ title: t.title, due_date: t.due_date, contact_name: t.crm_contacts ? t.crm_contacts.name : null }));
}

function tierLabel(tier) {
  if (tier === 'tier2_acquisition_partner') return 'Tier 2';
  if (tier === 'tier3_private_sourcing') return 'Tier 3';
  return tier;
}

// Three short plain sections, deliberately not a dashboard dump — grouped
// as Tier 1 (new signups + at-risk, both from the same profiles/auth.users
// source), Tier 2/3 (stale leads), and overdue tasks (spans every tier).
function buildEmailContent({ newSignups, atRiskUsers, staleContacts, overdueTasks }) {
  const tier1Lines = [];
  tier1Lines.push(newSignups.length ? `New signups this week (${newSignups.length}):` : 'New signups this week: none.');
  newSignups.forEach(u => tier1Lines.push(`  - ${u.name} (${u.email}) — signed up ${fmtDate(u.signup_date)}`));
  tier1Lines.push('');
  tier1Lines.push(atRiskUsers.length ? `At risk — no login in ${AT_RISK_DAYS}+ days (${atRiskUsers.length}):` : 'At risk: none.');
  atRiskUsers.forEach(u => tier1Lines.push(`  - ${u.name} (${u.email}) — last login ${u.last_login ? fmtDate(u.last_login) : 'never'}`));

  const tier23Lines = [];
  tier23Lines.push(staleContacts.length ? `Stale — no activity in ${STALE_DAYS}+ days (${staleContacts.length}):` : 'Stale contacts: none.');
  staleContacts.forEach(c => tier23Lines.push(`  - ${c.name} (${tierLabel(c.tier)}, ${c.stage})`));

  const taskLines = [];
  taskLines.push(overdueTasks.length ? `Overdue tasks (${overdueTasks.length}):` : 'Overdue tasks: none.');
  overdueTasks.forEach(t => taskLines.push(`  - "${t.title}"${t.contact_name ? ' · ' + t.contact_name : ''} — was due ${fmtDate(t.due_date)}`));

  const text = [
    'PROPulsion weekly digest',
    '',
    'TIER 1 — SOFTWARE',
    tier1Lines.join('\n'),
    '',
    'TIER 2/3 — STALE LEADS',
    tier23Lines.join('\n'),
    '',
    'OVERDUE TASKS',
    taskLines.join('\n')
  ].join('\n');

  const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const htmlSection = (title, lines) => `<p><strong>${escapeHtml(title)}</strong><br>${lines.map(escapeHtml).join('<br>')}</p>`;
  const html = [
    '<p>PROPulsion weekly digest</p>',
    htmlSection('Tier 1 — Software', tier1Lines),
    htmlSection('Tier 2/3 — Stale leads', tier23Lines),
    htmlSection('Overdue tasks', taskLines)
  ].join('\n');

  const subject = `PROPulsion weekly digest — ${fmtDate(new Date().toISOString())}`;
  return { subject, text, html };
}

async function sendViaResend({ to, subject, text, html }) {
  if (!to.length) throw new Error('No recipients — no superuser profile has a resolvable email.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({ from: process.env.DIGEST_FROM_EMAIL, to, subject, text, html })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || 'Resend send failed.');
  return body;
}

async function sendWeeklyDigest() {
  const supabaseAdmin = supabaseAdminClient();
  const [tier1, staleContacts, overdueTasks] = await Promise.all([
    getTier1Section(supabaseAdmin),
    getStaleTier23Contacts(supabaseAdmin),
    getOverdueTasks(supabaseAdmin)
  ]);

  const content = buildEmailContent({
    newSignups: tier1.newSignups,
    atRiskUsers: tier1.atRiskUsers,
    staleContacts,
    overdueTasks
  });

  return sendViaResend({ to: tier1.superuserEmails, ...content });
}

module.exports = { sendWeeklyDigest };
