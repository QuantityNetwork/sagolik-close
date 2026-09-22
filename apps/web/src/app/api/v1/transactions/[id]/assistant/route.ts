import { AppError, askAssistant } from "@sagolik/core";
import { RATE_LIMITS } from "@sagolik/security";
import { z } from "zod";
import { api, jsonBody } from "@/lib/server/api";

const Body = z.object({ question: z.string().trim().min(2).max(500) });

/** POST /api/v1/transactions/:id/assistant — read-only Q&A over structured transaction data. */
export const POST = api<{ id: string }>(
  async ({ req, ctx, params }) => {
    const parsed = Body.safeParse(await jsonBody(req));
    if (!parsed.success) throw new AppError("bad_request", "Ask a question between 2 and 500 characters.", 400);
    return askAssistant(ctx, params.id, parsed.data.question);
  },
  { rateLimit: RATE_LIMITS.assistant },
);
