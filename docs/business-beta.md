# Business acquisitions (beta)

Status: **beta**. It is implemented and tested in demo mode, and no customers use it yet. The landing page (`/business`) says so, and its product image is labelled as an illustration with fictional data.

## What it is

A closing workspace for buying a company. It uses the real-estate engine, with a different workflow profile:

| | Real estate | Business acquisition |
| --- | --- | --- |
| Workflow profile | `US-TX`, `US-CA`, … | `US-BUSINESS` (`vertical: "business"`) |
| Subject | Property | Company (`companies` table, `transactions.company_id`) plus optional premises |
| First milestone | Offer accepted | LOI signed |
| Diligence | Inspection, appraisal | Due-diligence report, disclosure schedules, lien search |
| Ownership | Deed recorded by the registry | Counsel confirms the closing filings (assignment, stock power, filings) |
| Extra role | — | `accountant`: documents and tasks, **no** financial permissions |

A database check ties `transaction_type = 'business_acquisition'` to a company, so a business deal can't exist without one. Row-level security on `companies` goes through the transaction, the same way properties do.

## What stays the same

- Sagolik Close does not hold funds. Purchase price and escrow holdbacks go to a licensed escrow agent, and the money service (`docs/money-service.md`) applies the same verification, cooling-off and dual-control rules.
- Ownership is never marked transferred by a click; it needs counsel's confirmation reference.
- The AI assistant explains; it doesn't sign, approve or move funds.

## Not in the beta yet

- Earn-outs, escrow holdback schedules and working-capital adjustments are tracked as documents only, not calculated.
- Cap-table or registry integrations (for example Secretary of State filings) aren't built. Counsel enters filing references by hand.
- Only the US profile exists.

## Try it

Run the demo (`pnpm dev`) and sign in as **Amara Okafor** (buyer), **Tom Becker** (seller), **Rachel Kim** (M&A advisor), **David Chen** (counsel) or **Grace Liu** (accountant). Start a new business deal at `/app/transactions/new?kind=business`.
