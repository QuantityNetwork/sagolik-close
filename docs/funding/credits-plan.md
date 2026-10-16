# Credits plan: build Sagolik Close on free cloud credits

Decision, October 2026: **Azure is the platform, and Microsoft's startup program is the main credit source.** Other programs are used only where they pay for something we actually run. Running the product on three clouds to collect three sets of credits would cost more in engineering time and security review than the credits are worth.

Amounts change often. Every figure below must be checked on the program's own page before relying on it, and every application must be true: a false statement can get credits clawed back and the account closed.

## The stack, in order

| # | Program | What it pays for | Why it's on the list | Status |
| --- | --- | --- | --- | --- |
| 1 | **Microsoft for Startups (Founders Hub)** | Azure: the whole platform | We run on Azure. Reportedly up to about $5,000 self-service, with higher tiers through an investor or accelerator referral | Apply first |
| 2 | **Azure free account** | The first month's test deployment | A small one-time credit plus some services free for 12 months | With the account |
| 3 | **Investor or accelerator referral** | Higher Microsoft tiers | The large tiers are tied to referral codes from partner investors and accelerators | Ask every investor and program we talk to |
| 4 | **GitHub for Startups** | GitHub seats and Advanced Security (code and secret scanning) | Our code, CI and deploy pipeline live on GitHub | Apply |
| 5 | **AWS Activate**, **Google for Startups Cloud** | Only if a workload ever runs there | Not useful today: none of our services run on AWS or Google Cloud | Park; revisit if a partner requires it |
| 6 | **Public innovation funding** (for example Vinnova in Sweden, EU programs for fintech and regtech) | Development itself, not just hosting | Larger amounts than any cloud credit, but slower and competitive | Research where the company is registered |

## What to do this week

1. Create the Azure account with the company's email and domain (not a personal address). Use the free trial for the first test deployment.
2. Apply to Microsoft for Startups with the master prompt below. Activate credits only when we're ready to deploy dev, because they expire.
3. Ask any investor, accelerator or incubator we're in contact with: "Are you in the Microsoft for Startups investor network, and can you refer us?"
4. Apply to GitHub for Startups.
5. Set the Azure budget alert (it's already in the templates: $200 a month for dev) so credits can't run out unnoticed.

## Spend as little as possible meanwhile

- Dev runs the lean cost profile (built: `costProfile = 'lean'` in `infra/azure/params/dev.bicepparam`): about $135–185 a month instead of $600–700. It drops Front Door Premium, Defender and Sentinel, and the Premium registry from dev only; dev holds fictional data only, and the template refuses the lean profile for production. On $5,000 of credits, that's more than two years of dev.
- Delete the dev environment when it isn't needed; it redeploys from code in about half an hour.
- Buy reservations only for production, and only once there are customers.

## Master prompt

Paste this into Claude (or any assistant) together with the program's application form. It produces truthful, consistent answers and lists what still needs a human.

```text
You are helping Sagolik Close apply for a startup cloud credit or grant program.
Write answers for the application form I paste below. Rules:

1. Use only the facts in the COMPANY FACTS section. Never invent customers,
   revenue, users, partnerships, certifications, investors or team members.
   If the form asks for something not in the facts, write
   "[NEEDS ANSWER: <what is missing>]" instead of guessing.
2. Keep each answer within the form's length limit, in plain language.
3. Describe what the product does today and what the credits will be used for.
   Be specific: name the services and why they're needed.
4. End with a checklist of every [NEEDS ANSWER] item and every document the
   program asks for (registration certificate, founder ID, website, pitch deck).

COMPANY FACTS
- Name: Sagolik Close. Website: close.sagolik.com.
- What it does: closing orchestration for real-estate transactions and business
  acquisitions. It coordinates buyers, sellers, agents, lenders, title, escrow
  and counsel in one workspace: documents, e-signature, identity checks, proof of
  funds, payment instructions with wire-fraud controls, and a tamper-evident
  deal record.
- It never holds or moves money: funds go from the buyer's bank to the licensed
  escrow company.
- Stage: product built and running as a public demo with fictional data and
  sandbox providers. No paying customers yet. First market: United States.
- Technology: Next.js and TypeScript, a separate Go service for sensitive
  financial data, PostgreSQL with row-level security, an on-chain deal record
  on Base (record and verify only).
- Why this cloud: the platform is built for Microsoft Azure: private networking,
  Key Vault HSM keys, Azure Database for PostgreSQL, Container Apps, Front Door
  with WAF, Microsoft Sentinel and Defender, deployed from code with GitHub
  Actions. Sign-in will move to Microsoft Entra ID.
- What the credits pay for: a development environment now (about $135-185 a
  month in the low-cost profile), then production (about $3,100-4,200 a month
  at list prices) once the first customers sign.
- Funding: [NEEDS ANSWER: bootstrapped or investors, amounts].
- Team: [NEEDS ANSWER: founders, roles, LinkedIn].
- Company registration: [NEEDS ANSWER: country, registration number, date].

APPLICATION FORM
<paste the form's questions here>
```

## What a person has to do

An assistant can draft every answer, but these steps need a person:
- creating the accounts
- accepting the programs' terms
- confirming the company's identity and registration
- activating the credits

Each program requires the applicant to attest that the information is true, and some ask for ID or a call.
