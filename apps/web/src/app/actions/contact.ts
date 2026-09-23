"use server";

import { AppError, badRequest, getRuntime } from "@sagolik/core";
import { RATE_LIMITS } from "@sagolik/security";
import { z } from "zod";
import type { ActionState } from "@/components/forms";
import { runAction } from "@/lib/server/action";
import { rateLimit } from "@/lib/server/context";
import { requestMeta } from "@/lib/server/session";

const ContactInput = z.object({
  name: z.string().trim().min(1, "Please tell us your name.").max(120),
  email: z.email("Please enter a valid email address.").max(254),
  organization: z.string().trim().max(160).optional(),
  topic: z.enum(["demo", "sales", "access", "privacy", "security", "other"]).default("demo"),
  message: z.string().trim().min(10, "Please add a few words about what you need.").max(4000),
  // Honeypot: real people never see or fill this field.
  website: z.string().max(0).optional(),
});

export async function contactAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const meta = await requestMeta();
    const rl = await rateLimit(`contact:${meta.ipAddress ?? "unknown"}`, { limit: 5, windowMs: RATE_LIMITS.auth.windowMs });
    if (!rl.allowed) throw new AppError("rate_limited", "Too many messages from this connection. Please try again in a few minutes.", 429);
    const raw = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string" && v !== ""));
    const parsed = ContactInput.safeParse(raw);
    if (!parsed.success) {
      throw badRequest(
        parsed.error.issues[0]?.message ?? "Please check the form.",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    const input = parsed.data;
    if (input.website) return { message: "Thanks — we'll be in touch." }; // silently drop bots
    const rt = await getRuntime();
    const to = rt.env.CONTACT_INBOX ?? "contact-inbox@localhost";
    await rt.providers.contactEmail.send({
      to,
      subject: `[${input.topic}] Enquiry from ${input.name}`,
      text: [`Name: ${input.name}`, `Email: ${input.email}`, `Organization: ${input.organization ?? "—"}`, `Topic: ${input.topic}`, `Request ID: ${meta.requestId}`, "", input.message].join("\n"),
    });
    return { message: "Thanks — your message has reached our team. We reply from a close.sagolik.com address; we will never ask for passwords or bank details by email." };
  });
}
