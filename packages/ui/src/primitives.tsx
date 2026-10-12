/**
 * Sagolik Close design system — accessible primitives.
 * Framework-agnostic React (no Next.js imports) so it can be reused by the
 * admin app, emails and future surfaces.
 *
 * Visual language: crisp 3–4px corners, hairline rules, navy ink on ivory and
 * white paper, almost no shadow. Colour carries meaning (status), not decoration.
 */
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ----------------------------------------------------------------------------- Button

export type ButtonVariant = "primary" | "secondary" | "teal" | "ghost" | "danger" | "light";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-navy-800 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] hover:bg-navy-900 active:bg-navy-950",
  secondary: "bg-paper/60 text-navy-800 ring-1 ring-inset ring-navy-800/25 hover:bg-paper hover:ring-navy-800/60",
  teal: "bg-teal-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] hover:bg-teal-800",
  ghost: "text-navy-800 hover:bg-navy-50",
  danger: "bg-paper text-danger ring-1 ring-inset ring-danger/35 hover:bg-danger-50",
  light: "bg-white text-navy-900 hover:bg-brass-50",
};
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-[14px] gap-2",
  lg: "h-12 px-6 text-[15px] gap-2.5",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cn(
    "btn inline-flex items-center justify-center rounded-control font-medium tracking-[0.01em] whitespace-nowrap",
    "transition-[color,background-color,box-shadow] duration-200 ease-out",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={props.type ?? "button"} className={buttonClasses(variant, size, className)} {...props} />;
}

// ----------------------------------------------------------------------------- Card

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-line bg-paper shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function CardHeader({ title, description, action, className, eyebrow }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; eyebrow?: ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h2 className="font-sans text-[14.5px] font-semibold tracking-[-0.005em] text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

// ----------------------------------------------------------------------------- Status

export type Tone = "neutral" | "progress" | "attention" | "blocked" | "done" | "info" | "stopped";

const TONES: Record<Tone, string> = {
  neutral: "bg-sand/70 text-ink-2 ring-line-strong/70",
  progress: "bg-navy-50 text-navy-700 ring-navy-100",
  attention: "bg-attention-50 text-attention ring-attention/20",
  blocked: "bg-danger-50 text-danger ring-danger/20",
  done: "bg-success-50 text-success ring-success/20",
  info: "bg-teal-50 text-teal-700 ring-teal-100",
  stopped: "bg-sand/70 text-ink-3 ring-line-strong/70",
};
const DOTS: Record<Tone, string> = {
  neutral: "bg-ink-4",
  progress: "bg-navy-600",
  attention: "bg-attention",
  blocked: "bg-danger",
  done: "bg-success",
  info: "bg-teal-600",
  stopped: "bg-ink-4",
};

export function StatusBadge({ tone = "neutral", children, className, dot = true }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-sm px-2 py-[3px] text-[11.5px] font-medium leading-none ring-1 ring-inset", TONES[tone], className)}>
      {dot ? <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} /> : null}
      {children}
    </span>
  );
}

// ----------------------------------------------------------------------------- Alert

export function Alert({ tone = "info", title, children, className, action }: { tone?: Exclude<Tone, "neutral" | "stopped" | "progress">; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const styles = {
    info: "border-l-teal-600 bg-teal-50/60 text-teal-800",
    attention: "border-l-attention bg-attention-50/70 text-[#5f3a00]",
    blocked: "border-l-danger bg-danger-50/70 text-[#741a12]",
    done: "border-l-success bg-success-50/70 text-[#134a2f]",
  }[tone];
  return (
    <div role={tone === "blocked" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-sm border border-line border-l-[3px] px-4 py-3 text-sm", styles, className)}>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5" : null, "opacity-90")}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

// ----------------------------------------------------------------------------- Forms

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-[12.5px] font-medium tracking-[0.01em] text-ink-2", className)} {...props} />;
}

const fieldBase =
  "block w-full rounded-control border border-line-strong bg-paper px-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-4 hover:border-ink-4 focus:border-navy-700 focus:outline-none focus:ring-[3px] focus:ring-navy-700/10 disabled:bg-sand disabled:text-ink-3 aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-10", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "min-h-24 py-2", className)} {...props} />;
}

export function Field({ label, htmlFor, hint, error, children, className }: { label: ReactNode; htmlFor: string; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  const hintId = `${htmlFor}-hint`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={hintId} className="text-[12px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[12px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- Layout helpers

export function EmptyState({ title, children, action, icon }: { title: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon ? <div className="mb-4 text-ink-4">{icon}</div> : null}
      <p className="font-display text-[19px] text-navy-800">{title}</p>
      {children ? <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-3">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-line", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-sm bg-sand", className)} />;
}

export function DefinitionList({ items, className }: { items: Array<{ term: ReactNode; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
          <dt className="text-ink-3">{it.term}</dt>
          <dd className="text-right font-medium text-ink num">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ----------------------------------------------------------------------------- Table

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("border-b border-navy-800/70 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3", className)} {...props} />;
}
export function Td({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle", className)} {...props} />;
}

// ----------------------------------------------------------------------------- Hint (tooltip)

export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex" tabIndex={0} aria-label={label}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-64 -translate-x-1/2 translate-y-1 rounded-sm bg-navy-900 px-2.5 py-1.5 text-[12px] leading-snug text-white opacity-0 shadow-lg transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus:translate-y-0 group-focus:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
