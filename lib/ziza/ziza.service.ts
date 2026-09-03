import { request } from "@/lib/api/request";

import { toKnowledgeIngestResult } from "./ziza.mapper";
import {
  KnowledgeClearResponseSchema,
  KnowledgeIngestResponseSchema,
} from "./ziza.schema";
import {
  type KnowledgeIngestFailure,
  type KnowledgeIngestResult,
} from "./ziza.types";

// Resource module for `/api/ziza`: every function calls `request()` with a
// schema and hands back domain objects.
//
// Chat itself is NOT here — it streams through the Next route handler at
// `/api/ziza/stream`, which translates the backend SSE into the AI SDK
// protocol so `useChat` can drive the UI. File upload deliberately does NOT go
// through a route handler: posting straight to the API avoids buffering the
// whole file through the Next server a second time.

// Mirrors `MAX_UPLOAD_BYTES` in `app/ziza_chat/router.py`.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Mirrors TEXT_EXTENSIONS in `document_loaders/loaders.py` plus the PDF, DOCX
// and image types its detector accepts.
//
// The server decides for real by sniffing the file's own bytes — a filename is
// attacker-controlled, so it never trusts one. This list is therefore a UX
// convenience for the obvious mistake, NOT a gate: a valid PDF named `.dat`
// would be accepted by the server and should not be blocked here, which is why
// the check that uses it only rejects known-bad extensions.
export const SUPPORTED_UPLOAD_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".rst",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".pdf",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
] as const;

export const UPLOAD_ACCEPT_ATTRIBUTE = SUPPORTED_UPLOAD_EXTENSIONS.join(",");

// Mirrors `KnowledgeUrlRequest.url` max_length in `app/ziza_chat/schemas.py`.
export const MAX_URL_LENGTH = 2048;

// Adds a text document to this session's knowledge base.
export const ingestKnowledge = async (
  sessionId: string,
  source: string,
  text: string,
): Promise<KnowledgeIngestResult | null> => {
  const { data, ok } = await request(
    "/ziza/knowledge",
    KnowledgeIngestResponseSchema,
    {
      method: "POST",
      data: { session_id: sessionId, source, text },
    },
  );
  return ok && data ? toKnowledgeIngestResult(data) : null;
};

function readErrorDetail(errorData: unknown): string | undefined {
  if (typeof errorData !== "object" || errorData === null) {
    return undefined;
  }
  const detail = (errorData as { detail?: unknown }).detail;
  return typeof detail === "string" ? detail : undefined;
}

// Uploads a file for extraction and ingestion. The source label is the
// filename — unlike the JSON endpoint, `/knowledge/file` takes no `source`.
//
// No timeout is set: extraction runs one vision call per embedded image, so a
// large PDF legitimately takes minutes on this single request.
export const ingestFile = async (
  sessionId: string,
  file: File,
): Promise<KnowledgeIngestResult | KnowledgeIngestFailure> => {
  const body = new FormData();
  body.append("session_id", sessionId);
  body.append("file", file);

  const { data, ok, status, errorData } = await request(
    "/ziza/knowledge/file",
    KnowledgeIngestResponseSchema,
    { method: "POST", data: body, timeout: 0 },
  );

  if (!ok || !data) {
    return { status, detail: readErrorDetail(errorData) };
  }
  return toKnowledgeIngestResult(data);
};

// Fetches a page server-side and ingests it. The browser can't do this itself
// (CORS), and the server resolves every redirect hop against private address
// space before connecting — so this endpoint is the only path in.
//
// Like uploads, no timeout: the fetch, extraction and page summary all happen
// inside this one request.
export const ingestUrl = async (
  sessionId: string,
  url: string,
): Promise<KnowledgeIngestResult | KnowledgeIngestFailure> => {
  const { data, ok, status, errorData } = await request(
    "/ziza/knowledge/url",
    KnowledgeIngestResponseSchema,
    { method: "POST", data: { session_id: sessionId, url }, timeout: 0 },
  );

  if (!ok || !data) {
    return { status, detail: readErrorDetail(errorData) };
  }
  return toKnowledgeIngestResult(data);
};

export function isIngestFailure(
  result: KnowledgeIngestResult | KnowledgeIngestFailure,
): result is KnowledgeIngestFailure {
  return "status" in result;
}

// Drops every chunk for this session. Returns the number deleted, or null on failure.
export const clearKnowledge = async (
  sessionId: string,
): Promise<number | null> => {
  const { data, ok } = await request(
    `/ziza/knowledge/${encodeURIComponent(sessionId)}`,
    KnowledgeClearResponseSchema,
    { method: "DELETE" },
  );
  return ok && data ? data.chunks_deleted : null;
};

// The chat stream is proxied through Next rather than hit directly, so the
// browser never needs the backend origin and the SSE→AI-SDK translation has
// one home.
export const ZIZA_STREAM_ROUTE = "/api/ziza/stream";
