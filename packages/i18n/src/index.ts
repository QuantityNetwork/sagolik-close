/**
 * Internationalisation. English is the source catalogue; sv / pl / de must
 * provide every key (enforced by the type below and by a unit test).
 * Dates, numbers and money always go through Intl with the active locale.
 */
import type { Locale } from "@sagolik/types";

const en = {
  "nav.home": "Home",
  "nav.transactions": "Transactions",
  "nav.commandCenter": "Command center",
  "nav.tasks": "Tasks",
  "nav.documents": "Documents",
  "nav.messages": "Messages",
  "nav.money": "Money",
  "nav.more": "More",
  "nav.homeRecord": "Home Record",
  "nav.autopilot": "Autopilot",
  "nav.notifications": "Notifications",
  "nav.settings": "Settings",
  "nav.admin": "Admin",
  "nav.signOut": "Sign out",
  "nav.newTransaction": "New transaction",
  "greeting.morning": "Good morning, {name}.",
  "greeting.afternoon": "Good afternoon, {name}.",
  "greeting.evening": "Good evening, {name}.",
  "home.closing": "Closing {date}",
  "home.percentComplete": "Your closing is {percent}% complete.",
  "home.nextStep": "Next step",
  "home.estimatedTime": "Estimated time: {minutes} minutes",
  "home.nothingToDo": "Nothing needs you right now. We'll let you know when something does.",
  "home.timeline": "Timeline",
  "home.money": "Money",
  "home.people": "People",
  "home.documents": "Documents",
  "home.documentsSummary": "{complete} complete · {attention} require attention",
  "home.askAssistant": "Ask about your closing",
  "common.viewAll": "View all",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.continue": "Continue",
  "common.loading": "Loading…",
  "common.sandbox": "Sandbox",
  "demo.banner": "Demo environment — fictional people, properties and money. Sandbox providers only; nothing is sent or moved.",
  "stepup.title": "Confirm it's you",
  "stepup.body": "For your security, we ask you to confirm your identity before sensitive actions like moving money or changing payment details.",
} as const;

export type MessageKey = keyof typeof en;
type Catalogue = Record<MessageKey, string>;

const sv: Catalogue = {
  "nav.home": "Hem",
  "nav.transactions": "Affärer",
  "nav.commandCenter": "Översikt",
  "nav.tasks": "Uppgifter",
  "nav.documents": "Dokument",
  "nav.messages": "Meddelanden",
  "nav.money": "Pengar",
  "nav.more": "Mer",
  "nav.homeRecord": "Hemboken",
  "nav.autopilot": "Autopilot",
  "nav.notifications": "Aviseringar",
  "nav.settings": "Inställningar",
  "nav.admin": "Admin",
  "nav.signOut": "Logga ut",
  "nav.newTransaction": "Ny affär",
  "greeting.morning": "God morgon, {name}.",
  "greeting.afternoon": "God eftermiddag, {name}.",
  "greeting.evening": "God kväll, {name}.",
  "home.closing": "Tillträde {date}",
  "home.percentComplete": "Din affär är {percent}% klar.",
  "home.nextStep": "Nästa steg",
  "home.estimatedTime": "Beräknad tid: {minutes} minuter",
  "home.nothingToDo": "Inget behöver göras av dig just nu. Vi hör av oss när något gör det.",
  "home.timeline": "Tidslinje",
  "home.money": "Pengar",
  "home.people": "Personer",
  "home.documents": "Dokument",
  "home.documentsSummary": "{complete} klara · {attention} kräver uppmärksamhet",
  "home.askAssistant": "Fråga om din affär",
  "common.viewAll": "Visa alla",
  "common.save": "Spara",
  "common.cancel": "Avbryt",
  "common.continue": "Fortsätt",
  "common.loading": "Laddar…",
  "common.sandbox": "Sandlåda",
  "demo.banner": "Demomiljö — fiktiva personer, fastigheter och pengar. Endast sandlådeleverantörer; inget skickas eller flyttas.",
  "stepup.title": "Bekräfta att det är du",
  "stepup.body": "För din säkerhet ber vi dig bekräfta din identitet innan känsliga åtgärder, som att flytta pengar eller ändra betalningsuppgifter.",
};

const pl: Catalogue = {
  "nav.home": "Start",
  "nav.transactions": "Transakcje",
  "nav.commandCenter": "Centrum",
  "nav.tasks": "Zadania",
  "nav.documents": "Dokumenty",
  "nav.messages": "Wiadomości",
  "nav.money": "Finanse",
  "nav.more": "Więcej",
  "nav.homeRecord": "Księga domu",
  "nav.autopilot": "Autopilot",
  "nav.notifications": "Powiadomienia",
  "nav.settings": "Ustawienia",
  "nav.admin": "Administracja",
  "nav.signOut": "Wyloguj",
  "nav.newTransaction": "Nowa transakcja",
  "greeting.morning": "Dzień dobry, {name}.",
  "greeting.afternoon": "Dzień dobry, {name}.",
  "greeting.evening": "Dobry wieczór, {name}.",
  "home.closing": "Finalizacja {date}",
  "home.percentComplete": "Twoja transakcja jest ukończona w {percent}%.",
  "home.nextStep": "Następny krok",
  "home.estimatedTime": "Szacowany czas: {minutes} min",
  "home.nothingToDo": "Nic nie wymaga teraz Twojej uwagi. Damy znać, gdy się to zmieni.",
  "home.timeline": "Oś czasu",
  "home.money": "Finanse",
  "home.people": "Osoby",
  "home.documents": "Dokumenty",
  "home.documentsSummary": "{complete} gotowe · {attention} wymaga uwagi",
  "home.askAssistant": "Zapytaj o swoją transakcję",
  "common.viewAll": "Pokaż wszystko",
  "common.save": "Zapisz",
  "common.cancel": "Anuluj",
  "common.continue": "Dalej",
  "common.loading": "Ładowanie…",
  "common.sandbox": "Piaskownica",
  "demo.banner": "Środowisko demonstracyjne — fikcyjne osoby, nieruchomości i pieniądze. Wyłącznie dostawcy testowi; nic nie jest wysyłane ani przelewane.",
  "stepup.title": "Potwierdź, że to Ty",
  "stepup.body": "Dla Twojego bezpieczeństwa prosimy o potwierdzenie tożsamości przed wrażliwymi działaniami, takimi jak przelew środków lub zmiana danych płatności.",
};

const de: Catalogue = {
  "nav.home": "Start",
  "nav.transactions": "Transaktionen",
  "nav.commandCenter": "Leitstand",
  "nav.tasks": "Aufgaben",
  "nav.documents": "Dokumente",
  "nav.messages": "Nachrichten",
  "nav.money": "Finanzen",
  "nav.more": "Mehr",
  "nav.homeRecord": "Hausakte",
  "nav.autopilot": "Autopilot",
  "nav.notifications": "Benachrichtigungen",
  "nav.settings": "Einstellungen",
  "nav.admin": "Verwaltung",
  "nav.signOut": "Abmelden",
  "nav.newTransaction": "Neue Transaktion",
  "greeting.morning": "Guten Morgen, {name}.",
  "greeting.afternoon": "Guten Tag, {name}.",
  "greeting.evening": "Guten Abend, {name}.",
  "home.closing": "Abschluss am {date}",
  "home.percentComplete": "Ihr Abschluss ist zu {percent} % erledigt.",
  "home.nextStep": "Nächster Schritt",
  "home.estimatedTime": "Geschätzte Dauer: {minutes} Minuten",
  "home.nothingToDo": "Im Moment ist nichts von Ihnen erforderlich. Wir melden uns, sobald sich das ändert.",
  "home.timeline": "Zeitleiste",
  "home.money": "Finanzen",
  "home.people": "Beteiligte",
  "home.documents": "Dokumente",
  "home.documentsSummary": "{complete} erledigt · {attention} erfordern Aufmerksamkeit",
  "home.askAssistant": "Fragen zu Ihrem Abschluss",
  "common.viewAll": "Alle anzeigen",
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
  "common.continue": "Weiter",
  "common.loading": "Wird geladen…",
  "common.sandbox": "Sandbox",
  "demo.banner": "Demo-Umgebung — fiktive Personen, Immobilien und Beträge. Nur Sandbox-Anbieter; es wird nichts versendet oder überwiesen.",
  "stepup.title": "Bestätigen Sie, dass Sie es sind",
  "stepup.body": "Zu Ihrer Sicherheit bitten wir Sie, Ihre Identität vor sensiblen Aktionen wie Zahlungen oder dem Ändern von Zahlungsdaten zu bestätigen.",
};

export const CATALOGUES: Record<Locale, Catalogue> = { en, sv, pl, de };

export const LOCALE_TAGS: Record<Locale, string> = { en: "en-US", sv: "sv-SE", pl: "pl-PL", de: "de-DE" };
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", sv: "Svenska", pl: "Polski", de: "Deutsch" };

export function t(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = CATALOGUES[locale]?.[key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export function translator(locale: Locale) {
  return (key: MessageKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}

export function formatDate(iso: string, locale: Locale, opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" }) {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { timeZone: "UTC", ...opts }).format(d);
}

export function formatDateTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function formatRelative(iso: string, locale: Locale, now = Date.now()) {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(LOCALE_TAGS[locale], { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso, locale, { month: "short", day: "numeric", year: "numeric" });
}

export function greetingKey(hour: number): MessageKey {
  return hour < 12 ? "greeting.morning" : hour < 18 ? "greeting.afternoon" : "greeting.evening";
}

export function resolveLocale(input: string | null | undefined): Locale {
  const base = (input ?? "").toLowerCase().split(/[-_,;]/)[0];
  return base === "sv" || base === "pl" || base === "de" ? base : "en";
}
