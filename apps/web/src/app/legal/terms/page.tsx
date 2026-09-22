import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of use</h1>
      <h2>What Sagolik Close is</h2>
      <p>Sagolik Close is software that organizes the steps of a property closing: participants, tasks, documents, signatures, identity checks and the status of payments handled by licensed providers. It is an orchestration tool.</p>
      <h2>What Sagolik Close is not</h2>
      <ul>
        <li>It is not a bank, escrow agent, title company, lender, law firm or registry, and does not hold client funds.</li>
        <li>It does not give legal, tax or financial advice. The assistant explains status and next steps; it cannot move money, sign, approve identity checks or make compliance decisions.</li>
        <li>It does not record title. Ownership is shown as transferred only after the responsible registry or recording office confirms it.</li>
      </ul>
      <h2>Your responsibilities</h2>
      <p>Keep your sign-in methods secure, enable two-step verification, and verify payment instructions through the workspace — never through an emailed PDF or phone call. Only upload documents you are entitled to share.</p>
      <h2>Providers</h2>
      <p>Payments, escrow, identity verification, signatures and bank data are provided by third parties under their own terms. Their outcomes are reported to you as they report them to us.</p>
      <h2>Availability and changes</h2>
      <p>We work to keep the service available and secure but cannot guarantee uninterrupted operation. Material changes to these terms will be announced in the product before they take effect.</p>
    </>
  );
}
