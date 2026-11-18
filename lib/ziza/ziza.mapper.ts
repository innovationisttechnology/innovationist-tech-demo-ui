import { type z } from "zod";

import {
  type ZizaApprovalRequiredEventSchema,
  type ZizaCitationSchema,
  type ZizaErrorBody,
  type ZizaHistoryPageSchema,
  type ZizaJobViewSchema,
  type ZizaLinkOfferOutcomeSchema,
  type ZizaLinksOfferedEventSchema,
  type ZizaResumedTurnSchema,
  type ZizaSourcesPageSchema,
} from "./ziza.schema";
import {
  type ChatHistoryPage,
  type ChatHistoryTurn,
  type Citation,
  type SessionJob,
  type KnowledgeSource,
  type LinkOfferOutcome,
  type PendingApproval,
  type PendingLinkOffer,
  type ResumedTurn,
  type ZizaFailure,
} from "./ziza.types";

// Nothing on the wire says a tool is destructive, so it is known by name.
// `clear_session_knowledge` is the only one ziza has.
const DESTRUCTIVE_TOOL_NAMES = new Set(["clear_session_knowledge"]);

export const toZizaFailure = (
  status: number,
  errorBody: ZizaErrorBody | null,
): ZizaFailure => ({
  httpStatus: status,
  code: errorBody?.details.code,
  message: errorBody?.details.message ?? errorBody?.message,
  retryAfterSeconds: errorBody?.details.retry_after_seconds,
});

export const toCitation = (
  apiCitation: z.infer<typeof ZizaCitationSchema>,
): Citation => ({
  number: apiCitation.number,
  sourceId: apiCitation.source_id ?? undefined,
  sourceRef: apiCitation.source_ref ?? undefined,
  locator: apiCitation.locator ?? undefined,
  isRemoved: apiCitation.removed === true,
});

export const toPendingApproval = (
  apiEvent: z.infer<typeof ZizaApprovalRequiredEventSchema>,
): PendingApproval => ({
  kind: "approval",
  id: apiEvent.action_id,
  toolName: apiEvent.tool,
  description: apiEvent.description ?? undefined,
  isDestructive: DESTRUCTIVE_TOOL_NAMES.has(apiEvent.tool),
});

export const toPendingLinkOffer = (
  apiEvent: z.infer<typeof ZizaLinksOfferedEventSchema>,
): PendingLinkOffer => ({
  kind: "link_offer",
  id: apiEvent.offer_id,
  pageUrl: apiEvent.page_url,
  pageTitle:
    apiEvent.links.find((link) => link.url === apiEvent.page_url)?.title ??
    undefined,
  // The page leads the list; it is always taken, so it is not a choice.
  links: apiEvent.links
    .filter((link) => link.url !== apiEvent.page_url)
    .map((link) => ({ url: link.url, title: link.title ?? undefined })),
});

export const toResumedTurn = (
  apiResult: z.infer<typeof ZizaResumedTurnSchema>,
): ResumedTurn => ({
  text: apiResult.text,
  citations: apiResult.citations.map(toCitation),
  approvalRequired: apiResult.approval_required
    ? toPendingApproval(apiResult.approval_required)
    : null,
  followUps: apiResult.suggestions?.follow_ups ?? [],
  failure: apiResult.failure
    ? {
        code: apiResult.failure.code ?? undefined,
        message: apiResult.failure.message ?? undefined,
      }
    : null,
});

export const toLinkOfferOutcome = (
  apiResult: z.infer<typeof ZizaLinkOfferOutcomeSchema>,
): LinkOfferOutcome => ({
  added: apiResult.added.map((added) => ({
    url: added.url,
    jobId: added.job_id,
  })),
  refused: apiResult.refused.map((refused) => ({
    url: refused.url,
    code: refused.code ?? undefined,
    message: refused.message ?? undefined,
  })),
});

// `progress` is free-form on ziza's side; today it is `{step, done, total}`
// while embedding and `{step, total}` while storing.
function describeJobProgress(
  progress: z.infer<typeof ZizaJobViewSchema>["progress"],
): string | undefined {
  if (!progress?.step) {
    return undefined;
  }
  if (typeof progress.done === "number" && typeof progress.total === "number") {
    return `${progress.step} ${progress.done}/${progress.total}`;
  }
  return progress.step;
}

export const toSessionJob = (
  apiJob: z.infer<typeof ZizaJobViewSchema>,
): SessionJob => ({
  id: apiJob.id,
  status: apiJob.status,
  progressLabel: describeJobProgress(apiJob.progress),
  startersJobId: apiJob.result?.starters_job_id ?? undefined,
  starterQuestions: apiJob.result?.questions ?? undefined,
  result: apiJob.result?.source_id
    ? {
        sourceId: apiJob.result.source_id,
        chunks: apiJob.result.chunks ?? 0,
        imagesDescribed: apiJob.result.images_described ?? 0,
        imagesSkipped: apiJob.result.images_skipped ?? 0,
        imagesFailed: apiJob.result.images_failed ?? 0,
      }
    : undefined,
  errorMessage: apiJob.error?.message ?? undefined,
});

export const toSessionSources = (
  apiResult: z.infer<typeof ZizaSourcesPageSchema>,
): readonly KnowledgeSource[] =>
  [...apiResult.items]
    .sort((left, right) =>
      (left.added_at ?? "").localeCompare(right.added_at ?? ""),
    )
    .map((item) => ({
      id: item.source_id,
      sourceId: item.source_id,
      label: item.title ?? item.source_id,
      kind: item.kind === "url" ? ("url" as const) : ("file" as const),
      chunkCount: 0,
      status:
        item.status === "pending"
          ? ("processing" as const)
          : ("indexed" as const),
    }));

// A stored turn is one exchange; the chat renders it as two messages.
export const toChatHistoryPage = (
  apiResult: z.infer<typeof ZizaHistoryPageSchema>,
): ChatHistoryPage => ({
  turns: [...apiResult.turns]
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .flatMap((turn): ChatHistoryTurn[] => [
      {
        id: `${turn.id}:user`,
        role: "user",
        text: turn.user_text,
        citations: [],
      },
      {
        id: `${turn.id}:assistant`,
        role: "assistant",
        text: turn.answer_text ?? "",
        citations: turn.citations.map(toCitation),
        unfinishedAction: turn.unfinished_action ?? undefined,
      },
    ]),
  nextBefore: apiResult.next_before ?? null,
});
