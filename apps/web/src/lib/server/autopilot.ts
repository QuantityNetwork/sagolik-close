import "server-only";
import { passportView, toAppError } from "@sagolik/core";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireContext } from "./context";

/** One property's Autopilot view per request (shared by layout and page). Not a member → 404. */
export const loadPassport = cache(async (passportId: string) => {
  const { ctx, actor } = await requireContext(`/app/autopilot/${passportId}`);
  try {
    return { ctx, actor, view: await passportView(ctx, passportId) };
  } catch (e) {
    const err = toAppError(e);
    if (err.code === "not_found" || err.code === "forbidden" || err.code === "bad_request") notFound();
    throw e;
  }
});
