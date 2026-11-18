// camelCase domain model the UI works with (mapped from the zod schemas).

// Every failed ziza call. `code` is ziza's `details.code` (or the BFF's own,
// in the same shape); copy is chosen on it, not on the status.
export type ZizaFailure = {
  // Named so it cannot be confused with the `status` some results carry.
  httpStatus: number;
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
};

export type Citation = {
  number: number;
  sourceId?: string;
  sourceRef?: string;
  locator?: string;
  // Only history knows this: the source was removed after it was cited.
  isRemoved: boolean;
};

export type UnfinishedAction = {
  description: string;
  reason: string;
};

export type OfferedLink = {
  url: string;
  title?: string;
};

export type PendingApproval = {
  kind: "approval";
  // ziza's `action_id`.
  id: string;
  toolName: string;
  description?: string;
  // Reserved for things that destroy or send: an ordinary confirmation in red
  // trains people to click through red.
  isDestructive: boolean;
};

export type PendingLinkOffer = {
  kind: "link_offer";
  // ziza's `offer_id`.
  id: string;
  pageUrl: string;
  pageTitle?: string;
  // Excludes the page itself, which is always indexed when the offer is taken.
  links: readonly OfferedLink[];
};

export type PendingCall = PendingApproval | PendingLinkOffer;

export type ApprovalDecision = "approve" | "decline";

export type ResumedTurn = {
  text: string;
  citations: readonly Citation[];
  approvalRequired: PendingApproval | null;
  followUps: readonly string[];
  failure: { code?: string; message?: string } | null;
};

export type LinkOfferOutcome = {
  added: readonly { url: string; jobId: string }[];
  refused: readonly { url: string; code?: string; message?: string }[];
};

// "url" stays even though there is no URL input: accepting a link offer in
// chat still produces url-kind rows.
export type SourceKind = "file" | "url";

export type KnowledgeSourceStatus =
  "uploading" | "processing" | "indexed" | "failed";

export type KnowledgeSource = {
  // Stable row id for rendering; never sent to ziza.
  id: string;
  // ziza's id, known once the ingest job is done; needed to remove the row.
  sourceId?: string;
  // The ingest job this row is following, until it finishes.
  jobId?: string;
  label: string;
  kind: SourceKind;
  chunkCount: number;
  status: KnowledgeSourceStatus;
  startedAt?: number;
  progressLabel?: string;
  imagesDescribed?: number;
  imagesFailed?: number;
  imagesSkipped?: number;
  errorDetail?: string;
};

export type SessionJobStatus = "queued" | "processing" | "done" | "failed";

export type SessionJob = {
  id: string;
  status: SessionJobStatus;
  progressLabel?: string;
  // Set on a finished ingest job when ziza queued starters for its document.
  startersJobId?: string;
  // Set on a finished starters job: the questions written for its upload.
  starterQuestions?: readonly string[];
  // Only an ingest job has one.
  result?: {
    sourceId: string;
    chunks: number;
    imagesDescribed: number;
    imagesSkipped: number;
    imagesFailed: number;
  };
  errorMessage?: string;
};

// Mirrors `ChatTurn` in `chat-panel.tsx`, redeclared here so the API layer
// does not depend on a component.
export type ChatHistoryTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: readonly Citation[];
  unfinishedAction?: UnfinishedAction;
};

export type ChatHistoryPage = {
  turns: readonly ChatHistoryTurn[];
  // Pass back as `before` for the next page older than this one; null at the
  // start of the conversation.
  nextBefore: string | null;
};

export type InspectorEntryLevel = "open" | "info" | "tool" | "error" | "done";

export type InspectorEntry = {
  id: number;
  time: string;
  level: InspectorEntryLevel;
  label: string;
  detail?: string;
};

export type RetrievedPassage = {
  id: number;
  number: number;
  title?: string;
  locator?: string;
  excerpt?: string;
};
