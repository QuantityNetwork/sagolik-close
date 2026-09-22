/**
 * Document intelligence (step 6–8 of the upload pipeline).
 *
 * Deterministic classification + field extraction from the text layer.
 * Every extracted value is a SUGGESTION (`verified: false`) until a person
 * confirms it. OCR for scanned images and optional AI extraction plug in via
 * `DocumentExtractor`; they produce the same suggestion shape.
 */
import type { DocumentCategory, ExtractedField } from "@sagolik/types";

export interface DocumentExtractor {
  extract(input: { bytes: Uint8Array; mimeType: string; filename: string }): Promise<{ suggestedCategory: DocumentCategory | null; fields: ExtractedField[] }>;
}

const CATEGORY_HINTS: Array<[DocumentCategory, RegExp]> = [
  ["purchase_agreement", /(purchase (and sale )?agreement|sales contract|köpekontrakt|kaufvertrag|umowa)/i],
  ["closing_statement", /(closing (statement|disclosure)|settlement statement|alta)/i],
  ["deed", /(warranty deed|grant deed|\bdeed\b|köpebrev|akt notarialny|auflassung)/i],
  ["disclosure", /(disclosure|seller'?s? disclosure)/i],
  ["inspection", /(inspection report|home inspection|besiktning)/i],
  ["appraisal", /(appraisal|valuation report|värdering)/i],
  ["title", /(title (commitment|report|search|policy)|grundbuch|księga)/i],
  ["mortgage", /(loan estimate|mortgage|promissory note|pantbrev)/i],
  ["insurance", /(insurance|binder|declarations page)/i],
  ["tax", /(tax (bill|statement|return)|stämpelskatt|grunderwerbsteuer)/i],
  ["identity", /(passport|driver'?s? licen[cs]e|national id)/i],
  ["power_of_attorney", /(power of attorney|fullmakt|vollmacht)/i],
];

const MONEY = /(?:\$|USD|EUR|€|SEK|kr|PLN|CHF)\s?([0-9]{1,3}(?:[, ][0-9]{3})+(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/g;
const DATE_ISO = /\b(20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\b/g;
const DATE_US = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/(20[0-9]{2})\b/g;
const PARCEL = /\b(?:parcel|apn|pin|fastighetsbeteckning)[\s#:]*([A-Z0-9][A-Z0-9-]{4,24})/i;

/** Pulls the readable text layer out of a PDF/plain file (best effort, no rendering). */
export function textLayer(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes.slice(0, 2_000_000));
  const fromParens = [...raw.matchAll(/\(([^()\\]{2,200})\)\s*Tj/g)].map((m) => m[1]).join(" ");
  const comments = [...raw.matchAll(/^%\s?(.+)$/gm)].map((m) => m[1]).join(" ");
  return `${fromParens} ${comments} ${raw.replace(/[^\x20-\x7e\n]/g, " ")}`.slice(0, 200_000);
}

export class RuleBasedExtractor implements DocumentExtractor {
  async extract(input: { bytes: Uint8Array; mimeType: string; filename: string }) {
    const text = `${input.filename} ${input.mimeType.startsWith("image/") ? "" : textLayer(input.bytes)}`;
    const suggestedCategory = CATEGORY_HINTS.find(([, re]) => re.test(text))?.[0] ?? null;
    const fields: ExtractedField[] = [];
    const amounts = [...text.matchAll(MONEY)].map((m) => m[1]!.replace(/[ ,]/g, ""));
    if (amounts.length) {
      const largest = amounts.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => b - a)[0];
      if (largest) fields.push({ key: "largest_amount", value: String(largest), confidence: 0.55, verified: false });
    }
    const dates = [
      ...[...text.matchAll(DATE_ISO)].map((m) => m[0]),
      ...[...text.matchAll(DATE_US)].map((m) => `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`),
    ];
    for (const d of [...new Set(dates)].slice(0, 5)) fields.push({ key: "date", value: d, confidence: 0.6, verified: false });
    const parcel = text.match(PARCEL);
    if (parcel?.[1]) fields.push({ key: "parcel_id", value: parcel[1], confidence: 0.7, verified: false });
    if (/sign(ature)?\s*(here|line)|x_{5,}|\/sig\b/i.test(text)) fields.push({ key: "has_signature_fields", value: "true", confidence: 0.5, verified: false });
    return { suggestedCategory, fields };
  }
}
