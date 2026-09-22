/**
 * Closing-fraud risk assessment.
 *
 * Deterministic, explainable rules — every control applied can be traced to
 * a named signal. The output drives step-up, cooling-off, dual approval and
 * out-of-band verification. It never silently blocks or approves anything on
 * its own; it tells the service layer which controls must be satisfied.
 */
import type { RiskLevel } from "@sagolik/types";

export type FraudSignalKind =
  | "bank_instruction_changed"
  | "beneficiary_changed"
  | "new_device_before_payment"
  | "unusual_login_geography"
  | "rapid_permission_changes"
  | "email_changed_recently"
  | "payout_modified_near_closing"
  | "identity_mismatch"
  | "repeated_mfa_failures";

export type FraudControl = "step_up" | "cooling_off" | "dual_approval" | "out_of_band_verification" | "manual_review";

export interface FraudContext {
  kind: FraudSignalKind;
  /** Hours until expected closing, if known. */
  hoursToClosing?: number | null;
  deviceAgeHours?: number | null;
  emailChangedHoursAgo?: number | null;
  failedMfaAttempts24h?: number;
  permissionChanges1h?: number;
  countryChanged?: boolean;
}

export interface RiskAssessment {
  level: RiskLevel;
  controls: FraudControl[];
  reasons: string[];
  /** Cooling-off period before a changed instruction becomes usable. */
  coolingOffHours: number;
}

const ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];
const max = (a: RiskLevel, b: RiskLevel): RiskLevel => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

export function assessRisk(ctx: FraudContext, orgCoolingOffHours = 24): RiskAssessment {
  let level: RiskLevel = "low";
  const controls = new Set<FraudControl>();
  const reasons: string[] = [];

  switch (ctx.kind) {
    case "bank_instruction_changed":
    case "beneficiary_changed":
    case "payout_modified_near_closing":
      level = "high";
      controls.add("step_up").add("dual_approval").add("out_of_band_verification").add("cooling_off");
      reasons.push("Payment instructions changed — the most common closing-fraud pattern.");
      if (ctx.hoursToClosing != null && ctx.hoursToClosing <= 72) {
        level = "critical";
        controls.add("manual_review");
        reasons.push("The change happened within 72 hours of closing.");
      }
      break;
    case "new_device_before_payment":
      level = "medium";
      controls.add("step_up");
      reasons.push("A new device is being used to move money.");
      break;
    case "unusual_login_geography":
      level = "medium";
      controls.add("step_up");
      reasons.push("Sign-in from an unusual location.");
      break;
    case "rapid_permission_changes":
      level = (ctx.permissionChanges1h ?? 0) >= 5 ? "high" : "medium";
      controls.add("step_up");
      if (level === "high") controls.add("manual_review");
      reasons.push("Several permission changes in a short time.");
      break;
    case "email_changed_recently":
      level = "medium";
      controls.add("step_up").add("out_of_band_verification");
      reasons.push("The account email changed recently.");
      break;
    case "identity_mismatch":
      level = "high";
      controls.add("manual_review");
      reasons.push("Identity details don't match across sources.");
      break;
    case "repeated_mfa_failures":
      level = (ctx.failedMfaAttempts24h ?? 0) >= 10 ? "high" : "medium";
      controls.add("step_up");
      if (level === "high") controls.add("manual_review");
      reasons.push("Repeated failed verification attempts.");
      break;
  }

  // Compounding signals.
  if (ctx.deviceAgeHours != null && ctx.deviceAgeHours < 24 && ctx.kind !== "new_device_before_payment") {
    level = max(level, "high");
    controls.add("step_up");
    reasons.push("The action came from a device first seen less than 24 hours ago.");
  }
  if (ctx.emailChangedHoursAgo != null && ctx.emailChangedHoursAgo < 72 && ctx.kind !== "email_changed_recently") {
    level = max(level, "high");
    controls.add("out_of_band_verification");
    reasons.push("The account email changed in the last 72 hours.");
  }
  if (ctx.countryChanged) {
    level = max(level, "medium");
    controls.add("step_up");
    reasons.push("Location differs from recent activity.");
  }

  return {
    level,
    controls: [...controls],
    reasons,
    coolingOffHours: controls.has("cooling_off") ? Math.max(orgCoolingOffHours, level === "critical" ? 48 : 0) : 0,
  };
}
