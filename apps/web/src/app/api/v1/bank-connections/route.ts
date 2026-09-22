import { getRuntime, myBankConnections, startBankConnection } from "@sagolik/core";
import { api, jsonBody } from "@/lib/server/api";

/** GET /api/v1/bank-connections — the caller's own connections (masked account numbers only). */
export const GET = api(async ({ ctx }) =>
  (await myBankConnections(ctx)).map(({ connection, accounts }) => ({ connection, accounts: accounts.map(({ externalAccountId: _provider, ...a }) => a) })),
);

/** POST /api/v1/bank-connections — { institutionId, country, transactionId? } → provider-hosted consent URL. */
export const POST = api(async ({ req, ctx }) => {
  const rt = await getRuntime();
  return startBankConnection(ctx, await jsonBody(req), `${rt.env.APP_URL}/api/v1/bank-connections/callback`);
});
