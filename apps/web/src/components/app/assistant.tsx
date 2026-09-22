"use client";
/**
 * Sagolik Assistant — answers from structured transaction data, with links to
 * its sources. It can explain; it cannot act on money, signatures or ownership.
 */
import { buttonClasses, cn } from "@sagolik/ui";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface Answer {
  answer: string;
  bullets: string[];
  sources: Array<{ label: string; href: string }>;
  declined: boolean;
}

const SUGGESTIONS = ["What is holding up my closing?", "What do I need to do next?", "Where is my money?", "When do I become the owner?"];

export function Assistant({ transactionId, title }: { transactionId: string; title: string }) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/transactions/${transactionId}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error?.message ?? "The assistant couldn't answer right now.");
      else setAnswer(json.data as Answer);
    } catch {
      setError("The assistant couldn't answer right now.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="assistant-title" className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <h2 id="assistant-title" className="flex items-center gap-2 font-sans text-[15px] font-semibold text-ink">
        <Sparkles className="h-4 w-4 text-teal-600" aria-hidden /> {title}
      </h2>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="assistant-q" className="sr-only">
          Your question
        </label>
        <input
          id="assistant-q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="e.g. What is holding up my closing?"
          className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-paper px-3 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
        />
        <button type="submit" className={buttonClasses("primary", "md")} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Ask"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setQuestion(s);
              void ask(s);
            }}
            className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:border-teal-600/40 hover:text-navy-800"
          >
            {s}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {answer ? (
          <div className={cn("mt-4 rounded-lg p-4 text-sm", answer.declined ? "bg-attention-50" : "bg-canvas")}>
            <p className="text-ink">{answer.answer}</p>
            {answer.bullets.length ? (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
                {answer.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ol>
            ) : null}
            {answer.sources.length ? (
              <p className="mt-3 flex flex-wrap gap-3 text-[13px]">
                {answer.sources.map((s) => (
                  <Link key={s.href} href={s.href} className="font-medium text-teal-700 hover:underline">
                    {s.label} →
                  </Link>
                ))}
              </p>
            ) : null}
            <p className="mt-3 text-[11px] text-ink-3">Answers come from your transaction's live records. The assistant never moves money, signs or approves anything.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
