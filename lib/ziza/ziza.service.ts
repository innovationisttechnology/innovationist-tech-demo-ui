import { type z } from "zod";

import { request } from "@/lib/api/request";

import {
  toChatHistoryPage,
  toSessionJob,
  toLinkOfferOutcome,
  toResumedTurn,
  toSessionSources,
  toZizaFailure,
} from "./ziza.mapper";
import {
  ZizaErrorBodySchema,
  ZizaHistoryPageSchema,
  ZizaJobViewSchema,
  ZizaLinkOfferOutcomeSchema,
  ZizaResumedTurnSchema,
  ZizaSessionEnsuredSchema,
  ZizaSourceRemovedSchema,
  ZizaSourcesPageSchema,
  ZizaStartersSchema,
} from "./ziza.schema";
import {
  type ApprovalDecision,
  type ChatHistoryPage,
  type SessionJob,
  type KnowledgeSource,
  type LinkOfferOutcome,
  type ResumedTurn,
  type ZizaFailure,
} from "./ziza.types";

// Every call goes through the Next BFF (`app/bff/ziza`), which holds the
// server secret and keeps the session token in an httpOnly cookie. Nothing
// here ever sees either. Paths after the base mirror ziza's `/api/app/` ones.
const ZIZA_BFF_BASE_URL = "/bff/ziza";

export const ZIZA_STREAM_ROUTE = `${ZIZA_BFF_BASE_URL}/stream`;

// Set by the BFF when it had to replace a session that ziza no longer knew.
const SESSION_RENEWED_HEADER = "x-ziza-session-renewed";

// Mirrors ziza's upload cap for the demo product.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// TODO: read this from ziza once an app route exposes the session's document
// limit (`max_documents_per_session`); until then it mirrors the demo
// product's setting, and ziza's 409 `session_document_limit` is the real gate.
export const DEMO_MAX_DOCUMENTS_PER_SESSION = 10;

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

const sessionRenewalListeners = new Set<() => void>();

// The visitor's documents and conversation are gone whenever this fires, so
// whatever the page shows from the old session is stale.
export function subscribeToSessionRenewal(listener: () => void): () => void {
  sessionRenewalListeners.add(listener);
  return () => {
    sessionRenewalListeners.delete(listener);
  };
}

function announceIfSessionRenewed(
  readHeader: (headerName: string) => string | null | undefined,
) {
  if (readHeader(SESSION_RENEWED_HEADER)) {
    sessionRenewalListeners.forEach((listener) => listener());
  }
}

// For `useChat`'s transport, which does its own fetching.
export const fetchWithSessionRenewalCheck: typeof fetch = async (
  input,
  init,
) => {
  const response = await fetch(input, init);
  announceIfSessionRenewed((headerName) => response.headers.get(headerName));
  return response;
};

function readFailure(status: number, errorData: unknown): ZizaFailure {
  const parsed = ZizaErrorBodySchema.safeParse(errorData);
  return toZizaFailure(status, parsed.success ? parsed.data : null);
}

// `useChat` surfaces a rejected stream request as an Error whose message is
// the response body, so the BFF's error JSON is in there.
export function readChatStreamFailure(error: Error): ZizaFailure {
  let errorBody: unknown = null;
  try {
    errorBody = JSON.parse(error.message);
  } catch {
    return { httpStatus: 0, message: error.message };
  }
  const parsed = ZizaErrorBodySchema.safeParse(errorBody);
  return parsed.success
    ? toZizaFailure(parsed.data.status_code ?? 0, parsed.data)
    : { httpStatus: 0, message: error.message };
}

export function isZizaFailure<TResult extends object>(
  result: TResult | ZizaFailure,
): result is ZizaFailure {
  return "httpStatus" in result;
}

async function callBff<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  options: Parameters<typeof request>[2] = {},
): Promise<z.infer<TSchema> | ZizaFailure> {
  const { data, ok, status, errorData, headers } = await request(path, schema, {
    baseUrl: ZIZA_BFF_BASE_URL,
    ...options,
  });
  announceIfSessionRenewed((headerName) => headers?.[headerName]);
  if (!ok || data === undefined) {
    return readFailure(status, errorData);
  }
  return data;
}

export const ensureZizaSession = async (): Promise<
  { isNewSession: boolean } | ZizaFailure
> => {
  const result = await callBff("/session", ZizaSessionEnsuredSchema, {
    method: "POST",
  });
  return isZizaFailure(result)
    ? result
    : { isNewSession: result.is_new_session };
};

// Deletes the session's documents, conversation and images, then starts a new
// session. Resolves to null on success.
export const clearZizaSession = async (): Promise<ZizaFailure | null> => {
  const result = await callBff("/session", ZizaSessionEnsuredSchema, {
    method: "DELETE",
  });
  return isZizaFailure(result) ? result : null;
};

// Answers as soon as the file is queued (202); `followSessionJob` reports the
// rest. The title is sent so passages and citations name the file the way
// the visitor knows it.
export const ingestFile = async (
  file: File,
): Promise<SessionJob | ZizaFailure> => {
  const body = new FormData();
  body.append("file", file);
  body.append("details", JSON.stringify({ title: file.name }));

  const result = await callBff("/sessions/files", ZizaJobViewSchema, {
    method: "POST",
    data: body,
    timeout: 0,
  });
  return isZizaFailure(result) ? result : toSessionJob(result);
};

export const fetchSessionJob = async (
  jobId: string,
): Promise<SessionJob | ZizaFailure> => {
  const result = await callBff(
    `/sessions/jobs/${encodeURIComponent(jobId)}`,
    ZizaJobViewSchema,
  );
  return isZizaFailure(result) ? result : toSessionJob(result);
};

const JOB_EVENT_NAME = "job";
const MAX_JOB_STREAM_RECONNECTS = 5;
const JOB_STREAM_RECONNECT_DELAY_MS = 2000;

const isFinished = (job: SessionJob) =>
  job.status === "done" || job.status === "failed";

// Reports every change to a job until it finishes. ziza closes the stream once
// the job is done; EventSource would reconnect on that close, so it is closed
// here first. A dropped stream is checked with one read and reopened, a
// bounded number of times. Returns a function that stops following.
export function followSessionJob(
  jobId: string,
  onUpdate: (job: SessionJob) => void,
  onLost: (failure: ZizaFailure) => void,
): () => void {
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectCount = 0;
  let isStopped = false;

  const stop = () => {
    isStopped = true;
    eventSource?.close();
    clearTimeout(reconnectTimer);
  };

  const finishIfDone = (job: SessionJob) => {
    onUpdate(job);
    if (isFinished(job)) {
      stop();
    }
  };

  const open = () => {
    eventSource = new EventSource(
      `${ZIZA_BFF_BASE_URL}/sessions/jobs/${encodeURIComponent(jobId)}/events`,
    );
    eventSource.addEventListener(JOB_EVENT_NAME, (message) => {
      let payload: unknown;
      try {
        payload = JSON.parse((message as MessageEvent<string>).data);
      } catch {
        return;
      }
      const parsed = ZizaJobViewSchema.safeParse(payload);
      if (parsed.success) {
        finishIfDone(toSessionJob(parsed.data));
      }
    });
    eventSource.onerror = () => {
      eventSource?.close();
      if (isStopped) {
        return;
      }
      void fetchSessionJob(jobId).then((latest) => {
        if (isStopped) {
          return;
        }
        if (!isZizaFailure(latest)) {
          finishIfDone(latest);
          if (isFinished(latest)) {
            return;
          }
        }
        if (reconnectCount >= MAX_JOB_STREAM_RECONNECTS) {
          stop();
          onLost(
            isZizaFailure(latest)
              ? latest
              : { httpStatus: 0, message: "Lost track of this upload." },
          );
          return;
        }
        reconnectCount += 1;
        reconnectTimer = setTimeout(open, JOB_STREAM_RECONNECT_DELAY_MS);
      });
    };
  };

  open();
  return stop;
}

const MAX_UPLOAD_STARTER_QUESTIONS = 4;

// Starters are written by their own job, which ziza queues as the ingest job
// finishes; its result carries that upload's questions alone, where
// `sessions/suggestions` would mix in earlier documents. A failed, lost or
// skipped starters job changes nothing visible. Returns a function that stops
// waiting.
export function readUploadStartersOnceJobFinishes(
  startersJobId: string,
  onStarters: (starters: readonly string[]) => void,
  followJob: typeof followSessionJob = followSessionJob,
): () => void {
  return followJob(
    startersJobId,
    (job) => {
      if (job.status !== "done" || !job.starterQuestions?.length) {
        return;
      }
      onStarters(job.starterQuestions.slice(0, MAX_UPLOAD_STARTER_QUESTIONS));
    },
    () => {},
  );
}

// Not retryable: a decision is spent once ziza has it (409 after that).
export const resolveApproval = async (
  actionId: string,
  decision: ApprovalDecision,
): Promise<ResumedTurn | ZizaFailure> => {
  const result = await callBff(
    `/approvals/${encodeURIComponent(actionId)}`,
    ZizaResumedTurnSchema,
    { method: "POST", data: { decision }, timeout: 0 },
  );
  return isZizaFailure(result) ? result : toResumedTurn(result);
};

// Single use, and only URLs the offer listed. Each added URL becomes its own
// ingest job, followed like an upload.
export const resolveLinkOffer = async (
  offerId: string,
  selectedUrls: readonly string[],
): Promise<LinkOfferOutcome | ZizaFailure> => {
  const result = await callBff(
    `/sessions/link-offers/${encodeURIComponent(offerId)}`,
    ZizaLinkOfferOutcomeSchema,
    { method: "POST", data: { selected_urls: selectedUrls } },
  );
  return isZizaFailure(result) ? result : toLinkOfferOutcome(result);
};

export const fetchStarterQuestions = async (): Promise<
  readonly string[] | null
> => {
  const result = await callBff("/sessions/suggestions", ZizaStartersSchema);
  return isZizaFailure(result) ? null : result.starters;
};

// Newest page by default; pass a prior page's `nextBefore` as `before` to walk
// backwards.
export const fetchChatHistory = async (
  options: { limit?: number; before?: string } = {},
): Promise<ChatHistoryPage | null> => {
  const result = await callBff("/chat/history", ZizaHistoryPageSchema, {
    params: options,
  });
  return isZizaFailure(result) ? null : toChatHistoryPage(result);
};

// One page is enough: a session holds at most a handful of documents.
const SOURCES_PAGE_LIMIT = 50;

export const fetchSessionSources = async (): Promise<
  readonly KnowledgeSource[] | null
> => {
  const result = await callBff("/sessions/sources", ZizaSourcesPageSchema, {
    params: { limit: SOURCES_PAGE_LIMIT },
  });
  return isZizaFailure(result) ? null : toSessionSources(result);
};

// Resolves to null on success.
export const removeSource = async (
  sourceId: string,
): Promise<ZizaFailure | null> => {
  const result = await callBff(
    `/sessions/sources/${encodeURIComponent(sourceId)}`,
    ZizaSourceRemovedSchema,
    { method: "DELETE" },
  );
  return isZizaFailure(result) ? result : null;
};
