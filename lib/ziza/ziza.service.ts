import { type z } from "zod";

import { request } from "@/lib/api/request";

import {
  toKnowledgeIngestResult,
  toPendingCall,
  toStarterQuestions,
} from "./ziza.mapper";
import {
  KnowledgeClearResponseSchema,
  KnowledgeIngestResponseSchema,
  KnowledgeSuggestionsResponseSchema,
  ZizaChatResponseSchema,
} from "./ziza.schema";
import {
  type DeferralFailure,
  type DeferralResult,
  type KnowledgeIngestFailure,
  type KnowledgeIngestResult,
  type StarterQuestions,
} from "./ziza.types";

// Chat is not here — it streams through the route handler at
// `/bff/ziza/stream`. File upload deliberately skips that handler: posting
// straight to the API avoids buffering the whole file through Next twice.

// Mirrors `MAX_UPLOAD_BYTES` in `app/ziza_chat/router.py`.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// A UX convenience, NOT a gate: the server decides by sniffing the file's
// bytes, so a valid PDF named `.dat` must reach it. Only known-bad extensions
// are rejected here.
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

const toDeferralResult = (
  data: z.infer<typeof ZizaChatResponseSchema>,
): DeferralResult => ({
  response: data.response,
  pendingCalls: data.pending_calls.map(toPendingCall),
});

// The tool body runs on the way through when approved, so this is where a
// deletion actually happens. Not retryable: a second attempt is 409.
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

// Does the indexing itself, so it can take a while. An empty selection is a
// real answer meaning "just the page itself", not the same as walking away.
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

// Recovery path only — the ingest response already carries these, so this is
// for when that response never arrived. Never poll it.
export const fetchStarterQuestions = async (
  sessionId: string,
): Promise<StarterQuestions | null> => {
  const { data, ok } = await request(
    `/ziza/knowledge/${encodeURIComponent(sessionId)}/suggestions`,
    KnowledgeSuggestionsResponseSchema,
  );
  return ok && data ? toStarterQuestions(data) : null;
};

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
