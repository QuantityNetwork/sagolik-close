import { getRuntime, listTransactionsForActor, moneyView, ROLE_LABELS, transactionView } from "@sagolik/core";
import { formatDate, greetingKey, translator } from "@sagolik/i18n";
import { isPrincipal } from "@sagolik/auth";
import { buttonClasses, Card, EmptyState, formatMoney, ParticipantAvatar } from "@sagolik/ui";
import { ArrowRight, Check, Circle, CircleDot, FileText } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Assistant } from "@/components/app/assistant";
import { TaskAction } from "@/components/app/next-step";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const { ctx, actor } = await requireContext("/app");
  const rt = await getRuntime();
  const profile = await rt.serviceDb.profiles.get(actor.userId);
  const locale = profile?.locale ?? "en";
  const t = translator(locale);
  const items = await listTransactionsForActor(ctx);
  const active = items.filter((i) => !["closed", "cancelled"].includes(i.snapshot.transaction.state));
  const principal = active.find((i) => i.myRoles.some(isPrincipal));

  if (!principal) {
    if (actor.memberships.length > 0 || active.length > 0) redirect("/app/command-center");
    const closed = items.find((i) => i.snapshot.transaction.state === "closed");
    return (
      <div className="container-page py-10">
        <h1 className="text-[34px] text-navy-800">{t(greetingKey(new Date().getHours()), { name: actor.displayName.split(" ")[0]! })}</h1>
        <Card className="mt-8">
          <EmptyState title="No active closings yet" icon={<FileText className="h-8 w-8" aria-hidden />} action={closed ? <Link href="/app/ownership" className={buttonClasses("primary")}>Open your Home Record</Link> : undefined}>
            When your agent, lender or escrow officer invites you to a transaction, it appears here. Invitations are sent to {actor.email}.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const s = principal.snapshot;
  const view = transactionView(ctx, s);
  const myAccounts = await ctx.db.bank_accounts.find({ userId: actor.userId });
  const money = moneyView(s, myAccounts, new Date().toISOString());
  const cur = s.transaction.currency;
  const txBase = `/app/transactions/${s.transaction.id}`;
  const verifiedAccount = myAccounts.find((a) => a.ownershipVerified);
  const connection = verifiedAccount ? await ctx.db.bank_connections.get(verifiedAccount.connectionId) : null;
  const canSeeMoney = view.permissions.includes("financial.view");

  return (
    <div className="container-page animate-rise py-8 lg:py-10">
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <section aria-labelledby="closing-title" className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper">
            <div className="grid sm:grid-cols-[1fr_200px]">
              <div className="p-6">
                <p className="text-sm text-ink-3">{t(greetingKey(new Date().getHours()), { name: actor.displayName.split(" ")[0]! })}</p>
                <h1 id="closing-title" className="mt-1 text-[32px] leading-tight text-navy-800">
                  {s.property.addressLine1}
                </h1>
                <p className="text-sm text-ink-3">
                  {s.property.city}
                  {s.property.region ? `, ${s.property.region}` : ""} · {s.transaction.expectedClosingDate ? t("home.closing", { date: formatDate(s.transaction.expectedClosingDate, locale) }) : "Closing date to be confirmed"}
                </p>
                <p className="mt-5 text-[17px] text-ink-2">{t("home.percentComplete", { percent: view.progress })}</p>
                <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-navy-100" role="progressbar" aria-valuenow={view.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Closing progress">
                  <div className="h-full rounded-full bg-teal-600" style={{ width: `${view.progress}%` }} />
                </div>
              </div>
              {s.property.imageUrls[0] ? (
                <div className="relative hidden sm:block">
                  <Image src={s.property.imageUrls[0]} alt={`Photo of ${s.property.addressLine1}`} fill sizes="200px" className="object-cover" />
                </div>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="next-title" className="rounded-[var(--radius-card)] bg-navy-800 p-6 text-white">
            <p id="next-title" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300">
              {t("home.nextStep")}
            </p>
            {view.nextAction ? (
              <>
                <p className="mt-2 font-display text-[26px] leading-tight">{view.nextAction.title}</p>
                {view.nextAction.description ? <p className="mt-1 max-w-xl text-sm text-white/75">{view.nextAction.description}</p> : null}
                {view.nextAction.estimatedMinutes ? <p className="mt-1 text-sm text-white/60">{t("home.estimatedTime", { minutes: view.nextAction.estimatedMinutes })}</p> : null}
                <div className="mt-5">
                  <TaskAction task={view.nextAction} transactionId={s.transaction.id} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-lg text-white/85">{t("home.nothingToDo")}</p>
            )}
          </section>

          <section aria-labelledby="timeline-title" className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
            <div className="flex items-center justify-between">
              <h2 id="timeline-title" className="font-sans text-[15px] font-semibold text-ink">
                {t("home.timeline")}
              </h2>
              <Link href={txBase} className="text-sm font-medium text-teal-700 hover:underline">
                {t("common.viewAll")}
              </Link>
            </div>
            <ol className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {view.timeline.map((m) => (
                <li key={m.key} className="flex items-center gap-2.5 text-sm">
                  {m.complete ? <Check className="h-4 w-4 text-teal-600" aria-hidden /> : m.current ? <CircleDot className="h-4 w-4 text-navy-800" aria-hidden /> : <Circle className="h-4 w-4 text-ink-4" aria-hidden />}
                  <span className={m.complete ? "text-ink-2" : m.current ? "font-semibold text-navy-800" : "text-ink-3"}>{m.label}</span>
                  <span className="sr-only">{m.complete ? "complete" : m.current ? "in progress" : "upcoming"}</span>
                </li>
              ))}
            </ol>
          </section>

          <Assistant transactionId={s.transaction.id} title={t("home.askAssistant")} />
        </div>

        <div className="space-y-6">
          {canSeeMoney ? (
            <section aria-labelledby="money-title" className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
              <div className="flex items-center justify-between">
                <h2 id="money-title" className="font-sans text-[15px] font-semibold text-ink">
                  {t("home.money")}
                </h2>
                <Link href={`${txBase}/money`} className="text-sm font-medium text-teal-700 hover:underline">
                  {t("common.viewAll")}
                </Link>
              </div>
              <dl className="mt-3 divide-y divide-line text-sm num">
                {[
                  ["Purchase price", formatMoney(money.purchasePrice, cur)],
                  ...(money.loanAmount ? [["Mortgage", formatMoney(money.loanAmount, cur)]] : []),
                  ["Deposit", formatMoney(money.depositSettled, cur)],
                  ["Remaining at closing", formatMoney(money.remainingAtClosing, cur)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className={k === "Remaining at closing" ? "font-semibold text-navy-800" : "font-medium text-ink"}>{v}</dd>
                  </div>
                ))}
              </dl>
              {verifiedAccount && connection ? (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-canvas px-3 py-2.5 text-sm">
                  <span>
                    <span className="font-medium text-ink">{connection.institutionName}</span> <span className="text-ink-3 num">•••• {verifiedAccount.mask}</span>
                  </span>
                  <span className="text-[12px] font-medium text-success">Verified</span>
                </div>
              ) : null}
              <p className="mt-3 text-[12px] text-ink-3">Estimated from the purchase price, loan and settled deposit. Your approved closing statement is final.</p>
            </section>
          ) : null}

          <section aria-labelledby="people-title" className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
            <div className="flex items-center justify-between">
              <h2 id="people-title" className="font-sans text-[15px] font-semibold text-ink">
                {t("home.people")}
              </h2>
              <Link href={`${txBase}/people`} className="text-sm font-medium text-teal-700 hover:underline">
                {t("common.viewAll")}
              </Link>
            </div>
            <ul className="mt-3 space-y-2.5">
              {view.people.slice(0, 8).map((p) => (
                <li key={p.participant.id} className="flex items-center gap-3">
                  <ParticipantAvatar name={p.participant.displayName} size={30} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium text-ink">
                      {p.participant.displayName}
                      {p.isMe ? <span className="text-ink-3"> (you)</span> : null}
                    </p>
                    <p className="text-[12px] text-ink-3">{ROLE_LABELS[p.participant.role]}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="docs-title" className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
            <h2 id="docs-title" className="font-sans text-[15px] font-semibold text-ink">
              {t("home.documents")}
            </h2>
            <p className="mt-2 text-sm text-ink-2">{t("home.documentsSummary", { complete: view.documents.complete, attention: view.documents.needsAttention })}</p>
            <Link href={`${txBase}/documents`} className={buttonClasses("secondary", "sm", "mt-4")}>
              Open documents <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </section>

          {active.length > 1 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
              <h2 className="font-sans text-[15px] font-semibold text-ink">Your other transactions</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {active
                  .filter((i) => i !== principal)
                  .map((i) => (
                    <li key={i.snapshot.transaction.id}>
                      <Link href={`/app/transactions/${i.snapshot.transaction.id}`} className="text-teal-700 hover:underline">
                        {i.snapshot.property.addressLine1}
                      </Link>
                      <span className="text-ink-3"> · {i.myRoles.map((r) => ROLE_LABELS[r]).join(", ")}</span>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
