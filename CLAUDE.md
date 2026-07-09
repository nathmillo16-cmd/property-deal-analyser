CLAUDE.md — Deals N Yields

Standing brief for Claude Code. Read this at the start of every session before doing anything.

What this project is

Deals N Yields is a UK residential property deal-analysis web app. A user enters headline figures from a BTL or HMO listing and gets a full breakdown across mortgage / BRRR / cash strategies, an AI verdict per strategy, and a maximum bid to hit their target yield/ROI.

Stack (as it actually is)


Backend: Node.js / Express — server.js. Serves static files and exposes POST /analyse, which proxies to the Anthropic API using a server-side API_KEY env var (keeps the key off the browser).
Frontend: index.html (single file, HTML/CSS/JS).
Deployed on: PythonAnywhere. (Note: repo is the current source of truth, moved to Node from an earlier Flask version — ignore any older references to app.py/Flask.)
Planned: Supabase for auth + Postgres when accounts get built.


THE MOST IMPORTANT RULE — calculation logic

The calculation logic has been verified line-by-line against the owner's own sourcing spreadsheets. Do NOT change, "improve", refactor, or re-derive any calculation on your own initiative. If you think a calculation is wrong, STOP and flag it to the user in plain English — do not silently alter it. Only change calculation logic when the user explicitly asks you to, and when you do, tell them exactly what you changed.

Verified calculation rules (do not alter without explicit instruction)


Mortgage is interest-only. Monthly = (loan × rate/100) / 12
Deposit is calculated against END MARKET VALUE (EMV), not purchase price
BTL mortgage loan = EMV − deposit
HMO mortgage fixed at 75% LTV of EMV
Gross yield calculated against EMV
Stamp duty (BTL surcharge bands): 3% up to £250k, 8% £250k–£925k, 13% £925k–£1.5m, 15% above £1.5m
HMO bills auto-calculated at 10% of total rent
HMO council tax entered annually, divided by 12
Max bid = the MAXIMUM price to pay to hit target. Yield max bid = annual rent / target yield. ROI max bid solved by working back from target money-left-in.


AI analysis structure (current)

One verdict per deal type (BTL or HMO), not per strategy. Sections in order: VERDICT, RISK FLAGS, STRATEGY FIT, WHAT NEEDS TO CHANGE. Triggered by a button (not automatic) to control API cost and act as a paywall point.

What's built vs not


Built: BTL + HMO calculation engine (mortgage vs cash columns), max bid, stamp duty, single AI verdict per deal type, landing page, API key secured server-side.

Planned — not yet built:
BRRR as a distinct strategy (separate from the existing mortgage/cash columns)
Three separate strategy verdicts (MORTGAGE BTL VERDICT, BRRR VERDICT, CASH PURCHASE VERDICT) replacing the current single VERDICT section
"Full capital recovery" display when money left in / ROI is zero or negative (currently shows the raw, possibly negative, figure)
Accounts/login, database, saved deals, paywall, PDF export, comps data


Known gaps to fix later

Money left in / ROI can currently display as a negative number instead of "Full capital recovery" — no code exists yet to catch and relabel this case.
The AI prompt does not currently instruct Claude to treat the supplied figures as final and avoid recalculating them — that instruction doesn't exist in buildBTLPrompt/buildHMOPrompt today.


Current build priority — accounts + database

This is the immediate next task. Everything paid/saved/personalised depends on it.


Auth: Supabase, email + password (decided — not magic-link).
Tables: profiles (user defaults: target yield, target ROI, mortgage rate, standard fees) and deals (id, user_id, deal_type text, deal_data jsonb, created_at). JSONB + deal_type so new strategies (SA, flip) slot in with no schema change.
Security: Row Level Security on both tables — users only see their own rows.
Write path: browser → server → Supabase (not browser → Supabase directly), so usage caps and validation live in one place.
Do user defaults in the SAME build pass as accounts, not as a later step — same table/RLS pattern.


How to work with me (the user)


The user is new to code. Explain what you're about to do in plain English before doing it, and after making changes, say what you changed and why.
Make one focused change at a time; don't refactor broadly or rename things unprompted.
Don't touch the calculation logic (see above).
Before anything is pushed to the shared GitHub repo, be mindful the API key was once exposed in git history — flag anything key-related rather than assuming it's handled.
