import type { Currency, EscrowStatus } from "@sagolik/types";
import { MockProviderBase, randomRef, type ProviderInfo, type WebhookCapable } from "../common";

export interface EscrowInstructions {
  beneficiaryName: string;
  bankName: string;
  accountNumber: string;
  routingIdentifier: string;
  reference: string;
}

/**
 * Licensed escrow / title / trust-account partner.
 *
 * Sagolik Close ORCHESTRATES escrow; it does not hold funds. The provider is
 * the licensed custodian. See docs/compliance-boundaries.md.
 */
export interface EscrowProvider extends WebhookCapable {
  readonly info: ProviderInfo;
  openEscrow(opts: { transactionReference: string; requiredAmount: number; currency: Currency }): Promise<{
    externalReference: string;
    providerName: string;
    instructions: EscrowInstructions;
  }>;
  getEscrowStatus(externalReference: string): Promise<{ status: EscrowStatus; receivedAmount: number }>;
  requestDisbursement(externalReference: string, lines: Array<{ payee: string; amount: number; purpose: string }>): Promise<{ requestId: string }>;
}

export class MockEscrowProvider extends MockProviderBase implements EscrowProvider {
  readonly info: ProviderInfo = { id: "mock_escrow", displayName: "Sandbox Escrow Partner", mode: "mock" };

  async openEscrow(opts: { transactionReference: string; requiredAmount: number; currency: Currency }) {
    const externalReference = `ESC-${opts.transactionReference}`;
    return {
      externalReference,
      providerName: "Sandbox Title & Escrow Co.",
      instructions: {
        beneficiaryName: "Sandbox Title & Escrow Co. — Trust Account",
        bankName: "Sandbox National Bank",
        accountNumber: "000123456789",
        routingIdentifier: "021000021",
        reference: externalReference,
      },
    };
  }

  async getEscrowStatus(_externalReference: string) {
    return { status: "open" as EscrowStatus, receivedAmount: 0 };
  }

  async requestDisbursement(externalReference: string, lines: Array<{ payee: string; amount: number; purpose: string }>) {
    const requestId = randomRef("disb");
    await this.emit("escrow.disbursement_requested", { externalReference, requestId, lines });
    return { requestId };
  }

  /** Sandbox: the partner confirms disbursement complete. */
  async confirmDisbursed(externalReference: string) {
    await this.emit("escrow.disbursed", { externalReference });
  }
}
