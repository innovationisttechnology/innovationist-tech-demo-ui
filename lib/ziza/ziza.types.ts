// camelCase domain model the UI works with (mapped from the zod schemas).

export type KnowledgeIngestResult = {
  sessionId: string;
  source: string;
  chunksIngested: number;
  searchable: boolean;
  imagesDescribed: number;
  imagesFailed: number;
  imagesTotal: number;
  pagesSummarised: number;
};

// Ingest rejections carry a reason: 413 too large, 415 unextractable, 422
// unsafe URL and 502 unreachable are all different things to tell someone, so
// the service returns the status rather than collapsing every failure to null.
export type KnowledgeIngestFailure = {
  status: number;
  detail?: string;
};

export type SourceKind = "text" | "file" | "url";

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
