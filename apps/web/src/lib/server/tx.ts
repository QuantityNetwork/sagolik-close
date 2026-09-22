import "server-only";
import { getRuntime, getTransaction, toAppError, transactionView } from "@sagolik/core";
import type { Locale } from "@sagolik/types";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireContext } from "./context";

/**
 * Load a transaction for the signed-in person once per request (deduplicated
 * across the layout and page). Missing or forbidden → 404, never 403, so ids
 * can't be probed.
 */
export const loadTx = cache(async (transactionId: string) => {
  const { ctx, actor } = await requireContext(`/app/transactions/${transactionId}`);
  try {
    const snapshot = await getTransaction(ctx, transactionId);
    const view = transactionView(ctx, snapshot);
    const rt = await getRuntime();
    const profile = await rt.serviceDb.profiles.get(actor.userId);
    const locale: Locale = profile?.locale ?? "en";
    const can = (p: string) => view.permissions.includes(p);
    return { ctx, actor, snapshot, view, locale, can, demo: rt.env.demoMode };
  } catch (e) {
    const err = toAppError(e);
    if (err.code === "not_found" || err.code === "forbidden") notFound();
    throw e;
  }
});
