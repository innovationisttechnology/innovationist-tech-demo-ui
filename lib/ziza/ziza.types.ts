// camelCase domain model the UI works with (mapped from the zod schemas).

export type KnowledgeIngestResult = {
  sessionId: string;
  source: string;
  chunksIngested: number;
  searchable: boolean;
  imagesDescribed: number;
  imagesFailed: number;
  documentsUsed: number;
  documentsAllowed: number;
  pagesSummarised: number;
};

// Ingest rejections carry a reason: 413 too large, 415 unextractable, 422
// unsafe URL and 502 unreachable are all different things to tell someone, so
// the service returns the status rather than collapsing every failure to null.
export type KnowledgeIngestFailure = {
  status: number;
  detail?: string;
};

export type DeferredKind = "approval" | "call";

export type OfferedLink = {
  url: string;
  text: string;
};

type PendingCallBase = {
  toolCallId: string;
  toolName: string;
  // Written server-side by the tool that paused, so the UI never has to
  // describe an action whose shape it doesn't know.
  summary?: string;
};

// A yes/no gate. Nothing has run; confirming re-enters the tool body.
export type PendingApprovalCall = PendingCallBase & {
  kind: "approval";
  documents: readonly string[];
  // Drives how alarming the gate looks. Reserved for things that destroy or
  // send something — an ordinary confirmation in red trains people to click
  // through red.
  isDestructive: boolean;
};

// Deferred for external execution: the tool body never runs again, and the
// result supplied from outside becomes its return value. There is nothing to
// approve, so this offers a choice rather than a confirmation.
export type PendingInputCall = PendingCallBase & {
  kind: "call";
  pageUrl?: string;
  pageTitle?: string;
  links: readonly OfferedLink[];
  slotsLeft?: number;
};

export type PendingCall = PendingApprovalCall | PendingInputCall;

export type DeferralResult = {
  response: string;
  // Everything still unanswered — the server is authoritative here, so this
  // replaces the local list rather than being subtracted from it.
  pendingCalls: readonly PendingCall[];
};

// A decision is spendable once — the backend resolves the call on arrival —
// so 409 means it was already spent or the paused run aged out. 422 means a
// link was submitted that this call never offered. The status is carried back
// rather than collapsed to null so the UI can say which happened.
export type DeferralFailure = {
  status: number;
  detail?: string;
};

// "url" stays even though there is no URL input: accepting a crawled-link
// offer in chat still produces url-kind rows.
export type SourceKind = "file" | "url";

export type KnowledgeSourceStatus =
  "uploading" | "processing" | "indexed" | "pending-index" | "failed";

export type KnowledgeSource = {
  // Client-side id — the API has no per-source identifier yet.
  id: string;
  label: string;
  kind: SourceKind;
  chunkCount: number;
  status: KnowledgeSourceStatus;
  // Epoch ms when processing began, so the row can show elapsed time. Image
  // captioning runs one vision call per image, so an image-heavy PDF can take
  // a minute or more on a single blocking request.
  startedAt?: number;
  imagesDescribed?: number;
  imagesFailed?: number;
  imagesSkipped?: number;
  pagesSummarised?: number;
  errorDetail?: string;
};

// An offer to try something else, shown as a chip under the last reply when
// retrieval found nothing. Clicking one sends `message` as an ordinary chat
// message — `label` is only what the chip reads.
export type Suggestion = {
  // Open-ended by design: unrecognised kinds still render and still send.
  kind: string;
  label: string;
  message: string;
  url?: string;
};

export type InspectorEntryLevel = "open" | "info" | "tool" | "error" | "done";

export type InspectorEntry = {
  id: number;
  time: string;
  level: InspectorEntryLevel;
  label: string;
  detail?: string;
};

export type RetrievedChunk = {
  id: number;
  source: string;
  score: number;
  text: string;
};
