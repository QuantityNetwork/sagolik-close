# Writing a provider adapter

Adapters live in `packages/integrations/src/<capability>/`. To add one, for example a production e-signature provider:

1. **Implement the interface.** For signatures that is `SignatureProvider`:
   - `createEnvelope`, `addRecipients`, `addFields`, `send`, `getStatus`, `signingUrl`, `downloadCompletedDocument`
   - `parseWebhook` (from `WebhookCapable`)

   Keep provider types inside the adapter, and return the normalized types the interface declares.
2. **Set `info`:** `{ id: "docusign", displayName: "DocuSign", mode: env === "production" ? "production" : "sandbox" }`. The `id` becomes the webhook path: `/api/webhooks/docusign`.
3. **Verify webhooks strictly.**
   - Use the provider's signature scheme with a constant-time compare.
   - Reject events outside the timestamp tolerance.
   - Throw `WebhookRejectedError` on any doubt.
   - Return a stable `externalEventId` so the pipeline can deduplicate.
4. **Map errors** to `ProviderError(providerId, code, userMessage, { retryable })`. The `userMessage` is shown to people, so write it for them. Keep the raw provider response in logs only.
5. **Register it** in `registry.ts`: choose it when its env vars are present, and add those vars to `packages/config/src/env.ts` and `.env.example`. Add it to `webhookReceivers` if it sends webhooks.
6. **Test it:**
   - Unit-test the webhook verification: valid, bad signature, stale timestamp, replay.
   - Unit-test the status mapping.
   - Run the lifecycle test (`packages/core/src/lifecycle.test.ts`) against the sandbox. The sandbox has to stay behaviour-compatible with the real adapter.

## Rules every adapter follows

- Never collect or proxy online-banking credentials. Use provider-hosted consent only.
- Never report a terminal success (settled, signed, verified, recorded) that the provider has not confirmed.
- Pass idempotency keys through to providers that support them.
- Store only the tokens that are needed, encrypted with `encryptField`. Never log tokens, account numbers or document contents.
- Keep data minimal: request the narrowest scopes the closing needs.
