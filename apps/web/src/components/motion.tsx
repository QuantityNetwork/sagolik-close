"use client";
/**
 * Motion runtime. One observer for the whole site: elements marked
 * `data-reveal` get `data-revealed` once they scroll into view, and CSS in
 * globals.css does the animating. Content is never hidden unless this has
 * run, so the page stays readable without JavaScript, and nothing animates
 * for people who prefer reduced motion.
 */
import { useEffect, useRef, useState } from "react";

const SELECTOR = "[data-reveal]:not([data-revealed])";

function inView(el: Element) {
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight && r.bottom > 0;
}

export function MotionRoot() {
  useEffect(() => {
    const reveal = (el: Element) => el.setAttribute("data-revealed", "");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      const all = () => document.querySelectorAll(SELECTOR).forEach(reveal);
      all();
      const mo = new MutationObserver(all);
      mo.observe(document.body, { childList: true, subtree: true });
      return () => mo.disconnect();
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          reveal(e.target);
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    let frame = 0;
    const scan = () => {
      frame = 0;
      document.querySelectorAll(SELECTOR).forEach((el) => io.observe(el));
    };
    // What is already on screen stays put; everything below waits its turn.
    document.querySelectorAll(SELECTOR).forEach((el) => {
      if (inView(el)) reveal(el);
    });
    document.documentElement.setAttribute("data-motion", "");
    scan();
    const mo = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(scan);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Counts up to `value` once it scrolls into view. Renders the final value on
 * the server, so the number is right without JavaScript or with reduced
 * motion. Use only for illustrative figures inside product illustrations.
 */
export function CountUp({
  value,
  kind = "number",
  currency = "USD",
  suffix = "",
  duration = 1400,
  className,
}: {
  value: number;
  kind?: "number" | "currency";
  currency?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    let raf = 0;
    setShown(0);
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          setShown(Math.round(value * easeOut(t)));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);
  const text = kind === "currency" ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(shown) : new Intl.NumberFormat("en-US").format(shown);
  return (
    <span ref={ref} className={className}>
      {text}
      {suffix}
    </span>
  );
}
