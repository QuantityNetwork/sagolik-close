/**
 * Sagolik Close product icons — the brand icon set.
 *
 * Solid, duotone glyphs on a 48×48 grid: a navy→teal gradient body, teal
 * accents, and "knockout" details (lines, checks) drawn in the surface colour.
 * Tones:
 *   brand — on light surfaces (default)
 *   light — on navy surfaces (sidebar, hero)
 *   mono  — currentColor only, for dense UI such as tabs
 */
import { type CSSProperties, type ReactNode, useId } from "react";
import { cn } from "./primitives";

export type IconTone = "brand" | "light" | "mono";

const TONES: Record<IconTone, CSSProperties> = {
  brand: { "--i-from": "#032a52", "--i-to": "#0b6f80", "--i-accent": "#0a7c8c", "--i-knock": "#ffffff" } as CSSProperties,
  light: { "--i-from": "#ffffff", "--i-to": "#cfe9ec", "--i-accent": "#6fc8cc", "--i-knock": "#032a52" } as CSSProperties,
  mono: { "--i-from": "currentColor", "--i-to": "currentColor", "--i-accent": "currentColor", "--i-knock": "var(--icon-knock, #ffffff)" } as CSSProperties,
};

type Paint = { body: string; accent: string; knock: string };
type Glyph = (p: Paint) => ReactNode;

const round = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

function gearPath(cx: number, cy: number, teeth: number, outer: number, inner: number, hole: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    const w = step * 0.22;
    const corners: Array<[number, number]> = [
      [a - step / 2 + w * 0.2, inner],
      [a - w, outer],
      [a + w, outer],
      [a + step / 2 - w * 0.2, inner],
    ];
    for (const [ang, r] of corners) pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z M${cx + hole} ${cy}a${hole} ${hole} 0 1 0 ${-2 * hole} 0a${hole} ${hole} 0 1 0 ${2 * hole} 0Z`;
}
const GEAR = gearPath(24, 24, 8, 20, 15.5, 6.5);

const DOC = "M13 4h15.5L38 13.5V41a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z";
const DOC_FOLD = "M28.5 4v7.5a2 2 0 0 0 2 2H38z";
const SHIELD = "M24 3.5 40.5 9.8V22c0 10.6-6.9 18.9-16.5 22.5C14.4 40.9 7.5 32.6 7.5 22V9.8z";

const coin = (cx: number, cy: number, rx: number, h: number, body: string, top: string) => (
  <g key={`${cx}-${cy}`}>
    <path d={`M${cx - rx} ${cy}v${h}c0 2.2 4.5 4 ${rx} 4s${rx}-1.8 ${rx}-4v${-h}z`} fill={body} />
    <ellipse cx={cx} cy={cy} rx={rx} ry={4} fill={top} />
  </g>
);

const GLYPHS = {
  overview: ({ body, accent }) => (
    <>
      <path d="M11 22.5V39a3 3 0 0 0 3 3h20a3 3 0 0 0 3-3V22.5" fill={accent} opacity={0.14} />
      <path d="M5.5 23.5 24 8l18.5 15.5" fill="none" stroke={body} strokeWidth={5} {...round} />
      <path d="M19.5 42v-8.5a4.5 4.5 0 0 1 9 0V42z" fill={accent} />
    </>
  ),
  documents: ({ body, accent, knock }) => (
    <>
      <path d={DOC} fill={body} />
      <path d={DOC_FOLD} fill={accent} opacity={0.55} />
      <rect x={16} y={20} width={16} height={2.8} rx={1.4} fill={knock} />
      <rect x={16} y={26.5} width={16} height={2.8} rx={1.4} fill={knock} />
      <rect x={16} y={33} width={10} height={2.8} rx={1.4} fill={knock} />
    </>
  ),
  banking: ({ body, accent }) => (
    <>
      <path d="M24 4.5 43 15H5z" fill={body} />
      <rect x={7} y={16.5} width={34} height={3} rx={1} fill={body} />
      <rect x={10} y={21.5} width={6} height={14} rx={1} fill={body} />
      <rect x={21} y={21.5} width={6} height={14} rx={1} fill={accent} />
      <rect x={32} y={21.5} width={6} height={14} rx={1} fill={body} />
      <rect x={6} y={37.5} width={36} height={4.5} rx={1.5} fill={body} />
    </>
  ),
  payments: ({ body, accent }) => (
    <>
      {coin(32, 26, 10, 5, body, accent)}
      {coin(32, 18, 10, 5, body, accent)}
      {coin(32, 10, 10, 5, body, accent)}
      {coin(14, 30, 9.5, 6, body, accent)}
    </>
  ),
  escrow: ({ body, knock }) => (
    <>
      <path d={SHIELD} fill={body} />
      <path d="m16.5 24 5.5 5.5 10-11" fill="none" stroke={knock} strokeWidth={3.6} {...round} />
    </>
  ),
  ownership: ({ body, accent }) => (
    <>
      <path fillRule="evenodd" d="M32 5.5a10.5 10.5 0 1 1 0 21 10.5 10.5 0 0 1 0-21zm0 6a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" fill={accent} />
      <path d="M25 23 8.5 39.5M13 35l4.5 4.5M17.5 30.5l3.5 3.5" fill="none" stroke={body} strokeWidth={5} {...round} />
    </>
  ),
  people: ({ body, accent }) => (
    <>
      <circle cx={33} cy={16.5} r={6} fill={accent} />
      <path d="M26.8 29.2A10.6 10.6 0 0 1 33 27c6.3 0 11 4.8 11 11.5V40a2 2 0 0 1-2 2H32.5c.3-1 .5-2.1.5-3.3 0-3.9-2.4-7.4-6.2-9.5z" fill={accent} />
      <circle cx={18} cy={14} r={7.5} fill={body} />
      <path d="M4 38.5C4 30.9 10.3 25 18 25s14 5.9 14 13.5V40a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill={body} />
    </>
  ),
  tasks: ({ body, accent, knock }) => (
    <>
      <rect x={9} y={8} width={30} height={36} rx={4.5} fill={body} />
      <rect x={17} y={4} width={14} height={8.5} rx={3} fill={accent} />
      <path d="m16.5 27 5.5 5.5 10-11" fill="none" stroke={knock} strokeWidth={3.6} {...round} />
    </>
  ),
  timeline: ({ body, accent }) => (
    <>
      <rect x={7} y={10} width={34} height={32} rx={5} fill="none" stroke={body} strokeWidth={4} />
      <rect x={7} y={10} width={34} height={8} rx={4} fill={body} />
      <rect x={13} y={5} width={4.5} height={10} rx={2.25} fill={body} />
      <rect x={30.5} y={5} width={4.5} height={10} rx={2.25} fill={body} />
      {[14.5, 21.8, 29.1].flatMap((x, i) =>
        [23.5, 31].map((y, j) => <rect key={`${x}-${y}`} x={x} y={y} width={4.6} height={4.6} rx={1.2} fill={(i + j) % 2 ? accent : body} />),
      )}
    </>
  ),
  property: ({ body, accent, knock }) => (
    <>
      <path d="M3 24.5 21 8.5l18 16h-5V41H8V24.5z" fill={body} />
      <rect x={17} y={30} width={7} height={11} rx={1} fill={knock} opacity={0.9} />
      <circle cx={34} cy={32} r={7.5} fill={knock} stroke={accent} strokeWidth={4} />
      <path d="m39.5 37.5 5 5" stroke={accent} strokeWidth={4.5} {...round} />
    </>
  ),
  signatures: ({ body, accent, knock }) => (
    <>
      <path d="M11 3.5h13.5L33 12v25a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V6.5a3 3 0 0 1 3-3z" fill={body} />
      <rect x={13.5} y={17} width={12} height={2.8} rx={1.4} fill={knock} />
      <rect x={13.5} y={23} width={9} height={2.8} rx={1.4} fill={knock} />
      <path d="M21 38c2.2-5.5 5-6.5 5.4-3.5.4 3 1.8 3.6 3.7.4 1.6-2.7 3-2.9 3.6-.4.6 2.4 2.4 2.4 4.6.5 1.4-1.2 3.3-1.8 5.7-1.4" fill="none" stroke={accent} strokeWidth={2.4} {...round} />
    </>
  ),
  identity: ({ body, knock }) => (
    <>
      <path d={SHIELD} fill={body} />
      <circle cx={24} cy={19.5} r={4.8} fill={knock} />
      <path d="M15.5 33.5c0-4.8 3.8-7.5 8.5-7.5s8.5 2.7 8.5 7.5V35h-17z" fill={knock} />
    </>
  ),
  financing: ({ body, accent }) => (
    <>
      <rect x={7} y={28} width={9} height={14} rx={1.5} fill={accent} />
      <rect x={19.5} y={19} width={9} height={23} rx={1.5} fill={body} />
      <rect x={32} y={7} width={9} height={35} rx={1.5} fill={accent} />
    </>
  ),
  title: ({ body, knock }) => (
    <>
      <path d={DOC} fill={body} />
      <rect x={15.5} y={13} width={11} height={2.8} rx={1.4} fill={knock} />
      <rect x={15.5} y={19} width={8} height={2.8} rx={1.4} fill={knock} />
      <circle cx={24} cy={30.5} r={6} fill="none" stroke={knock} strokeWidth={3} />
      <path d="m28.5 35 4 4" stroke={knock} strokeWidth={3.2} {...round} />
    </>
  ),
  insurance: ({ body, accent }) => (
    <>
      <path d="M24 5v3" stroke={body} strokeWidth={3} {...round} />
      <path d="M4.5 25C5.4 14.6 13.8 7 24 7s18.6 7.6 19.5 18c-3.1-2.6-7.4-2.6-10.5 0-2.6-2.4-6.4-2.6-9-.6-2.6-2-6.4-1.8-9 .6-3.1-2.6-7.4-2.6-10.5 0z" fill={body} />
      <path d="M24 24.5v14a4 4 0 0 1-8 0" fill="none" stroke={accent} strokeWidth={3.4} {...round} />
    </>
  ),
  messages: ({ body, knock }) => (
    <>
      <path d="M10 7h28a5 5 0 0 1 5 5v18a5 5 0 0 1-5 5H21.5L13 42.5V35h-3a5 5 0 0 1-5-5V12a5 5 0 0 1 5-5z" fill={body} />
      <rect x={13} y={16} width={22} height={3} rx={1.5} fill={knock} />
      <rect x={13} y={23} width={14} height={3} rx={1.5} fill={knock} />
    </>
  ),
  integrations: ({ body, accent }) => (
    <>
      <rect x={6} y={6} width={16} height={16} rx={3.5} fill={accent} />
      <rect x={26} y={6} width={16} height={16} rx={3.5} fill={body} />
      <rect x={6} y={26} width={16} height={16} rx={3.5} fill={body} />
      <rect x={26} y={26} width={16} height={16} rx={3.5} fill={accent} />
    </>
  ),
  settings: ({ body }) => <path fillRule="evenodd" d={GEAR} fill={body} />,
  notifications: ({ body, accent }) => (
    <>
      <path d="M24 5a13 13 0 0 0-13 13v8.5L7 33.5A2 2 0 0 0 8.7 36.5h30.6a2 2 0 0 0 1.7-3L37 26.5V18A13 13 0 0 0 24 5z" fill={body} />
      <path d="M18.5 39.5a5.5 5.5 0 0 0 11 0z" fill={accent} />
    </>
  ),
  dashboard: ({ body, accent, knock }) => (
    <>
      <path d="M4 30a20 20 0 0 1 40 0v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill={body} />
      <path d="M24 30 32.5 18" stroke={accent} strokeWidth={4} {...round} />
      <circle cx={24} cy={30} r={4} fill={knock} />
    </>
  ),
  transactions: ({ body, accent, knock }) => (
    <>
      <path d="M6 16h24v26H6z" fill={body} />
      <path d="M30 6h12v36H30z" fill={accent} />
      <path d="M18 5 3 16h30z" fill={body} />
      {[21, 29].map((y) => [11, 20].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width={5} height={5} rx={1} fill={knock} />))}
      <rect x={34} y={12} width={4} height={4} rx={1} fill={knock} />
      <rect x={34} y={20} width={4} height={4} rx={1} fill={knock} />
    </>
  ),
  more: ({ body, accent }) => (
    <>
      <circle cx={10} cy={24} r={4.5} fill={body} />
      <circle cx={24} cy={24} r={4.5} fill={accent} />
      <circle cx={38} cy={24} r={4.5} fill={body} />
    </>
  ),
} satisfies Record<string, Glyph>;

export type ProductIconName = keyof typeof GLYPHS;
export const PRODUCT_ICON_NAMES = Object.keys(GLYPHS) as ProductIconName[];

export function ProductIcon({ name, tone = "brand", size = 24, className, title }: { name: ProductIconName; tone?: IconTone; size?: number; className?: string; title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradient = `sc-g-${id}`;
  const paint: Paint = { body: `url(#${gradient})`, accent: "var(--i-accent)", knock: "var(--i-knock)" };
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      style={TONES[tone]}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.35" style={{ stopColor: "var(--i-from)" }} />
          <stop offset="1" style={{ stopColor: "var(--i-to)" }} />
        </linearGradient>
      </defs>
      {GLYPHS[name](paint)}
    </svg>
  );
}

/** The soft white tile the icons sit on in marketing and empty states. */
export function IconTile({ name, size = "md", className }: { name: ProductIconName; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = { sm: "h-11 w-11 rounded-xl", md: "h-16 w-16 rounded-2xl", lg: "h-24 w-24 rounded-[22px]" }[size];
  const glyph = { sm: 22, md: 32, lg: 48 }[size];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-white bg-gradient-to-b from-white to-[#f4f6f9] shadow-[0_1px_2px_rgb(3_42_82/0.06),0_8px_24px_-8px_rgb(3_42_82/0.18)]",
        box,
        className,
      )}
    >
      <ProductIcon name={name} size={glyph} />
    </span>
  );
}
