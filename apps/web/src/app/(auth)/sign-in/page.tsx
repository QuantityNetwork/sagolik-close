import { safeRedirectPath } from "@sagolik/security";
import { AUTOPILOT_PERSONA_KEYS, BUSINESS_PERSONA_KEYS, DEMO_PERSONAS, DEMO_PASSWORD, getRuntime } from "@sagolik/core";
import { Alert, Field, Input, ParticipantAvatar } from "@sagolik/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { demoSignIn, magicLinkSignIn, oauthSignIn, passwordSignIn, signUp, ssoSignIn } from "@/app/actions/auth";
import { Logo } from "@/components/brand";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Guilloche } from "@/components/landing/exhibits";
import { delay, stagger } from "@/lib/motion";
import { getActor } from "@/lib/server/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; signed_out?: string; intent?: string; mode?: string }> }) {
  const sp = await searchParams;
  const actor = await getActor();
  if (actor) redirect(safeRedirectPath(sp.next));
  const rt = await getRuntime();
  const supabase = rt.mode === "supabase";
  const oauth = (process.env.AUTH_OAUTH_PROVIDERS ?? "").split(",").map((s) => s.trim()).filter((p): p is "google" | "azure" => p === "google" || p === "azure");
  const next = sp.next ?? "";
  const creating = sp.mode === "create";

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(380px,0.8fr)_1.2fr]">
      <aside className="relative hidden overflow-hidden bg-navy-900 text-white lg:block">
        <Guilloche id="g-signin" className="absolute inset-0 h-full w-full opacity-50" tone="light" lines={14} height={240} />
        <div className="absolute inset-0 bg-gradient-to-b from-navy-900/70 via-navy-900/85 to-navy-950" />
        <div className="sticky top-0 flex h-screen flex-col justify-between p-12">
          <div className="relative">
            <Logo variant="light" className="h-9 w-auto" />
          </div>
          <div className="relative">
            <p className="kicker enter text-brass-300">Sagolik Close</p>
            <p className="enter mt-6 font-display text-[44px] leading-[1.04] tracking-[-0.02em]" style={delay(80)}>
              From decision
              <br />
              to <em className="italic text-brass-100">ownership.</em>
            </p>
            <ul className="mt-10 space-y-4 border-t border-white/15 pt-6 text-[14px] text-white/70">
              {[
                "We never ask for your banking password.",
                "Payment details change only with a second person and a waiting period.",
                "Funds stay with your licensed escrow or title partner.",
              ].map((line, i) => (
                <li key={line} className="enter flex gap-3" style={delay(250 + i * 90)}>
                  <span className="font-display text-[13px] italic text-brass-300">{["i", "ii", "iii"][i]}.</span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-[12px] text-white/40">© {new Date().getFullYear()} Sagolik</p>
        </div>
      </aside>
      <main id="main" className="px-4 pt-8 pb-16 sm:px-10 lg:px-16 lg:pt-20">
        <div className="lg:hidden">
          <Logo className="h-8 w-auto" />
        </div>
        <section className="mt-10 max-w-md lg:mt-0">
          <p className="kicker">{creating ? "New account" : "Secure sign-in"}</p>
          <h1 className="mt-4 text-[42px] leading-[1.05] tracking-[-0.02em] text-navy-900">{creating ? "Create your account" : sp.intent === "start" ? "Start your closing" : "Welcome back"}</h1>
          <p className="mt-4 text-[15.5px] leading-relaxed text-ink-2">
            {sp.intent === "start"
              ? "Sign in to open a transaction or join one you've been invited to. Buyers and sellers are usually invited by their agent or escrow officer."
              : "Sign in to see your closing, your documents and what needs you next."}
          </p>
          {sp.signed_out ? (
            <Alert tone="done" className="mt-6">
              You've been signed out.
            </Alert>
          ) : null}

          {supabase ? (
            <div className="mt-8 space-y-6">
              {creating ? (
                <ActionForm action={signUp} className="space-y-4">
                  <Field label="Full name" htmlFor="fullName">
                    <Input id="fullName" name="fullName" autoComplete="name" required />
                  </Field>
                  <Field label="Email" htmlFor="email">
                    <Input id="email" name="email" type="email" autoComplete="email" required />
                  </Field>
                  <Field label="Password" htmlFor="password" hint="At least 8 characters. Use a password manager.">
                    <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
                  </Field>
                  <SubmitButton className="w-full" pendingLabel="Creating…">
                    Create account
                  </SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={passwordSignIn} className="space-y-4">
                  <input type="hidden" name="next" value={next} />
                  <Field label="Email" htmlFor="email">
                    <Input id="email" name="email" type="email" autoComplete="username" required />
                  </Field>
                  <Field label="Password" htmlFor="password">
                    <Input id="password" name="password" type="password" autoComplete="current-password" required />
                  </Field>
                  <SubmitButton className="w-full" pendingLabel="Signing in…">
                    Sign in
                  </SubmitButton>
                </ActionForm>
              )}
              <details className="smooth group rounded-card border border-line bg-paper px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-navy-800 marker:text-brass-600">Email me a sign-in link instead</summary>
                <ActionForm action={magicLinkSignIn} className="mt-3 space-y-3">
                  <input type="hidden" name="next" value={next} />
                  <Field label="Email" htmlFor="ml-email">
                    <Input id="ml-email" name="email" type="email" autoComplete="email" required />
                  </Field>
                  <SubmitButton variant="secondary" className="w-full">
                    Send link
                  </SubmitButton>
                </ActionForm>
              </details>
              {oauth.length ? (
                <div className="grid gap-2">
                  {oauth.map((p) => (
                    <ActionForm key={p} action={oauthSignIn}>
                      <input type="hidden" name="provider" value={p} />
                      <SubmitButton variant="secondary" className="w-full">
                        Continue with {p === "google" ? "Google Workspace" : "Microsoft Entra ID"}
                      </SubmitButton>
                    </ActionForm>
                  ))}
                </div>
              ) : null}
              <details className="smooth group rounded-card border border-line bg-paper px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-navy-800 marker:text-brass-600">Sign in with your organization (SSO)</summary>
                <ActionForm action={ssoSignIn} className="mt-3 space-y-3">
                  <Field label="Company email domain" htmlFor="domain">
                    <Input id="domain" name="domain" placeholder="example.com" required />
                  </Field>
                  <SubmitButton variant="secondary" className="w-full">
                    Continue
                  </SubmitButton>
                </ActionForm>
              </details>
              <p className="text-sm text-ink-3">
                {creating ? (
                  <>
                    Already have an account? <Link href="/sign-in" className="font-medium text-teal-700">Sign in</Link>
                  </>
                ) : (
                  <>
                    New to Sagolik Close? <Link href="/sign-in?mode=create" className="font-medium text-teal-700">Create an account</Link>
                  </>
                )}
              </p>
              {rt.env.demoMode ? <p className="text-[12px] text-ink-3">Local demo accounts use the password “{DEMO_PASSWORD}”.</p> : null}
            </div>
          ) : (
            <Alert tone="info" className="mt-8" title="Demo environment">
              Supabase isn't configured, so this instance runs the fictional demo with sandbox providers. Choose a person to see Sagolik Close from their side. Configure Supabase (see README) for real email, magic-link, SSO and MFA sign-in.
            </Alert>
          )}
        </section>

        {rt.env.demoMode ? (
          <section aria-labelledby="personas-title" className="mt-14 max-w-3xl border-t-2 border-navy-800 pt-6">
                <p className="exhibit-label">Demo environment</p>
                <h2 id="personas-title" className="mt-1 text-[28px] text-navy-900">
                  Explore as…
                </h2>
                <p className="mt-1 text-sm text-ink-3">Fictional people on fictional transactions. Nothing is sent or moved.</p>
                {[
                  { key: "home", label: "Home closing", people: DEMO_PERSONAS.filter((p) => !BUSINESS_PERSONA_KEYS.includes(p.key) && !AUTOPILOT_PERSONA_KEYS.includes(p.key)) },
                  { key: "autopilot", label: "After closing: Property Autopilot", people: DEMO_PERSONAS.filter((p) => AUTOPILOT_PERSONA_KEYS.includes(p.key)) },
                  { key: "business", label: "Business acquisition (beta)", people: DEMO_PERSONAS.filter((p) => BUSINESS_PERSONA_KEYS.includes(p.key)) },
                ].map((group) => (
                  <div key={group.key} className="mt-8">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-brass-700">{group.label}</p>
                    <ul data-reveal className="mt-3 grid gap-2 sm:grid-cols-2">
                  {group.people.map((p, i) => (
                    <li key={p.key} className="follow" style={stagger(i)}>
                      <ActionForm action={demoSignIn}>
                        <input type="hidden" name="persona" value={p.key} />
                        <input type="hidden" name="next" value={next} />
                        <button
                          type="submit"
                          className="group flex w-full items-start gap-3 rounded-card border border-line bg-paper p-3.5 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-navy-800/40 hover:shadow-[var(--shadow-float)] focus-visible:border-teal-600"
                          data-testid={`persona-${p.key}`}
                        >
                          <ParticipantAvatar name={p.name} size={36} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-ink">{p.name}</span>
                            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-700">{p.title}</span>
                            <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{p.description}</span>
                          </span>
                        </button>
                      </ActionForm>
                    </li>
                  ))}
                    </ul>
                  </div>
                ))}
          </section>
        ) : null}
      </main>
    </div>
  );
}
