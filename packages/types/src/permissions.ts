import { z } from "zod";

/**
 * Granular permissions. Roles map to permissions in `@sagolik/auth`
 * (`ROLE_PERMISSIONS`) and in the `role_permissions` table used by RLS.
 */
export const PERMISSIONS = [
  "transaction.view",
  "transaction.edit",
  "transaction.transition",
  "transaction.close",
  "participant.invite",
  "participant.remove",
  "document.upload",
  "document.view",
  "document.view_restricted",
  "document.approve",
  "signature.sign",
  "signature.request",
  "milestone.approve",
  "task.manage",
  "task.complete_own",
  "financial.view",
  "payment.initiate",
  "payment.approve",
  "beneficiary.modify",
  "beneficiary.verify",
  "identity.view_result",
  "compliance.review",
  "mortgage.update",
  "title.update",
  "escrow.manage",
  "recording.submit",
  "recording.confirm",
  "message.send",
  "audit.view",
  "audit.export",
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = (typeof PERMISSIONS)[number];
