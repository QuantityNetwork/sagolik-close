/**
 * Domain components: transaction status, progress, money, people, documents,
 * integrations. Presentational only — data comes from server view models.
 */
import type { ReactNode } from "react";
import { cn, StatusBadge, type Tone } from "./primitives";

// ----------------------------------------------------------------------------- Money

export function formatMoney(minor: number, currency: string, locale = "en-US", opts: { cents?: boolean } = {}) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(minor / 100);
}

export function MoneyDisplay({ amount, currency, locale, className, cents }: { amount: number; currency: string; locale?: string; className?: string; cents?: boolean }) {
  return <span className={cn("num", className)}>{formatMoney(amount, currency, locale, { cents })}</span>;
}

// ----------------------------------------------------------------------------- Progress

export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={className}>
      <div role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
        <div className="h-full rounded-full bg-teal-600 transition-[width] duration-500" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function ProgressRing({ value, size = 64, label }: { value: number; size?: number; label: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${Math.round(v)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-navy-100" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} strokeLinecap="round" className="stroke-teal-600" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <span className="absolute text-sm font-semibold text-navy-800 num">{Math.round(v)}%</span>
    </div>
  );
}

export interface StepperStep {
  key: string;
  label: string;
  state: "complete" | "current" | "upcoming" | "blocked";
}

/** Compact horizontal stepper: ✓ Agreement ✓ Identity ● Signing ○ Funds … */
export function ProgressStepper({ steps, className }: { steps: StepperStep[]; className?: string }) {
  return (
    <ol className={cn("flex w-full items-start", className)}>
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex flex-1 flex-col items-center text-center" aria-current={s.state === "current" ? "step" : undefined}>
          {i > 0 ? (
            <span aria-hidden className={cn("absolute top-[9px] right-1/2 h-0.5 w-full -translate-x-[10px]", steps[i - 1]!.state === "complete" ? "bg-teal-600" : "bg-line-strong")} />
          ) : null}
          <span
            className={cn(
              "relative z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px]",
              s.state === "complete" && "border-teal-600 bg-teal-600 text-white",
              s.state === "current" && "border-navy-800 bg-paper",
              s.state === "blocked" && "border-danger bg-danger-50",
              s.state === "upcoming" && "border-line-strong bg-paper",
            )}
          >
            {s.state === "complete" ? (
              <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
                <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : s.state === "current" ? (
              <span className="h-2 w-2 rounded-full bg-navy-800" />
            ) : null}
          </span>
          <span className={cn("mt-1.5 hidden text-[11px] leading-tight sm:block", s.state === "current" ? "font-semibold text-navy-800" : s.state === "complete" ? "text-ink-2" : "text-ink-3")}>{s.label}</span>
          <span className="sr-only">
            {s.label}: {s.state}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ----------------------------------------------------------------------------- Timeline

export interface TimelineItem {
  key: string;
  title: ReactNode;
  status: "complete" | "current" | "upcoming" | "blocked" | "attention";
  detail?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}

const TL_DOT: Record<TimelineItem["status"], string> = {
  complete: "bg-teal-600 border-teal-600",
  current: "bg-paper border-navy-800 ring-4 ring-navy-100",
  upcoming: "bg-paper border-line-strong",
  blocked: "bg-danger border-danger ring-4 ring-danger-50",
  attention: "bg-attention border-attention ring-4 ring-attention-50",
};

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {items.map((it, i) => (
        <li key={it.key} className="relative flex gap-4 pb-6 last:pb-0">
          {i < items.length - 1 ? <span aria-hidden className={cn("absolute top-5 left-[7px] h-[calc(100%-12px)] w-0.5", it.status === "complete" ? "bg-teal-600/60" : "bg-line")} /> : null}
          <span aria-hidden className={cn("relative mt-1 h-4 w-4 shrink-0 rounded-full border-2", TL_DOT[it.status])} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className={cn("text-sm font-medium", it.status === "upcoming" ? "text-ink-3" : "text-ink")}>{it.title}</p>
              {it.meta ? <div className="text-[12px] text-ink-3">{it.meta}</div> : null}
            </div>
            {it.detail ? <p className="mt-0.5 text-[13px] text-ink-3">{it.detail}</p> : null}
            {it.children}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ----------------------------------------------------------------------------- People

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

const AVATAR_TINTS = ["bg-navy-100 text-navy-800", "bg-teal-100 text-teal-800", "bg-sand text-ink-2", "bg-[#efe6f5] text-[#4b2a66]", "bg-[#f7ebe0] text-[#7a3f12]"];

export function ParticipantAvatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const tint = AVATAR_TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TINTS.length];
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", tint, className)} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials(name)}
    </span>
  );
}

// ----------------------------------------------------------------------------- Transaction / integration status

export function TransactionStatus({ label, tone }: { label: string; tone: "neutral" | "progress" | "attention" | "done" | "stopped" }) {
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

export function IntegrationStatus({ mode, status }: { mode: "mock" | "sandbox" | "production"; status?: "healthy" | "degraded" | "down" | "unknown" }) {
  const tone: Tone = mode === "production" ? (status === "down" ? "blocked" : status === "degraded" ? "attention" : "done") : mode === "sandbox" ? "info" : "attention";
  return <StatusBadge tone={tone}>{mode === "mock" ? "Sandbox (mock)" : mode === "sandbox" ? "Provider sandbox" : status === "down" ? "Down" : "Live"}</StatusBadge>;
}

export function healthTone(health: "normal" | "needs_attention" | "blocked" | "complete"): Tone {
  return { normal: "progress", needs_attention: "attention", blocked: "blocked", complete: "done" }[health] as Tone;
}

export const HEALTH_LABEL = { normal: "On track", needs_attention: "Needs attention", blocked: "Blocked", complete: "Complete" } as const;
