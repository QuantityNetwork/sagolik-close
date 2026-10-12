# Design system

Sagolik Close is set like a well-made report: navy ink on ivory paper, serif headlines, hairline rules, crisp corners and exhibits that explain how the product works. The tone is formal and factual, the way an advisory firm, a law firm or a bank presents itself.

## Tokens (`apps/web/src/app/globals.css`)

| | |
|---|---|
| **Colour** | `navy-*` for ink and dark surfaces (primary `navy-800`), `canvas` (ivory) and `paper` (white) for surfaces, `teal-*` for signals and progress, `brass-*` for editorial detail only (kickers, numerals, rules, exhibit labels). Status colours (`success`, `attention`, `danger`) carry meaning, never decoration. |
| **Type** | Source Serif 4 (variable, optical sizing) for headlines, numerals and figures; Inter for UI, forms and tables. Numbers use `num` (tabular, lining). |
| **Shape** | Tailwind's radius scale is overridden: `rounded-lg` is 4px, `rounded-xl` 5px, `rounded-card` 4px, `rounded-control` 3px. Avatars and status dots stay round. |
| **Rules** | Hairlines (`border-line`) separate; a 2px navy top rule (`exhibit`) marks a figure or a key metric. Almost no shadow. |
| **Contrast** | Text meets WCAG AA: small brass text uses `brass-700`, large numerals `brass-600`. `brass-500` and `ink-4` are for rules and decoration, not text. |

Utility classes: `kicker` (section label with a brass rule), `eyebrow`, `section-num`, `link-u` (underline that draws in), `exhibit`, `exhibit-label`, `exhibit-title`, `exhibit-note`.

## Motion

Motion is calm and purposeful: content settles into place once, diagrams draw themselves, data flows quietly along a line. It is always decoration on top of content that is already readable.

- **On load:** `enter`, `enter-fade`, `enter-rule`, `draw-on-load`, with the delay set by `style={delay(ms)}` (`apps/web/src/lib/motion.ts`).
- **On scroll:** mark a block `data-reveal`; inside it, `follow`, `follow-fade`, `draw` (SVG paths with `pathLength={1}`), `grow` and `grow-y` animate in order (`style={stagger(i)}`). `<MotionRoot/>` (in the root layout) reveals each block once with a single IntersectionObserver.
- **Continuous:** `flow` (data moving along a line), `pulse`, the guilloché texture (`<Guilloche/>`) and the scroll-linked header shadow, reading-progress rule and image zoom (CSS scroll-driven animations where supported).
- **Safety:** nothing is hidden until `MotionRoot` runs, so the page is complete without JavaScript. With `prefers-reduced-motion`, nothing is hidden and nothing moves. Browsers without scroll-driven animations get the static page.

## Exhibits and claims

Exhibits (`apps/web/src/components/landing/exhibits.tsx`) depict mechanisms: who holds the money, the life of a payment instruction, the parties around one record. They never show performance figures, and each one says it is illustrative. Product illustrations use only fictional demo data and say so. The claims test (`apps/web/src/claims.test.ts`) fails the build on certification, social-proof or guarantee wording.
