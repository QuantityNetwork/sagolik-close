# Compliance boundaries

Sagolik Close is software that coordinates regulated parties. This page records what it deliberately does **not** do. Product changes must not cross these lines without legal review. (The public page `/legal/compliance` summarises this for users.)

| Area | Boundary | How the code enforces it |
| --- | --- | --- |
| Custody of funds | Never holds, pools or routes client money. Escrow and trust accounts belong to licensed escrow or title companies. | Payments go through `PaymentProvider` and `EscrowProvider`. The platform stores statuses and references only. |
| Payment instructions | Accepted only inside the workspace, versioned, cooled-off and verified by a second person. Never by email or chat. | `services/payments.ts`, DB guard `bank_instructions_guard` |
| Settlement | Known only from provider webhooks. | `handlePaymentEvent`; `payments_status_guard` |
| Identity / AML | Verification by a provider. Exceptions go to a named human reviewer. The AI never approves or rejects. | `compliance_cases` require `compliance.review`; the assistant declines |
| Signatures | Applied only by the signer in a certified e-signature provider's ceremony. | `SignatureProvider`; signing requires step-up |
| Title & recording | Ownership is transferred only on a registry or recording office confirmation reference. | `confirmRecording`; `transactions_state_guard` |
| Advice | No legal, tax, lending or investment advice. The assistant explains status and points to the responsible professional. | `services/assistant.ts` |
| Credit decisions | None. Mortgage status is entered by the lender, or reported by a lender integration. | `mortgage.update` is limited to lender roles |
| Data | Minimisation, masking, encryption, export, and retention per jurisdiction. | See [security.md](security.md) |

## Jurisdictions

`packages/workflow/src/jurisdictions.ts` models the required steps per market: US-TX, US-CA, SE, PL, DE, LI and CH. Examples are notary deeds in DE and PL, Lantmäteriet registration in SE, and title insurance in US-TX. Non-US markets are behind the `international_markets` flag. **Each market needs local counsel review before launch.** These models are a starting point, not legal advice.

## Before handling real money

- Provider agreements, with a clear allocation of liability
- Licensing analysis per state or country (money transmission, escrow)
- DPA and sub-processor list; DPIA for identity data
- Counsel review of the legal pages (currently marked as drafts)
- Penetration test and SOC 2 readiness
