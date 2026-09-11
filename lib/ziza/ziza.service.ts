import { type z } from "zod";

import { request } from "@/lib/api/request";

import { toKnowledgeIngestResult, toPendingCall } from "./ziza.mapper";
import {
  KnowledgeClearResponseSchema,
  KnowledgeIngestResponseSchema,
  ZizaChatResponseSchema,
} from "./ziza.schema";
import {
  type DeferralFailure,
  type DeferralResult,
  type KnowledgeIngestFailure,
  type KnowledgeIngestResult,
} from "./ziza.types";

// Resource module for `/api/ziza`: every function calls `request()` with a
// schema and hands back domain objects.
//
// Chat itself is NOT here — it streams through the Next route handler at
// `/bff/ziza/stream`, which translates the backend SSE into the AI SDK
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

function readErrorDetail(errorData: unknown): string | undefined {
  if (typeof errorData !== "object" || errorData === null) {
    return undefined;
  }
  const detail = (errorData as { detail?: unknown }).detail;
  return typeof detail === "string" ? detail : undefined;
}

// Uploads a file for extraction and ingestion. The source label is the
// filename; this endpoint takes no `source` of its own.
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

// Both resolution endpoints answer one deferred call and return the same
// shape: the run's reply, plus whatever is still unanswered. A run only
// resumes once nothing is outstanding, so `pendingCalls` coming back non-empty
// means the reply is a progress note, not the final answer.
//
// Neither streams — the whole body arrives at once — and neither is safe to
// retry blindly: the call is resolved on arrival, so a second attempt is 409.
const toDeferralResult = (
  data: z.infer<typeof ZizaChatResponseSchema>,
): DeferralResult => ({
  response: data.response,
  pendingCalls: data.pending_calls.map(toPendingCall),
});

// Answers an `approval` gate. The tool body runs on the way through when
// approved, so this is where a deletion actually happens.
export const resolveApproval = async (
  sessionId: string,
  toolCallId: string,
  approved: boolean,
): Promise<DeferralResult | DeferralFailure> => {
  const { data, ok, status, errorData } = await request(
    "/ziza/chat/approval",
    ZizaChatResponseSchema,
    {
      method: "POST",
      data: {
        session_id: sessionId,
        tool_call_id: toolCallId,
        approved,
      },
    },
  );

  if (!ok || !data) {
    return { status, detail: readErrorDetail(errorData) };
  }
  return toDeferralResult(data);
};

// Answers an `add_url_to_knowledge_base` deferred call by naming which of the
// offered links to index alongside the page. This endpoint does the indexing
// itself, so it can take a while.
//
// An empty selection is a real answer meaning "just the page itself" — it is
// not the same as walking away, which is what leaves the run paused.
export const resolveLinkSelection = async (
  sessionId: string,
  toolCallId: string,
  selectedLinks: readonly string[],
): Promise<DeferralResult | DeferralFailure> => {
  const { data, ok, status, errorData } = await request(
    "/ziza/chat/links",
    ZizaChatResponseSchema,
    {
      method: "POST",
      data: {
        session_id: sessionId,
        tool_call_id: toolCallId,
        selected_links: selectedLinks,
      },
      timeout: 0,
    },
  );

  if (!ok || !data) {
    return { status, detail: readErrorDetail(errorData) };
  }
  return toDeferralResult(data);
};

export function isDeferralFailure(
  result: DeferralResult | DeferralFailure,
): result is DeferralFailure {
  return "status" in result;
}

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

export const ZIZA_STREAM_ROUTE = "/bff/ziza/stream";
