import { getRuntime } from "@sagolik/core";
import { SiteHeader } from "@/components/landing/site-header";
import {
  Banking,
  BrighterTomorrow,
  BuyerExperience,
  EscrowSignaturesVault,
  Faq,
  FinalCta,
  Hero,
  HowItWorks,
  Integrations,
  Journey,
  Modules,
  Ownership,
  Parties,
  Pricing,
  ProfessionalExperience,
  Security,
  SellerExperience,
  SiteFooter,
  PilotProgram,
  TrustRail,
} from "@/components/landing/sections";

export default async function LandingPage() {
  const rt = await getRuntime();
  const plans = (await rt.serviceDb.plans.find({ active: true }, { orderBy: "sortOrder" })).map((p) => ({ key: p.key, name: p.name, audience: p.audience, features: p.features }));
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <TrustRail />
        <HowItWorks />
        <Modules />
        <Journey />
        <BuyerExperience />
        <SellerExperience />
        <ProfessionalExperience />
        <Banking />
        <Security />
        <EscrowSignaturesVault />
        <Ownership />
        <BrighterTomorrow />
        <Parties />
        <Integrations />
        <PilotProgram />
        <Pricing plans={plans} />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
