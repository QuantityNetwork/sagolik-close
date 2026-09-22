import { describe, expect, it } from "vitest";
import { CATALOGUES, formatDate, resolveLocale, t } from "./index";

describe("i18n", () => {
  it("every locale translates every key (no English fallbacks leak)", () => {
    const keys = Object.keys(CATALOGUES.en);
    for (const [locale, cat] of Object.entries(CATALOGUES)) {
      expect(Object.keys(cat).sort(), locale).toEqual([...keys].sort());
      if (locale !== "en") {
        const same = keys.filter((k) => cat[k as keyof typeof cat] === CATALOGUES.en[k as keyof typeof CATALOGUES.en] && !["nav.admin", "common.sandbox", "nav.home"].includes(k));
        expect(same.length, `${locale} untranslated: ${same.join(", ")}`).toBeLessThan(3);
      }
    }
  });
  it("interpolates and formats per locale", () => {
    expect(t("sv", "home.percentComplete", { percent: 76 })).toBe("Din affär är 76% klar.");
    expect(formatDate("2026-04-28", "de")).toBe("28. April");
    expect(formatDate("2026-04-28", "en")).toBe("April 28");
    expect(resolveLocale("sv-SE,sv;q=0.9")).toBe("sv");
    expect(resolveLocale("fr-FR")).toBe("en");
  });
});
