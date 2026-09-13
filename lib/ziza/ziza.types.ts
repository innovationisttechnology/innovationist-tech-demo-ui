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
  suggestions: readonly Suggestion[];
};

// 413 too large, 415 unextractable, 422 unsafe URL, 502 unreachable — all
// different things to tell someone, hence the status rather than null.
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
  summary?: string;
};

export type PendingApprovalCall = PendingCallBase & {
  kind: "approval";
  documents: readonly string[];
  // Reserved for things that destroy or send: an ordinary confirmation in red
  // trains people to click through red.
  isDestructive: boolean;
};

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
  pendingCalls: readonly PendingCall[];
};

// 409 means the decision was already spent or the run aged out; 422 means a
// link this call never offered.
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
  startedAt?: number;
  imagesDescribed?: number;
  imagesFailed?: number;
  imagesSkipped?: number;
  pagesSummarised?: number;
  errorDetail?: string;
};

export type Suggestion = {
  kind: string;
  label: string;
  message: string;
  url?: string | null;
  category?: string | null;
};

// `document` names which upload the questions belong to, which is how a
// failed-looking upload can be told apart from one that actually landed.
export type StarterQuestions = {
  document: string | null;
  suggestions: readonly Suggestion[];
};

// Mirrors `ChatTurn` in `chat-panel.tsx`, redeclared here so the API layer
// does not depend on a component.
export type ChatHistoryTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type ChatHistoryPage = {
  turns: readonly ChatHistoryTurn[];
  hasMore: boolean;
  // Pass back as `before` for the next page older than this one.
  nextBefore: string | null;
};

export type SessionSources = {
  documentsUsed: number;
  documentsAllowed: number;
  sources: readonly KnowledgeSource[];
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
