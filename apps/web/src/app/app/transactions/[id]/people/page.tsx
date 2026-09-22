import { IDENTITY_STATUS_TEXT, ROLE_LABELS } from "@sagolik/core";
import { PARTICIPANT_ROLES } from "@sagolik/types";
import { getJurisdiction } from "@sagolik/workflow";
import { Alert, Card, CardBody, CardHeader, Field, Input, ParticipantAvatar, Select, StatusBadge } from "@sagolik/ui";
import type { Metadata } from "next";
import { inviteParticipantAction, removeParticipantAction } from "@/app/actions/transaction";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { loadTx } from "@/lib/server/tx";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { snapshot: s, view, can } = await loadTx(id);
  const j = getJurisdiction(s.transaction.jurisdiction);
  const missing = j.requiredParticipants.filter((r) => !s.participants.some((p) => p.role === r && p.status !== "removed"));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-4">
        {sp.created ? (
          <Alert tone="done" title="Transaction created">
            Next, invite the people who need to be part of this closing.
          </Alert>
        ) : null}
        {missing.length ? (
          <Alert tone="attention" title={`Required in ${j.name}`}>
            Still to invite: {missing.map((r) => ROLE_LABELS[r]).join(", ")}.
          </Alert>
        ) : null}
        <Card>
          <CardHeader title="People on this transaction" description="Everyone sees who is involved. What each person can see and do depends on their role." />
          <ul>
            {view.people.map(({ participant: p, roleLabel, identity, isMe }) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 last:border-b-0">
                <div className="flex items-center gap-3">
                  <ParticipantAvatar name={p.displayName} />
                  <div>
                    <p className="font-medium text-ink">
                      {p.displayName}
                      {isMe ? <span className="text-ink-3"> (you)</span> : null}
                    </p>
                    <p className="text-[13px] text-ink-3">{roleLabel}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {identity ? (
                    <StatusBadge tone={identity === "verified" ? "done" : identity === "failed" ? "blocked" : "attention"}>{identity === "verified" ? "ID verified" : identity === "not_started" ? "ID not started" : IDENTITY_STATUS_TEXT[identity].replace(/\.$/, "")}</StatusBadge>
                  ) : null}
                  <StatusBadge tone={p.status === "active" ? "done" : "neutral"}>{p.status === "active" ? "Joined" : "Invited"}</StatusBadge>
                  {can("participant.remove") && !isMe ? (
                    <ActionButton action={removeParticipantAction} fields={{ transactionId: id, participantId: p.id }} variant="ghost" confirm={`Remove ${p.displayName} from this transaction?`}>
                      Remove
                    </ActionButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {can("participant.invite") ? (
        <Card className="h-fit">
          <CardHeader title="Invite someone" description="They'll get an email and join with that address." />
          <CardBody>
            <ActionForm action={inviteParticipantAction} className="space-y-3" resetOnSuccess>
              <input type="hidden" name="transactionId" value={id} />
              <Field label="Full name" htmlFor="displayName">
                <Input id="displayName" name="displayName" required minLength={2} maxLength={120} />
              </Field>
              <Field label="Email" htmlFor="email">
                <Input id="email" name="email" type="email" required />
              </Field>
              <Field label="Role" htmlFor="role">
                <Select id="role" name="role" defaultValue={missing[0] ?? "buyer"}>
                  {PARTICIPANT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton>Send invitation</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
