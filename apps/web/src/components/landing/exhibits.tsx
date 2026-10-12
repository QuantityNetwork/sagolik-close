/**
 * Report-style exhibits for the public site: diagrams of how Sagolik Close
 * works, drawn in SVG and animated with CSS (see globals.css). They depict
 * mechanisms, never performance figures, and every one says it is illustrative.
 */
import type { ReactNode } from "react";
import { delay, stagger } from "@/lib/motion";

export function Exhibit({ label, title, note, children, className, reveal = true }: { label: string; title: string; note?: ReactNode; children: ReactNode; className?: string; reveal?: boolean }) {
  return (
    <figure className={`exhibit ${className ?? ""}`} {...(reveal ? { "data-reveal": "" } : {})}>
      <p className="exhibit-label">{label}</p>
      <p className="exhibit-title">{title}</p>
      <div className="mt-5">{children}</div>
      {note ? <figcaption className="exhibit-note">{note}</figcaption> : null}
    </figure>
  );
}

// ----------------------------------------------------------------------------- Exhibit 1: one record, every party

const PARTIES: Array<[string, string, number]> = [
  ["Registry", "Records the deed", 270],
  ["Seller's agent", "Represents the seller", 318],
  ["Seller", "Receives proceeds", 0],
  ["Escrow", "Holds the funds", 42],
  ["Title", "Clears title", 90],
  ["Lender", "Funds the loan", 138],
  ["Buyer", "Signs, sends funds", 180],
  ["Buyer's agent", "Represents the buyer", 222],
];

/** Hero exhibit: parties around one transaction record; lines draw on load, then data flows. */
export function ClosingNetwork() {
  const cx = 320;
  const cy = 248;
  const nodes = PARTIES.map(([name, role, deg]) => {
    const a = (deg * Math.PI) / 180;
    return { name, role, x: Math.round(cx + 250 * Math.cos(a)), y: Math.round(cy + 186 * Math.sin(a)) };
  });
  return (
    <figure className="exhibit enter" style={delay(250)} aria-labelledby="exhibit-1-title">
      <p className="exhibit-label">Exhibit 1</p>
      <p id="exhibit-1-title" className="exhibit-title">
        One closing, every party, one record
      </p>
      <svg viewBox="0 0 640 500" className="mt-4 w-full" role="img" aria-label="Diagram: buyer, seller, both agents, lender, title, escrow and the registry all connect to one transaction record kept by Sagolik Close.">
        <ellipse cx={cx} cy={cy} rx={250} ry={186} fill="none" className="stroke-line-strong enter-fade" strokeWidth={1} strokeDasharray="2 6" style={delay(200)} />
        <ellipse cx={cx} cy={cy} rx={150} ry={112} fill="none" className="stroke-line enter-fade" strokeWidth={1} style={delay(300)} />
        {nodes.map((n, i) => (
          <path key={`l-${n.name}`} d={`M ${cx} ${cy} L ${n.x} ${n.y}`} pathLength={1} fill="none" className="draw-on-load stroke-navy-800/35" strokeWidth={1} style={delay(500 + i * 90)} />
        ))}
        <g className="enter-fade" style={delay(2100)}>
          {nodes.map((n, i) => (
            <path key={`f-${n.name}`} d={`M ${cx} ${cy} L ${n.x} ${n.y}`} fill="none" className={`flow stroke-teal-600 ${i % 2 ? "flow-reverse" : ""}`} strokeWidth={1.6} strokeLinecap="round" style={delay(i * 230)} />
          ))}
        </g>
        <rect x={cx - 104} y={cy - 46} width={208} height={92} rx={3} fill="none" className="pulse stroke-teal-600/60" strokeWidth={1} style={delay(2400)} />
        <g className="enter-fade" style={delay(150)}>
          <rect x={cx - 104} y={cy - 46} width={208} height={92} rx={3} className="fill-navy-800" />
          <text x={cx} y={cy - 10} textAnchor="middle" className="fill-teal-300 text-[9.5px] font-semibold tracking-[0.22em]">
            SAGOLIK CLOSE
          </text>
          <text x={cx} y={cy + 17} textAnchor="middle" className="fill-white text-[19px]" style={{ fontFamily: "var(--font-display)" }}>
            Transaction record
          </text>
        </g>
        {nodes.map((n, i) => (
          <g key={n.name} className="enter-fade" style={delay(1000 + i * 90)}>
            <rect x={n.x - 72} y={n.y - 25} width={144} height={50} rx={3} className="fill-paper stroke-line-strong" strokeWidth={1} />
            <circle cx={n.x - 56} cy={n.y - 6} r={3} className="fill-teal-600" />
            <text x={n.x - 47} y={n.y - 2} className="fill-ink text-[13px] font-semibold max-sm:text-[16px]">
              {n.name}
            </text>
            <text x={n.x - 56} y={n.y + 15} className="fill-ink-3 text-[10.5px] max-sm:hidden">
              {n.role}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="exhibit-note">
        Illustrative. Every party works from the same record and sees only what its role allows. Funds move between banks and the licensed escrow or title partner — never through Sagolik Close.
      </figcaption>
    </figure>
  );
}

// ----------------------------------------------------------------------------- Exhibit: the transaction journey

export function JourneyLine({ stages, current }: { stages: string[]; current: number }) {
  const pct = (current / (stages.length - 1)) * 100;
  return (
    <div className="overflow-x-auto pb-2">
      <div className="relative min-w-[820px] px-2 pt-2">
        <div className="absolute top-[13px] right-[4.5%] left-[4.5%] h-px bg-line-strong" aria-hidden />
        <div className="absolute top-[12px] left-[4.5%] h-[3px]" style={{ width: `${pct * 0.91}%` }} aria-hidden>
          <div className="grow h-full w-full bg-navy-800" style={stagger(0, 200)} />
        </div>
        <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          {stages.map((s, i) => {
            const state = i < current ? "done" : i === current ? "current" : "next";
            return (
              <li key={s} className="follow flex flex-col items-center text-center" style={stagger(i, 300)} aria-current={state === "current" ? "step" : undefined}>
                <span className="relative flex h-[22px] w-[22px] items-center justify-center">
                  {state === "current" ? <span className="pulse absolute inset-0 rounded-full border border-teal-600" aria-hidden /> : null}
                  <span
                    className={
                      state === "done"
                        ? "h-[11px] w-[11px] rounded-full bg-navy-800"
                        : state === "current"
                          ? "h-[13px] w-[13px] rounded-full border-[3px] border-teal-600 bg-paper"
                          : "h-[11px] w-[11px] rounded-full border border-line-strong bg-paper"
                    }
                    aria-hidden
                  />
                </span>
                <span className={`mt-3 max-w-[86px] text-[11.5px] leading-tight ${state === "current" ? "font-semibold text-navy-800" : state === "done" ? "text-ink-2" : "text-ink-3"}`}>{s}</span>
                <span className="sr-only">{state === "done" ? "complete" : state === "current" ? "in progress" : "upcoming"}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Exhibit: payment-instruction controls

const CONTROL_STEPS: Array<[string, string]> = [
  ["New or changed instruction", "Entered once, inside the workspace — never accepted by email or chat."],
  ["Second-person verification", "Someone other than the person who entered it confirms it, by a known phone number."],
  ["Cooling-off period", "A changed instruction waits before use, and every party is alerted to check it."],
  ["Usable for funding", "Only now can a payer see the full details — after confirming it's really them."],
];

export function ControlFlow() {
  return (
    <div>
      <ol className="grid border-t border-white/15 md:grid-cols-4">
        {CONTROL_STEPS.map(([t, b], i) => (
          <li key={t} className="follow relative border-white/15 py-6 max-md:[&:not(:first-child)]:border-t md:px-6 md:first:pl-0 md:[&:not(:first-child)]:border-l" style={stagger(i, 200)}>
            <p className="font-display text-[13px] tracking-[0.08em] text-brass-300 num">Step {i + 1}</p>
            <p className="mt-2 font-display text-[20px] leading-snug text-white">{t}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-white/65">{b}</p>
          </li>
        ))}
      </ol>
      <div className="relative mt-4 h-px overflow-hidden bg-white/15" aria-hidden>
        <span className="grow absolute inset-y-0 left-0 w-full bg-white/25" />
        <span className="control-sweep absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-teal-300 to-transparent" />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Exhibit: who holds the money

export function FundsFlow() {
  const nodes: Array<[number, string, string]> = [
    [110, "Buyer's bank", "Sends the funds"],
    [320, "Escrow or title partner", "Licensed; holds the funds"],
    [530, "Seller's bank", "Receives the proceeds"],
  ];
  return (
    <svg viewBox="0 0 640 300" className="w-full" role="img" aria-label="Diagram: funds move from the buyer's bank to the licensed escrow or title partner and on to the seller's bank. Sagolik Close sits above, exchanging only instructions, approvals and status.">
      <defs>
        <marker id="funds-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-navy-800" />
        </marker>
      </defs>
      <g className="follow-fade" style={stagger(0)}>
        <rect x={40} y={20} width={560} height={58} rx={3} className="fill-navy-800" />
        <text x={320} y={45} textAnchor="middle" className="fill-white text-[17px]" style={{ fontFamily: "var(--font-display)" }}>
          Sagolik Close
        </text>
        <text x={320} y={64} textAnchor="middle" className="fill-teal-300 text-[10px] font-semibold tracking-[0.18em]">
          INSTRUCTIONS · APPROVALS · STATUS
        </text>
      </g>
      {nodes.map(([x], i) => (
        <g key={`info-${x}`}>
          <path d={`M ${x} 80 L ${x} 168`} pathLength={1} fill="none" className="draw stroke-teal-600/50" strokeWidth={1} style={stagger(i + 1)} />
          <path d={`M ${x} 80 L ${x} 168`} fill="none" className={`flow stroke-teal-600 ${i % 2 ? "" : "flow-reverse"}`} strokeWidth={1.6} strokeLinecap="round" style={{ animationDelay: `${i * 300}ms` }} />
        </g>
      ))}
      <text x={128} y={128} className="fill-teal-700 text-[10.5px] max-sm:hidden">
        information only
      </text>
      {nodes.map(([x, name, sub], i) => (
        <g key={name} className="follow" style={stagger(i + 2)}>
          <rect x={x - 92} y={170} width={184} height={64} rx={3} className={i === 1 ? "fill-brass-50 stroke-brass-500" : "fill-paper stroke-line-strong"} strokeWidth={1} />
          <text x={x} y={198} textAnchor="middle" className="fill-ink text-[13.5px] font-semibold max-sm:text-[15px]">
            {name}
          </text>
          <text x={x} y={218} textAnchor="middle" className="fill-ink-3 text-[11px] max-sm:hidden">
            {sub}
          </text>
        </g>
      ))}
      <path d="M 204 202 L 226 202" pathLength={1} fill="none" className="draw stroke-navy-800" strokeWidth={1.5} markerEnd="url(#funds-arrow)" style={stagger(6)} />
      <path d="M 414 202 L 436 202" pathLength={1} fill="none" className="draw stroke-navy-800" strokeWidth={1.5} markerEnd="url(#funds-arrow)" style={stagger(7)} />
      <g className="follow-fade" style={stagger(8)}>
        <path d="M 110 250 C 110 282, 530 282, 530 250" fill="none" className="stroke-navy-800/30" strokeWidth={1} strokeDasharray="3 4" />
        <text x={320} y={292} textAnchor="middle" className="fill-navy-800 text-[11px] font-semibold tracking-[0.12em]">
          FUNDS NEVER PASS THROUGH SAGOLIK CLOSE
        </text>
      </g>
    </svg>
  );
}

// ----------------------------------------------------------------------------- Guilloché: the fine-line engraving on banknotes and certificates

function wave(width: number, cy: number, a1: number, a2: number, phase: number) {
  const pts: string[] = [];
  for (let x = 0; x <= width; x += 6) {
    const y = cy + a1 * Math.sin((2 * Math.PI * x) / width + phase) + a2 * Math.sin((4 * Math.PI * x) / width + phase * 2);
    pts.push(`${x} ${y.toFixed(1)}`);
  }
  return `M ${pts.join(" L ")}`;
}

/** Decorative engraved-line texture that drifts slowly (static with reduced motion). */
export function Guilloche({ id, className, lines = 12, height = 180, tone = "light" }: { id: string; className?: string; lines?: number; height?: number; tone?: "light" | "dark" }) {
  const width = 240;
  const paths = Array.from({ length: lines }, (_, i) => wave(width, height / 2, height * 0.3, height * 0.08, (i * 2 * Math.PI) / lines));
  return (
    <svg aria-hidden className={`pointer-events-none ${className ?? ""}`}>
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse">
          {paths.map((d, i) => (
            <path key={i} d={d} fill="none" strokeWidth={0.6} className={tone === "light" ? "stroke-brass-300/50" : "stroke-brass-600/25"} />
          ))}
        </pattern>
      </defs>
      <rect className="guilloche-drift" x={0} y={0} width={4000} height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
