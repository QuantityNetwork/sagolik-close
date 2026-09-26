# Property Autopilot (phase 1: monitor and verify)

After closing, Sagolik keeps working for the owner: it keeps each property's operating record and says, at any moment, whether the property is covered — and what needs attention when it isn't.

**Sagolik never holds or moves money and never pays a bill.** The owner's bank, autopay and mortgage servicer keep paying everything. Sagolik watches, forecasts, flags and verifies. This keeps the orchestration-only position of the whole platform (no custody, no money transmission). Paying bills on the owner's behalf would only ever come through a licensed bill-pay partner after legal review; it isn't built.

## What it does

| | |
|---|---|
| **Close → Live** | When the registry confirms the recording, the ownership reaction builds the Home Record and then the Property Passport. From the closing it pre-fills the mortgage (lender; monthly payment estimated from the loan terms), escrow (loan-to-value above 80% suggests escrow), property tax (amount from the listing; typical due dates for TX, CA, FL), insurance, HOA, electricity and water, and the buyer's verified bank account. Inferred items are **suggestions**: they're shown with their source and aren't monitored until the owner confirms them. The `/live` screen reads back what was found — a check mark only when something was actually found. |
| **Costs (obligations)** | What must be paid to keep the property running: amount (fixed, varying with a usual range, periodic, event-based), frequency, next due date, grace period, how it's paid today (autopay, bank bill pay, escrow, manual), escrow status, paying account, priority. |
| **Bills** | Real bills and statements (optionally with the PDF). A bill is *to be paid*, *marked as paid* (the owner says so), *paid (verified)* (bank evidence), *covered through escrow*, *disputed* or *cancelled*. Sagolik never marks something verified on a click. |
| **Checks** | Unusual amounts (above 1.5× the usual maximum from the last 12 paid bills), changed fixed amounts, possible duplicates, bills for ended services, tax or insurance bills that escrow already pays (double-payment risk), uncertain escrow, overdue bills, and the owner's review rules (routine / needs a review / needs two different reviewers / flag). |
| **Funding** | Each paying account is checked against everything due from it in the next 30 days, across all properties that share it, using the high end of usual amounts. A shortfall the reserve can cover becomes a recommendation ("Move $1,840 from your reserve"); the owner makes the transfer. |
| **Forecast** | 30/60/90 days. Bills received are actual; everything else is a labelled prediction. |
| **Continuity status** | *Protected* only when every critical cost is known, funded and on time, with the reasons listed; otherwise *Needs attention* or *At risk* (something could lapse), again with reasons. No opaque score. |
| **Decision log** | Every conclusion is appended to `autopilot_decisions` with its reasons and rule, once per situation. Items that need a person notify the portfolio's members; routine items only appear in the activity timeline. |

## Architecture

- **Rules:** `packages/workflow/src/autopilot.ts` — pure functions over plain data (no database, no clock, no language model). Money is integer cents; amounts people type are parsed exactly (`parseAmount`), never through floating point.
- **Service:** `packages/core/src/services/autopilot.ts` — portfolio access checks, Close → Live, costs, bills, reviews, funding, rules, the decision log and notifications. The worker re-runs the checks every 15 minutes (idempotent).
- **Data:** `supabase/migrations/20260926000001_property_autopilot.sql`. Properties belong to an **owner organization** (`personal_portfolio`, `holding_entity`, `family_office`, `property_manager`); members read through RLS, writes go through the service. `organization_admin` changes rules and funding; `member` manages costs and bills; `auditor` reads. Owner memberships never count as professional access (`professionalMemberships`): owning through an LLC doesn't open the command center or any transaction.
- **UI:** `/app/autopilot` (portfolio control center), `/app/autopilot/[id]` (overview, bills, costs, cash flow, rules & funding, activity), `/app/autopilot/[id]/live` (Close → Live), `/app/autopilot/import` (a property not bought through Sagolik, marked as added by the owner).

## Demo

Sign in as **Alex Morgan** (fictional) for a five-property portfolio: an electricity bill 9.4× the usual amount (Miami), a $1,840 shortfall the reserve can cover (Austin #2), property tax covered through escrow (Manhattan) and a $14,200 insurance renewal that needs review (Aspen). **Mia Rodriguez** can set up Autopilot for the home she closed on.

## Next phases

1. **Plaid intelligence:** Transactions (recurring-bill detection, and *paid (verified)* by matching bank transactions) and Liabilities (next mortgage payment, escrow balance). Plaid bills these per connected account; enable them deliberately.
2. **Bill inbox:** forwarding bills by email (needs an inbound-email service).
3. **Portfolio scale:** filters by entity and state, reports, multiple approvers per portfolio.
4. **Payments (only with a licensed partner and legal review):** the decision engine already produces what a partner would need (what, how much, when, from which account, under which rule).
