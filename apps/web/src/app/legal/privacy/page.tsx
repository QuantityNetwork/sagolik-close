import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy</h1>
      <p>Sagolik Close coordinates real-estate closings. To do that it processes personal data about the people taking part in a transaction. This page explains what, why, and your choices.</p>
      <h2>What we process</h2>
      <ul>
        <li>Account data: name, email, phone, language, sign-in and security events.</li>
        <li>Transaction data: property, parties, milestones, tasks, messages and documents you or other participants add.</li>
        <li>Financial data: bank connections you authorize (masked account numbers, account-holder name, balances needed for proof of funds) and payment statuses. We never receive or store online-banking passwords.</li>
        <li>Identity results: the outcome of identity checks performed by a verification provider. Document images stay with that provider.</li>
      </ul>
      <h2>Why</h2>
      <p>To perform the closing you asked us to coordinate, to meet anti-money-laundering and record-keeping obligations of the regulated parties involved, and to protect you from fraud such as altered wire instructions.</p>
      <h2>Who can see it</h2>
      <p>Access is decided per transaction and per role, and enforced in the database. A lender does not see your messages with your agent; a buyer does not see the seller's bank details. Sagolik staff have no default access to transaction contents; any support access is time-limited and recorded in the audit log.</p>
      <h2>Retention</h2>
      <p>Closing records are retained for the period the applicable jurisdiction and regulated participants require. Data not subject to a retention obligation can be deleted on request.</p>
      <h2>Your rights</h2>
      <p>Signed-in users can download a copy of their data from Settings → Privacy, withdraw bank-data consent at any time, and manage notification preferences. For correction, deletion or objection requests, use the contact form with the topic “Privacy or data request”.</p>
    </>
  );
}
