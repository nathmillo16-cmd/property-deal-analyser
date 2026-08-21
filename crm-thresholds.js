// crm-thresholds.js — the two staleness thresholds used by the admin CRM's
// flagging: Tier 1 "at risk" (no login recently) and Tier 2/3 "stale" (no
// activity logged recently). Pulled out into their own tiny module so the
// weekly digest (weekly-digest.js) computes exactly the same flags the live
// admin pages show (server.js's GET /api/admin/users and
// GET /api/admin/crm/contacts) — one threshold definition, not two copies
// that could quietly drift apart if one were ever changed without the
// other.

const AT_RISK_DAYS = 7;
const STALE_DAYS = 5;

// No login ever counts as at-risk too, not just "7+ days since a login
// that did happen" — a user with zero logins is at least as much a risk
// signal as one who logged in 8 days ago.
function isAtRisk(lastLoginIso) {
  if (!lastLoginIso) return true;
  return new Date(lastLoginIso).getTime() < Date.now() - AT_RISK_DAYS * 24 * 60 * 60 * 1000;
}

// Same shape for Tier 2/3 staleness: no activity logged at all counts as
// stale, not just "5+ days since the last one".
function isStale(lastActivityIso) {
  if (!lastActivityIso) return true;
  return new Date(lastActivityIso).getTime() < Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
}

module.exports = { AT_RISK_DAYS, STALE_DAYS, isAtRisk, isStale };
