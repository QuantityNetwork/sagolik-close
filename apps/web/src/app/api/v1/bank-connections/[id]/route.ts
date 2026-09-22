import { AppError, myBankConnections } from "@sagolik/core";
import { api } from "@/lib/server/api";

/** GET /api/v1/bank-connections/:id — one of the caller's own connections. */
export const GET = api<{ id: string }>(async ({ ctx, params }) => {
  const found = (await myBankConnections(ctx)).find((c) => c.connection.id === params.id);
  if (!found) throw new AppError("not_found", "That bank connection couldn't be found.", 404);
  return { connection: found.connection, accounts: found.accounts.map(({ externalAccountId: _provider, ...a }) => a) };
});
