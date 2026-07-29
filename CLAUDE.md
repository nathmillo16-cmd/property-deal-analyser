CLAUDE.md — Deals N Yields

Standing brief for Claude Code. Read this at the start of every session before doing anything.

What this project is

Deals N Yields is a UK property deal-analysis and deal-tracking web app for property sourcers and investors. A user signs up, enters headline figures from a listing across four strategies (BTL, HMO, Serviced Accommodation, or Flip), gets a full breakdown, a maximum bid to hit their target, and an optional AI verdict. Deals can be saved, promoted into a kanban pipeline to track through a sales process, and compared side by side. The app is a walled garden — signup/login is required before using anything — with a free tier and a paid tier (£29/month via Stripe) that unlocks the AI verdict, unlimited saved deals, and the pipeline.

Stack (as it actually is)

- Backend: Node.js / Express — server.js. Serves static HTML files, proxies AI requests to the Anthropic API (key stays server-side), and exposes all data endpoints (deals, pipeline, profile/defaults, Stripe checkout, Stripe webhook). Every data endpoint requires a valid Supabase bearer token; paid-only endpoints additionally check the caller's plan server-side via a shared fail-closed helper.
- Frontend: plain HTML/CSS/JS, no framework, no build step. Each page is a self-contained file (index.html, pipeline.html, saved-deals.html, home.html, login.html, landing.html) plus one small shared file, auth-guard.js, used by the logged-in pages to redirect to the landing page if there's no session.
- Auth/database: Supabase (Postgres + Auth), Row Level Security on every table, keyed to auth.uid().
- Payments: Stripe, test mode currently, live checkout + webhook flow both built and verified.
- Deployed on: Render, auto-deploying from the GitHub main branch (pushing to main ships to production — no separate deploy step).

THE MOST IMPORTANT RULE — calculation logic

The calculation logic for BTL, HMO, SA, and Flip has been verified line-by-line against the owner's own sourcing spreadsheets and worked examples. Do NOT change, "improve", refactor, or re-derive any calculation on your own initiative, and do NOT invent or guess a formula for a new strategy — the user supplies the exact spec. If you think a calculation is wrong, STOP and flag it to the user in plain English — do not silently alter it. Only change calculation logic when the user explicitly asks you to, and when you do, tell them exactly what you changed. When building a new calculation feature, verify it with a fully worked example (ideally by executing the real shipped code against known inputs, not just describing the formula) before telling the user it's done.

Verified calculation rules (do not alter without explicit instruction)

Shared/reused across strategies:
- Mortgage is interest-only. Monthly = (loan × rate/100) / 12.
- Deposit is calculated against END MARKET VALUE (EMV), not purchase price.
- Stamp duty (BTL surcharge bands): 3% up to £250k, 8% £250k–£925k, 13% £925k–£1.5m, 15% above £1.5m. Reused as-is by every strategy that references stamp duty; in BTL/HMO/SA it is informational/display-only and is not itself deducted anywhere in the yield/ROI/cashflow maths (this looks unusual but is the verified existing behavior — do not "fix" it).

BTL:
- Mortgage loan = EMV − deposit.
- Gross yield, and both mortgage and cash net yield, calculated against EMV (not purchase price) — this applies uniformly, confirmed against the live code.
- Max bid = the MAXIMUM price to pay to hit target. Yield max bid = annual rent / target yield. ROI max bid solved by working back from target money-left-in.

HMO:
- Mortgage fixed at 75% LTV of EMV (not deposit-derived like BTL).
- Bills auto-calculated at 10% of total rent.
- Council tax entered annually, divided by 12 for monthly display.
- Same EMV-based yield convention as BTL. ROI max bid uses an 80-iteration bisection search (stamp duty is banded/non-linear, so no closed form).

SA (Serviced Accommodation):
- Revenue = nightly rate × (occupancy% / 100) × 365.
- Running costs: management/utilities/maintenance as % of revenue (each defaults to 10%, user-editable), plus fixed cleaning and insurance (£/mo × 12), plus council tax (annual, as entered).
- Net annual income (before mortgage) = revenue − running costs.
- Cashflow: net income minus annual mortgage interest (mortgage version); net income as-is (cash version).
- Gross/net yield: EMV-based, same convention as BTL/HMO.
- Total cash invested reuses BTL's exact pattern (deposit/purchase-price-based), extended with SA's own upfront costs.
- Max bid uses BTL's closed-form approach (not HMO's bisection).

Flip (buy-refurbish-sell):
- Cash-only — no mortgage version, no rental income, no yield concept.
- Total cash invested = purchase price + stamp duty + buying fees + refurb + contingency amount. Estate agent fee is deliberately excluded from cash invested (it comes out of sale proceeds, not paid upfront).
- Contingency is optional (% of refurb cost); blank is treated as 0.
- Net profit = sale value − purchase price − stamp duty − buying fees − refurb − contingency amount − estate agent fee amount.
- ROI = net profit / total cash invested. Profit margin = net profit / sale value.
- Max bid solves for the highest purchase price still hitting a target ROI via 80-iteration bisection (purchase price affects stamp duty, which affects both sides of the ROI calc). The search direction was independently verified numerically (ROI strictly decreases as purchase price rises) rather than assumed from HMO's own search. The estate agent fee is fixed to the (fixed) sale value throughout the search, not recalculated per candidate price — deliberate, per the owner's explicit instruction on how a flipper actually reasons about a deal.

AI verdict

One verdict per strategy (BTL, HMO, SA, or Flip), each with its own tailored prompt. Sections in order: VERDICT, RISK FLAGS, STRATEGY FIT, WHAT NEEDS TO CHANGE. Triggered by a button (not automatic), gated to paid users only, capped at 50 analyses per calendar month per user, logged only on a successful Anthropic response (a failed call doesn't count against the cap).

Auth flow

Supabase email + password (not magic-link). Sign up → "check your email to confirm" message shown, user is NOT dropped into the app before confirming. If a login attempt fails specifically because the email isn't confirmed (Supabase's error.code === 'email_not_confirmed'), a "Resend confirmation email" option appears — resend only ever fires in response to that specific failure, never as a standalone/blind form, to avoid enabling spam to arbitrary addresses. Forgot-password flow: request email → Supabase's recovery link (implicit flow, tokens in a URL hash) → the app detects the PASSWORD_RECOVERY auth event and shows a set-new-password panel → success signs the user into the app directly (no second login needed). Confirmed working against the real Supabase project, not assumed. Logout is available from every logged-in page and returns to the landing page.

App structure and navigation

- `/` — public landing page (landing.html), the front door for logged-out visitors. Sign-up/log-in CTAs. Redirects an already-logged-in visitor straight to /home.html.
- `/login.html` — login, signup, forgot-password. Redirects an already-logged-in visitor to /home.html (with a guard so this can't hijack an in-progress password-recovery flow). Supports ?mode=signup to open on the Sign Up tab.
- `/home.html` — logged-in welcome portal: email, and cards linking to Calculator, Saved Deals, Pipeline, and Portfolio. Deliberately minimal — no portfolio stats shown inline on the dashboard itself yet (proposed, not built — see Portfolio open items).
- `/index.html` — the calculator (BTL/HMO/SA/Flip/Comps tabs).
- `/saved-deals.html` — the user's saved deals, listing + "Add to pipeline" per deal.
- `/pipeline.html` — the kanban pipeline (paid feature, see below).
- `/portfolio.html` — tracking properties actually bought (paid feature, see below).
- Logged-in nav, present on all logged-in pages: Home / Calculator / Saved Deals / Pipeline / Portfolio / Log out.
- Route protection: index.html, saved-deals.html, pipeline.html, portfolio.html, and home.html all use a shared client-side check (auth-guard.js) that redirects to `/` if there's no Supabase session. This is a UX/onboarding mechanism, not a security boundary — it can't be one, since the calculator's own arithmetic runs entirely client-side with zero server dependency (a deliberate, separate decision — see gating below). The actual, unbypassable protection is that every real data endpoint (saved deals, pipeline, portfolio, profile/defaults, AI verdict, Stripe checkout) independently requires a valid bearer token server-side regardless of this check. A forced-open protected page is an empty shell with no data — nothing of value is exposed by bypassing the redirect.

Saved deals

`deals` table (id, user_id, deal_type text — 'btl'/'hmo'/'sa'/'flip', deal_data jsonb, created_at, pipeline_stage text nullable). JSONB + deal_type means new strategies slot in with no schema change (already proven twice, for SA and Flip). Write path is browser → server → Supabase, never browser → Supabase directly, so validation and usage caps live in one place. RLS restricts every row to its own user_id. Free users are capped at 2 saved deals; paid users unlimited — enforced server-side.

Saved defaults

`profiles` table holds target_yield, target_roi, default_mortgage_rate, and a standard_fees jsonb (solicitor/mortgage/searches). Shared across BTL/HMO/SA (not Flip — its input set, a single "buying fees" figure and no mortgage rate, doesn't map cleanly onto this shared schema, so Flip has no "save as my defaults"). Saving from any one tab overwrites the same shared row; loading pre-fills all applicable tabs on login. Free to all logged-in users, not plan-gated. A database trigger on auth.users automatically creates a profiles row (plan='free') for every new signup, regardless of signup path.

Pipeline (Pillar 2, first feature — built)

A deal is "in the pipeline" when its pipeline_stage column (on the same deals table — not a separate table, to keep one source of truth) is non-null. Stages, in order: analysing → viewing → offered → agreed → completed. "Add to pipeline" sets stage to 'analysing'; "remove from pipeline" sets it back to null — the underlying saved deal is never deleted, only the stage-tracking state changes. Stage changes currently happen via a per-card dropdown (drag-and-drop is a deferred polish pass; mobile drag is also deferred). Side-by-side comparison lets the user select 2+ pipeline deals (any mix of strategies) and see their key figures in a table, built from a per-strategy field map reading values already computed and stored in deal_data at save time — no calculation logic is duplicated or re-derived for comparison, so figures always match the calculator. The entire pipeline (viewing and modifying) is a paid feature, enforced server-side via the same plan-check helper used by the AI verdict — free/unauthenticated requests are rejected before touching the database, not just hidden client-side.

Each pipelined deal can now carry notes and an offer history, via a "Notes & offers" modal opened per card (pipeline.html had no click-to-detail view before this — this is its first one). Two tables, both linking to a deal via deal_id references deals(id) on delete cascade, RLS-scoped to auth.uid() (db/007_deal_notes.sql, db/008_deal_offers.sql): deal_notes (note_text, created_at) are timestamped log entries with no edit endpoint — to change one, delete and re-add; deal_offers (amount, offer_date, outcome — Pending/Rejected/Accepted/Withdrawn) has an editable outcome via PUT /api/offers/:id, which is why 008 includes an update RLS policy from the start (006 on portfolio_properties missed it originally and edits silently failed — not repeated here). Both sets of endpoints (/api/deals/:dealId/notes, /api/deals/:dealId/offers, /api/notes/:id, /api/offers/:id) share the same auth+plan gate as the rest of the pipeline, and POSTs additionally verify the deal_id belongs to the requester before attaching anything to it.

Payments (Stripe, test mode, live and verified)

Single £29/month subscription. Checkout: POST /api/create-checkout-session creates a Stripe Checkout Session for a logged-in free user, with both client_reference_id and metadata.user_id set to the Supabase user id (redundant on purpose, for whichever field the webhook ends up reading). Webhook: POST /api/stripe-webhook verifies the Stripe signature before looking at anything (rejects with 400 otherwise, never touches the database on an unverified request), mounted with express.raw() and registered before the global express.json() middleware so Stripe gets the exact raw bytes it signed while every other route keeps parsing JSON normally. On checkout.session.completed for a subscription, it flips the matching user's profiles.plan to 'paid' via a service-role client scoped to that one handler only — never exposed to any user-facing route. Redelivered webhook events are naturally idempotent (a plain UPDATE to a fixed value). The Stripe secret key, publishable key, price ID, and webhook signing secret all live in .env, never in the browser or in git.

Comps engine (built)

Server-side sold-price valuation and post-refurb GDV estimation, on its own tab in the calculator. Paid-gated the same way as the Pipeline and AI verdict — auth + plan checked server-side in POST /api/comps, and the EPC API key never reaches the browser (it lives entirely inside epc-floor-area.js). Postcode-radius search (nearbyPostcodes, 0.5 miles) over HM Land Registry Price Paid Data (PPD) sold prices, each comp enriched with EPC floor area (exact house-number match; permanent cache in epc_floor_area_cache, including cached "no match found" results, so any given postcode's EPC data is only ever fetched once). Headline valuation is the median sold price, with a 20th/80th percentile range (null below 5 comps — not enough evidence for a range) and a high/medium/low confidence signal based on comp count only (see open items below). A GDV tier picker (50th/75th/90th percentile of floor-area-matched £/sqm comps — conservative/refurbished/best-in-area) lets a sourcer enter a post-refurb floor area and apply the resulting GDV as the end value (EMV, or Sale Value for Flip) on any of the four strategy tabs, via an explicit "Use this GDV" button — never silently auto-filled.

Open items on the comps engine:
- PPD ingest currently only loads a 12-month window (WINDOW_MONTHS in scripts/ingest-sold-prices.js), not the 24 months get-comps.js's COMPARABLE_MONTHS is written for. Widening this needs a manual re-run of the ingest script with WINDOW_MONTHS bumped to 24.
- The recency-based confidence downgrade in computeConfidence() (get-comps.js) is commented out, not deleted, pending that 24-month ingest — right now every comp is "recent" by definition, so the downgrade could never fire honestly.
- PPD refresh is manual (re-running scripts/ingest-sold-prices.js against a newly downloaded yearly CSV) — nothing scheduled.
- Stripe is still in test mode (see above) — relevant here since the comps engine, like the pipeline, is paid-gated.

Portfolio (built)

Standalone page (portfolio.html), not a calculator tab — structurally like the Pipeline, and paid-gated the same way (server-side plan check on every /api/portfolio endpoint; the page itself uses the same loading/logged-out/locked/board state pattern as pipeline.html). Backed by portfolio_properties (address, price_paid, property_type, monthly_rent, monthly_running_costs, monthly_mortgage nullable), RLS-scoped to auth.uid() via user_id default auth.uid(), same convention as deals. server.js exposes POST/GET/DELETE/PUT /api/portfolio(/:id); PUT (added after the original three, which it doesn't modify) reuses the same validatePortfolioInput as POST. Per-property yield excludes mortgage; monthly cashflow includes it, treating a blank mortgage as 0; price_paid of 0 returns a null yield rather than Infinity/NaN. The page's summary row shows four server-computed figures — Properties (count), Total monthly cashflow, Blended yield (£-weighted across the portfolio, not an average of each property's own yield), and Total invested (sum of price_paid), all from computePortfolioTotals — never trusted from the client. Clicking a property row opens a modal with its computed figures, an editable form pre-filled with its current values, Save changes, and Delete (moved off the row into the modal, which closes on the × button, a backdrop click, or Escape).

A "Move to portfolio" button on each saved deal (saved-deals.html) bridges the two: it opens a modal — same look, pre-filled from that deal — mapping deal_data onto the portfolio fields (price_paid and property_type map directly; monthly_rent/monthly_running_costs/monthly_mortgage are derived from the deal's own computed figures, e.g. running costs = rent − the deal's cNm/cCFm; address is always left blank, since deal_data.name can't be reliably told apart from an auto-generated label). The user reviews and explicitly confirms — it never auto-adds — and reuses the existing POST /api/portfolio as-is (no new endpoint), so it inherits the same validation and paid-gating.

Open items on the portfolio:
- Photo uploads are out of scope so far — would need Supabase Storage (a bucket + its own RLS-scoped upload policy), not yet built.
- A portfolio summary card on home.html's dashboard (alongside the existing Recent saved deals / Pipeline cards) was proposed but not built — the content-grid there is currently 2-column, so the layout call (3-column vs. wrapping) is still open.

What's built vs not

Built: BTL, HMO, SA, and Flip calculation engines (verified against worked examples), max bid per strategy, stamp duty, per-strategy AI verdict, Supabase auth (signup/confirm/resend/login/logout/forgot-password), saved deals, saved defaults, the pipeline (kanban + stages + comparison + per-deal notes and offer history, paid-gated), the comps engine (postcode search, sold-price valuation, EPC floor-area enrichment, GDV tier picker — paid-gated), the portfolio (add/edit/delete owned properties, four-figure summary, a "Move to portfolio" bridge from saved deals, paid-gated), Stripe subscription payments (checkout + webhook), the public landing page, the logged-in home portal, app-wide navigation, and route protection.

Planned — not yet built:
- Community marketplace.
- Pipeline v1 polish: drag-and-drop (currently dropdown-based), mobile drag support.
- Broader visual/design polish pass across the app.
- Comps engine open items — see "Open items on the comps engine" above.
- Portfolio open items — see "Open items on the portfolio" above.
- Property pack builder: assembles a deal's figures, comps/GDV, area stats, and photos into an investor-ready shareable document (likely PDF). Depends on the other features here being further along first, since it's purely an aggregation of what they produce — notably area research/stats (below) and portfolio photo uploads (see Portfolio open items), neither of which exist yet.
- Area research/stats: crime rate, employment, schools, major employers, etc. for a target investment area. Needs a data-sourcing scoping session first — like the one that grounded the comps engine (HM Land Registry PPD + EPC) — before building anything, since each stat likely comes from a different source with its own availability/access/licensing quirks, not one uniform API.

How to work with me (the user)

- The user is new to code. Explain what you're about to do in plain English before doing it, and after making changes, say what you changed and why.
- Make one focused change at a time; don't refactor broadly or rename things unprompted.
- Don't touch the calculation logic (see above), and don't invent/guess a formula for a new feature — ask for the exact spec.
- Before anything is pushed to the shared GitHub repo, verify .env is still git-ignored and scan the diff for secrets — flag anything key-related rather than assuming it's handled.
- When adding a new calculation-bearing feature, verify byte-for-byte that existing verified calculation functions are untouched (diff/checksum before and after), and give a fully worked example before considering it done.
