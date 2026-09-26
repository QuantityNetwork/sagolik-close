/**
 * The fictional bank statement and lender data behind Alex Morgan's demo
 * connection. Everything here is invented. Dates are relative to the day the
 * demo was built (`anchor`, YYYY-MM-DD) so the seed and the sandbox bank agree.
 */
import type { MockBankScript } from "@sagolik/integrations";
import { addDays, addMonths } from "@sagolik/workflow";

export const DEMO_ALEX_BANK = {
  accessToken: "access-sandbox-demo-alex",
  externalConnectionId: "item_demo_alex",
  /** The connection is created this many days before the anchor. */
  connectedDaysAgo: 120,
} as const;

/** The Aspen snow-removal bill Alex reports as paid, and when. */
export function demoSnowRemovalBill(anchor: string): { dueOn: string; paidOn: string } {
  const dueOn = addMonths(addDays(anchor, 8), -1);
  return { dueOn, paidOn: dueOn };
}

const ext = (key: string) => `${DEMO_ALEX_BANK.externalConnectionId}_${key}`;

export function alexBankScript(anchor: string): MockBankScript {
  const d = (offset: number) => addDays(anchor, offset);
  let n = 0;
  const tx = (account: string, date: string, description: string, amount: number) => ({ id: `demo_tx_${++n}`, externalAccountId: ext(account), date, description, amount, currency: "USD" as const });
  const snow = demoSnowRemovalBill(anchor);
  return {
    accounts: [
      { externalAccountId: ext("operating"), name: "Holdings Operating", mask: "8291", currency: "USD", type: "checking" },
      { externalAccountId: ext("austin"), name: "Austin Rentals Operating", mask: "4410", currency: "USD", type: "checking" },
      { externalAccountId: ext("austin2"), name: "Austin #2 Operating", mask: "5520", currency: "USD", type: "checking" },
      { externalAccountId: ext("reserve"), name: "Property Reserve", mask: "7002", currency: "USD", type: "savings" },
    ],
    balances: { [ext("operating")]: 4_820_000, [ext("austin")]: 980_000, [ext("austin2")]: 210_000, [ext("reserve")]: 10_000_000 },
    transactions: [
      // Aspen snow removal, paid by bank bill pay; posts the day after Alex paid it.
      tx("operating", addDays(snow.paidOn, 1), "HIGH COUNTRY SERVICES BILLPAY", -45_000),
      // Austin Rental #1: a monthly lawn service nobody has added as a cost.
      tx("austin", d(-99), "GREENLEAF LAWN CARE #4412", -9_500),
      tx("austin", d(-69), "GREENLEAF LAWN CARE #4471", -9_500),
      tx("austin", d(-39), "GREENLEAF LAWN CARE #4519", -11_000),
      tx("austin", d(-9), "GREENLEAF LAWN CARE #4570", -9_500),
      // Everyday activity the rules ignore.
      tx("austin", d(-60), "RENT DEPOSIT UNIT 1507", 285_000),
      tx("austin", d(-30), "RENT DEPOSIT UNIT 1507", 285_000),
      tx("austin", d(-25), "TRANSFER TO RESERVE 7002", -100_000),
      tx("austin", d(-55), "TRANSFER TO RESERVE 7002", -100_000),
      tx("austin", d(-85), "TRANSFER TO RESERVE 7002", -100_000),
      tx("operating", d(-12), "HARDWARE STORE #88", -6_420),
      tx("operating", d(-4), "TRANSFER FROM RESERVE 7002", 500_000),
    ],
    mortgages: [
      // Austin #2: the servicer reports next month's payment and an escrow balance.
      { externalAccountId: ext("mortgage_austin2"), lenderName: "Lone Star Home Lending (Demo)", nextPaymentDueOn: d(22), nextMonthlyPayment: 301_400, escrowBalance: 421_050, propertyStreet: "2210 CEDAR HOLLOW RD" },
      // Miami: next payment as the servicer has it.
      { externalAccountId: ext("mortgage_miami"), lenderName: "Atlantic Home Loans (Demo)", nextPaymentDueOn: d(14), nextMonthlyPayment: 825_000, escrowBalance: null, propertyStreet: "412 CORAL SHELL WAY" },
    ],
  };
}
