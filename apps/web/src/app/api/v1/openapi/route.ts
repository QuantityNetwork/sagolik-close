/**
 * GET /api/v1/openapi — OpenAPI 3.1 description generated from the same Zod
 * schemas the server validates with, so it can't drift. Basis for partner
 * integrations and a future MCP server (agents get the same permissions as
 * the person they act for).
 */
import {
  ApiError,
  BankInstructionInput,
  CreateBankConnectionInput,
  CreatePaymentInput,
  CreateTransactionInput,
  InviteParticipantInput,
  SignatureRequestInput,
  TransitionInput,
  UpdateTransactionInput,
} from "@sagolik/types";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = (s: z.ZodType) => z.toJSONSchema(s, { unrepresentable: "any", io: "input" });

const json = (ref: string) => ({ content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } });
const ok = (description: string) => ({ description, content: { "application/json": { schema: { type: "object", properties: { data: {} } } } } });
const errors = { "4XX": { description: "Error", ...json("ApiError") }, "5XX": { description: "Error", ...json("ApiError") } };
const idParam = (name = "id") => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });
const idempotency = { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 100 } };

export function GET() {
  const doc = {
    openapi: "3.1.0",
    info: {
      title: "Sagolik Close API",
      version: "1.0.0",
      description:
        "Transaction orchestration API. All mutations accept an Idempotency-Key header. Errors use a consistent envelope with a request id. Authorization is identical to the web app: every call is checked against the caller's transaction permissions and Row Level Security.",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: { session: { type: "apiKey", in: "cookie", name: "sb-access-token" }, bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        ApiError: schema(ApiError),
        CreateTransactionInput: schema(CreateTransactionInput),
        UpdateTransactionInput: schema(UpdateTransactionInput),
        TransitionInput: schema(TransitionInput),
        InviteParticipantInput: schema(InviteParticipantInput),
        SignatureRequestInput: schema(SignatureRequestInput),
        CreateBankConnectionInput: schema(CreateBankConnectionInput),
        CreatePaymentInput: schema(CreatePaymentInput),
        BankInstructionInput: schema(BankInstructionInput),
      },
    },
    security: [{ session: [] }, { bearer: [] }],
    paths: {
      "/transactions": {
        get: { summary: "List transactions visible to the caller", responses: { 200: ok("Transactions"), ...errors } },
        post: { summary: "Open a transaction", parameters: [idempotency], requestBody: json("CreateTransactionInput"), responses: { 201: ok("Created"), ...errors } },
      },
      "/transactions/{id}": {
        get: { summary: "Get a transaction (filtered by permissions)", parameters: [idParam()], responses: { 200: ok("Transaction"), ...errors } },
        patch: { summary: "Update closing date, price or coordinator", parameters: [idParam(), idempotency], requestBody: json("UpdateTransactionInput"), responses: { 200: ok("Updated"), ...errors } },
      },
      "/transactions/{id}/participants": { post: { summary: "Invite a participant", parameters: [idParam(), idempotency], requestBody: json("InviteParticipantInput"), responses: { 201: ok("Invited"), ...errors } } },
      "/transactions/{id}/timeline": { get: { summary: "Milestones, health and closing blockers", parameters: [idParam()], responses: { 200: ok("Timeline"), ...errors } } },
      "/transactions/{id}/transitions": { post: { summary: "Request a state transition (guards apply)", parameters: [idParam(), idempotency], requestBody: json("TransitionInput"), responses: { 201: ok("Transitioned"), ...errors } } },
      "/transactions/{id}/assistant": { post: { summary: "Ask the read-only assistant", parameters: [idParam()], responses: { 201: ok("Answer"), ...errors } } },
      "/transactions/{id}/calendar": { get: { summary: "ICS calendar feed", parameters: [idParam()], responses: { 200: { description: "text/calendar" }, ...errors } } },
      "/documents": { post: { summary: "Upload a document or a new version (multipart)", parameters: [idempotency], responses: { 201: ok("Uploaded"), ...errors } } },
      "/documents/{id}/signature-request": { post: { summary: "Send a document for e-signature", parameters: [idParam(), idempotency], requestBody: json("SignatureRequestInput"), responses: { 201: ok("Sent"), ...errors } } },
      "/documents/{id}/download": { get: { summary: "Download a version (authorized + audited)", parameters: [idParam(), { name: "version", in: "query", schema: { type: "integer" } }], responses: { 200: { description: "File" }, ...errors } } },
      "/bank-connections": {
        get: { summary: "The caller's bank connections (masked)", responses: { 200: ok("Connections"), ...errors } },
        post: { summary: "Start a provider-hosted bank consent", parameters: [idempotency], requestBody: json("CreateBankConnectionInput"), responses: { 201: ok("Consent URL"), ...errors } },
      },
      "/bank-connections/{id}": { get: { summary: "One bank connection", parameters: [idParam()], responses: { 200: ok("Connection"), ...errors } } },
      "/escrow/{transactionId}": { get: { summary: "Escrow status, conditions, ledger", parameters: [idParam("transactionId")], responses: { 200: ok("Escrow"), ...errors } } },
      "/payments": { post: { summary: "Initiate a transfer (step-up + dual approval)", parameters: [idempotency], requestBody: json("CreatePaymentInput"), responses: { 201: ok("Payment"), ...errors } } },
      "/audit/{transactionId}": { get: { summary: "Audit trail and state history", parameters: [idParam("transactionId"), { name: "action", in: "query", schema: { type: "string" } }], responses: { 200: ok("Audit"), ...errors } } },
    },
  };
  return NextResponse.json(doc, { headers: { "cache-control": "public, max-age=300" } });
}
