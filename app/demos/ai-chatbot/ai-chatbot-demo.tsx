"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isTextUIPart } from "ai";
import type { UIMessage } from "ai";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaQuery } from "@/lib/use-media-query";
import { toPendingApproval, toPendingLinkOffer } from "@/lib/ziza/ziza.mapper";
import {
  CitationPartSchema,
  UnfinishedActionPartSchema,
  parseZizaChatEvent,
} from "@/lib/ziza/ziza.schema";
import {
  DEMO_MAX_DOCUMENTS_PER_SESSION,
  ZIZA_STREAM_ROUTE,
  clearZizaSession,
  ensureZizaSession,
  fetchChatHistory,
  fetchSessionSources,
  fetchStarterQuestions,
  fetchWithSessionRenewalCheck,
  followSessionJob,
  ingestFile,
  isZizaFailure,
  readChatStreamFailure,
  readUploadStartersOnceJobFinishes,
  removeSource,
  resolveApproval,
  resolveLinkOffer,
  subscribeToSessionRenewal,
} from "@/lib/ziza/ziza.service";
import {
  type ApprovalDecision,
  type ChatHistoryTurn,
  type Citation,
  type SessionJob,
  type InspectorEntry,
  type KnowledgeSource,
  type PendingCall,
  type RetrievedPassage,
  type ZizaFailure,
} from "@/lib/ziza/ziza.types";
import {
  ChatPanel,
  type ChatTurn,
  type StarterQuestionsOrigin,
} from "./chat-panel";
import { InspectorPanel } from "./inspector-panel";
import { SourcesPanel } from "./sources-panel";

const MAX_INSPECTOR_ENTRIES = 200;

type StarterOffer = {
  questions: readonly string[];
  origin: StarterQuestionsOrigin;
};

const NO_STARTERS: StarterOffer = { questions: [], origin: "recovered" };
const ELAPSED_TICK_MS = 1000;

const CITATIONS_PART_TYPE = "data-citations";
const UNFINISHED_ACTION_PART_TYPE = "data-unfinished-action";
const ZIZA_EVENT_PART_TYPE = "data-ziza";

// Keyed on ziza's `details.code`. A code missing here falls back to the
// message ziza sent with it.
const FAILURE_MESSAGE_BY_CODE: Record<string, string> = {
  invalid_server_secret: "The demo is misconfigured. Try again later.",
  product_needs_attention: "The demo is misconfigured. Try again later.",
  bff_not_configured: "The demo is misconfigured. Try again later.",
  missing_client_ip: "The demo is misconfigured. Try again later.",
  product_disabled: "The demo is turned off right now.",
  upstream_unreachable: "The knowledge base is offline right now.",
  model_unavailable: "The model is unavailable. Try again shortly.",
  turn_in_progress: "Let the current answer finish first.",
  message_too_long: "That message is too long.",
  duplicate_source: "That document is already in this session.",
  session_document_limit: `This session already holds ${DEMO_MAX_DOCUMENTS_PER_SESSION} documents. Remove one first.`,
  upload_too_large: "Too big. The cap is 25MB.",
  unsupported_document: "We can't read that kind of file.",
  approval_expired:
    "That's no longer waiting on you. Ask again if you still want it.",
  approval_already_decided: "That was already answered.",
};

function describeFailure(failure: ZizaFailure): string {
  if (failure.code === "rate_limited" || failure.code === "spend_cap_reached") {
    const wait = failure.retryAfterSeconds
      ? ` Try again in ${Math.ceil(failure.retryAfterSeconds)}s.`
      : "";
    return `${failure.message ?? "Too many requests."}${wait}`;
  }
  return (
    (failure.code ? FAILURE_MESSAGE_BY_CODE[failure.code] : undefined) ??
    failure.message ??
    `Failed (${failure.httpStatus}).`
  );
}

// A failure that means the card can never be answered, so it should go.
const isSpentDecision = (failure: ZizaFailure) =>
  failure.httpStatus === 404 || failure.httpStatus === 409;

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const toUIMessage = (turn: ChatHistoryTurn): UIMessage => ({
  id: turn.id,
  role: turn.role,
  parts: [
    { type: "text", text: turn.text },
    ...(turn.citations.length > 0
      ? [{ type: CITATIONS_PART_TYPE, data: turn.citations } as const]
      : []),
    ...(turn.unfinishedAction
      ? [
          {
            type: UNFINISHED_ACTION_PART_TYPE,
            data: turn.unfinishedAction,
          } as const,
        ]
      : []),
  ],
});

function readMessageCitations(message: UIMessage): readonly Citation[] {
  const citationsPart = message.parts.findLast(
    (part) => part.type === CITATIONS_PART_TYPE,
  );
  if (!citationsPart || !("data" in citationsPart)) {
    return [];
  }
  const parsed = CitationPartSchema.safeParse(citationsPart.data);
  return parsed.success ? parsed.data : [];
}

function readMessageUnfinishedAction(message: UIMessage) {
  const actionPart = message.parts.find(
    (part) => part.type === UNFINISHED_ACTION_PART_TYPE,
  );
  if (!actionPart || !("data" in actionPart)) {
    return undefined;
  }
  const parsed = UnfinishedActionPartSchema.safeParse(actionPart.data);
  return parsed.success ? parsed.data : undefined;
}

const citedSourceIds = (citations: readonly Citation[]): string[] =>
  citations.flatMap((citation) =>
    citation.sourceId ? [citation.sourceId] : [],
  );

// Shape is only known at runtime, so narrow rather than trusting a cast.
function readEventType(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const candidate = (payload as { type?: unknown }).type;
  return typeof candidate === "string" ? candidate : undefined;
}

const isBusySource = (source: KnowledgeSource) =>
  source.status === "uploading" || source.status === "processing";

// A re-read is authoritative for what ziza has finished, but knows nothing of
// rows this page is still uploading or that failed locally. A pending server
// row is most likely one of the local busy rows, so it is left out while any
// are in flight rather than shown twice.
function mergeRestoredSources(
  current: readonly KnowledgeSource[],
  restored: readonly KnowledgeSource[],
): readonly KnowledgeSource[] {
  const localOnlyRows = current.filter((source) => !source.sourceId);
  const hasLocalBusyRows = localOnlyRows.some(isBusySource);
  return [
    ...restored.filter(
      (source) => !(hasLocalBusyRows && source.status === "processing"),
    ),
    ...localOnlyRows,
  ];
}

type StreamFailure = {
  message: string;
  retryAfterSeconds?: number;
};

export function AiChatbotDemo() {
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [sessionFailureMessage, setSessionFailureMessage] = useState<
    string | undefined
  >(undefined);
  const [sources, setSources] = useState<readonly KnowledgeSource[]>([]);
  const [entries, setEntries] = useState<readonly InspectorEntry[]>([]);
  const [passages, setPassages] = useState<readonly RetrievedPassage[]>([]);
  const [activeSourceIds, setActiveSourceIds] = useState<readonly string[]>([]);
  const [pendingCalls, setPendingCalls] = useState<readonly PendingCall[]>([]);
  const [resolvingCallId, setResolvingCallId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  // `useChat`'s own `error` never fires for a mid-stream failure: the response
  // is a clean 200 that ends normally, so the event is the only signal.
  const [streamFailure, setStreamFailure] = useState<StreamFailure | null>(
    null,
  );
  const [isRetryHeldBack, setIsRetryHeldBack] = useState(false);
  // Failures of the actions around the chat (cards, clear), which have no
  // other place to be read.
  const [actionFailureMessage, setActionFailureMessage] = useState<
    string | undefined
  >(undefined);
  // Its own slot, not shared with the follow-ups: an upload can finish while
  // an unclicked follow-up is showing, and sharing would wipe it.
  const [starterOffer, setStarterOffer] = useState<StarterOffer>(NO_STARTERS);
  // A ref so the mount's starters decision sees a message the visitor sent
  // while history and starters were still loading.
  const hasConversationTurns = useRef(false);
  const nextEntryId = useRef(0);
  const nextPassageId = useRef(0);
  // Refs, not state: the cursor is never rendered, and a scroll handler firing
  // between renders must see the current value.
  const nextHistoryBefore = useRef<string | null>(null);
  const isLoadingOlderTurns = useRef(false);
  // One per job being followed (a row's ingest job by row id, its starters
  // job by `<row id>:starters`), so clearing the session or unmounting can
  // stop them all.
  const jobFollowerStops = useRef(new Map<string, () => void>());
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Only ticks while an upload is in flight: a long extraction with a frozen
  // row reads as hung, but an idle panel shouldn't repaint forever.
  const [elapsedTick, setElapsedTick] = useState(() => Date.now());
  const hasBusySource = sources.some(isBusySource);

  useEffect(() => {
    if (!hasBusySource) {
      return;
    }
    const interval = setInterval(
      () => setElapsedTick(Date.now()),
      ELAPSED_TICK_MS,
    );
    return () => clearInterval(interval);
  }, [hasBusySource]);

  useEffect(() => {
    if (!isRetryHeldBack || !streamFailure?.retryAfterSeconds) {
      return;
    }
    const release = setTimeout(
      () => setIsRetryHeldBack(false),
      streamFailure.retryAfterSeconds * 1000,
    );
    return () => clearTimeout(release);
  }, [isRetryHeldBack, streamFailure]);

  const pushEntry = useCallback(
    (level: InspectorEntry["level"], label: string, detail?: string) => {
      setEntries((current) =>
        [
          ...current,
          {
            id: nextEntryId.current++,
            time: formatTime(),
            level,
            label,
            detail,
          },
        ].slice(-MAX_INSPECTOR_ENTRIES),
      );
    },
    [],
  );

  const updateSource = useCallback(
    (rowId: string, changes: Partial<KnowledgeSource>) => {
      setSources((current) =>
        current.map((source) =>
          source.id === rowId ? { ...source, ...changes } : source,
        ),
      );
    },
    [],
  );

  const stopFollowingAllJobs = useCallback(() => {
    jobFollowerStops.current.forEach((stop) => stop());
    jobFollowerStops.current.clear();
  }, []);

  useEffect(() => stopFollowingAllJobs, [stopFollowingAllJobs]);

  const refreshStartersWhenJobFinishes = useCallback(
    (rowId: string, startersJobId: string) => {
      const followerKey = `${rowId}:starters`;
      const stop = readUploadStartersOnceJobFinishes(
        startersJobId,
        (starters) => {
          jobFollowerStops.current.delete(followerKey);
          setStarterOffer({ questions: starters, origin: "upload" });
          pushEntry("info", "starter_questions.offered", starters.join(" · "));
        },
      );
      jobFollowerStops.current.set(followerKey, stop);
    },
    [pushEntry],
  );

  const applyJobToRow = useCallback(
    (rowId: string, label: string, job: SessionJob) => {
      if (job.status === "queued" || job.status === "processing") {
        updateSource(rowId, {
          status: "processing",
          progressLabel: job.progressLabel,
        });
        return;
      }

      jobFollowerStops.current.delete(rowId);

      if (job.status === "failed" || !job.result) {
        const message = job.errorMessage ?? "Indexing failed.";
        updateSource(rowId, {
          status: "failed",
          jobId: undefined,
          startedAt: undefined,
          progressLabel: undefined,
          errorDetail: message,
        });
        pushEntry("error", "knowledge.failed", `${label}: ${message}`);
        return;
      }

      const { result } = job;
      updateSource(rowId, {
        sourceId: result.sourceId,
        jobId: undefined,
        status: "indexed",
        chunkCount: result.chunks,
        startedAt: undefined,
        progressLabel: undefined,
        imagesDescribed: result.imagesDescribed,
        imagesSkipped: result.imagesSkipped,
        imagesFailed: result.imagesFailed,
      });
      pushEntry(
        result.imagesFailed > 0 ? "error" : "info",
        "knowledge.indexed",
        `${label} · ${result.chunks} chunks · ${result.imagesDescribed} images`,
      );
      if (job.startersJobId) {
        refreshStartersWhenJobFinishes(rowId, job.startersJobId);
      }
    },
    [pushEntry, refreshStartersWhenJobFinishes, updateSource],
  );

  const followJobForRow = useCallback(
    (rowId: string, label: string, jobId: string) => {
      const stop = followSessionJob(
        jobId,
        (job) => applyJobToRow(rowId, label, job),
        (failure) => {
          jobFollowerStops.current.delete(rowId);
          const message = describeFailure(failure);
          updateSource(rowId, {
            status: "failed",
            jobId: undefined,
            startedAt: undefined,
            errorDetail: message,
          });
          pushEntry("error", "knowledge.lost", `${label}: ${message}`);
        },
      );
      jobFollowerStops.current.set(rowId, stop);
    },
    [applyJobToRow, pushEntry, updateSource],
  );

  // The BFF replaced a session ziza no longer knew, so everything this page
  // shows from the old one is gone server-side. Uploads still in flight land
  // in the new session, so their rows stay.
  useEffect(
    () =>
      subscribeToSessionRenewal(() => {
        stopFollowingAllJobs();
        setSources((current) =>
          current.filter((source) => source.status === "uploading"),
        );
        setPendingCalls([]);
        setStarterOffer(NO_STARTERS);
        setActiveSourceIds([]);
        nextHistoryBefore.current = null;
        pushEntry(
          "info",
          "session.renewed",
          "The previous session had ended; its documents are gone.",
        );
      }),
    [pushEntry, stopFollowingAllJobs],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: ZIZA_STREAM_ROUTE,
        fetch: fetchWithSessionRenewalCheck,
        prepareSendMessagesRequest: ({ messages }) => {
          const lastMessage = messages.at(-1);
          const message =
            lastMessage?.parts
              .filter(isTextUIPart)
              .map((part) => part.text)
              .join("") ?? "";
          return { body: { message } };
        },
      }),
    [],
  );

  const handleData = useCallback(
    (dataPart: { type: string; data?: unknown }) => {
      if (dataPart.type === CITATIONS_PART_TYPE) {
        const parsed = CitationPartSchema.safeParse(dataPart.data);
        if (parsed.success) {
          setActiveSourceIds(citedSourceIds(parsed.data));
          pushEntry(
            "info",
            "citations",
            parsed.data
              .map(
                (citation) =>
                  `[${citation.number}] ${citation.sourceRef ?? "?"}`,
              )
              .join(" · "),
          );
        }
        return;
      }
      if (dataPart.type !== ZIZA_EVENT_PART_TYPE) {
        return;
      }

      const payload = dataPart.data;
      const eventType = readEventType(payload);
      if (eventType === "stream_open") {
        pushEntry("open", "stream.open", ZIZA_STREAM_ROUTE);
        return;
      }
      if (eventType === "stream_close") {
        pushEntry("done", "stream.close");
        return;
      }

      const chatEvent = eventType
        ? parseZizaChatEvent(eventType, payload)
        : null;
      if (!chatEvent) {
        pushEntry(
          "error",
          "event.malformed",
          `A ${eventType ?? "nameless"} event arrived that the UI could not read.`,
        );
        return;
      }

      switch (chatEvent.type) {
        case "searching":
          pushEntry("info", "searching");
          break;
        case "working":
          if (chatEvent.kind === "passages" && chatEvent.passages) {
            const found = chatEvent.passages;
            setPassages((current) => [
              ...current,
              ...found.map((passage) => ({
                id: nextPassageId.current++,
                number: passage.number,
                title: passage.title ?? undefined,
                locator: passage.locator ?? undefined,
                excerpt: passage.excerpt ?? undefined,
              })),
            ]);
            pushEntry("tool", "passages", `${found.length} found`);
          } else if (chatEvent.kind === "query") {
            pushEntry("tool", "query", chatEvent.query ?? undefined);
          } else if (chatEvent.kind === "tool") {
            pushEntry(
              "tool",
              `tool: ${chatEvent.tool ?? "unknown"}`,
              chatEvent.status ?? undefined,
            );
          } else {
            pushEntry("tool", `working: ${chatEvent.kind}`);
          }
          break;
        case "approval_required": {
          const approval = toPendingApproval(chatEvent);
          setPendingCalls((current) => [
            ...current.filter((existing) => existing.id !== approval.id),
            approval,
          ]);
          pushEntry(
            "tool",
            "approval.required",
            `${approval.toolName} · ${approval.id}`,
          );
          break;
        }
        case "links_offered": {
          const offer = toPendingLinkOffer(chatEvent);
          setPendingCalls((current) => [
            ...current.filter((existing) => existing.id !== offer.id),
            offer,
          ]);
          pushEntry(
            "tool",
            "links.offered",
            `${offer.pageUrl} + ${offer.links.length} link(s)`,
          );
          break;
        }
        case "done":
          pushEntry(
            "done",
            "turn.done",
            `answered: ${chatEvent.answered ?? "?"} · small_talk: ${chatEvent.small_talk ?? "?"}`,
          );
          if (chatEvent.refusal) {
            pushEntry(
              "info",
              `refusal: ${chatEvent.refusal.kind}`,
              chatEvent.refusal.redirect ?? undefined,
            );
          }
          break;
        case "suggestions":
          setSuggestions(chatEvent.follow_ups);
          pushEntry(
            "info",
            "suggestions.offered",
            chatEvent.follow_ups.join(" · "),
          );
          break;
        case "limit": {
          const message = describeFailure({
            httpStatus: 429,
            code: chatEvent.code,
            message: chatEvent.message ?? undefined,
            retryAfterSeconds: chatEvent.retry_after_seconds ?? undefined,
          });
          setStreamFailure({
            message,
            retryAfterSeconds: chatEvent.retry_after_seconds ?? undefined,
          });
          setIsRetryHeldBack(Boolean(chatEvent.retry_after_seconds));
          pushEntry("error", `limit: ${chatEvent.code}`, message);
          break;
        }
        case "error": {
          const message = describeFailure({
            httpStatus: 0,
            code: chatEvent.code ?? undefined,
            message: chatEvent.message ?? "The answer was cut short.",
          });
          setStreamFailure({ message });
          pushEntry("error", `stream.error: ${chatEvent.code ?? "?"}`, message);
          break;
        }
        default:
          break;
      }
    },
    [pushEntry],
  );

  const { messages, sendMessage, setMessages, status, error, clearError } =
    useChat({
      transport,
      onData: handleData,
    });

  useEffect(() => {
    hasConversationTurns.current = messages.length > 0;
  }, [messages]);

  useEffect(() => {
    let isActive = true;
    void ensureZizaSession().then((session) => {
      if (!isActive) {
        return;
      }
      if (isZizaFailure(session)) {
        const message = describeFailure(session);
        setSessionFailureMessage(message);
        pushEntry("error", "session.failed", message);
        return;
      }
      setIsSessionReady(true);
      pushEntry(
        "info",
        "session.ready",
        session.isNewSession ? "new session" : "resumed",
      );
      if (session.isNewSession) {
        return;
      }

      const historyLoaded = fetchChatHistory().then((page) => {
        if (!isActive || !page) {
          return page;
        }
        nextHistoryBefore.current = page.nextBefore;
        if (page.turns.length === 0) {
          return page;
        }
        const restoredMessages = page.turns.map(toUIMessage);
        // The visitor can send before this lands, and `useChat` will have
        // appended it already.
        setMessages((current) =>
          current.length > 0 ? current : restoredMessages,
        );
        pushEntry(
          "info",
          "history.restored",
          `${page.turns.length} messages · more: ${page.nextBefore !== null}`,
        );
        return page;
      });

      void fetchSessionSources().then((restored) => {
        if (!isActive || !restored || restored.length === 0) {
          return;
        }
        setSources((current) => mergeRestoredSources(current, restored));
        pushEntry(
          "info",
          "sources.restored",
          restored.map((source) => source.label).join(", "),
        );
      });

      // Starters belong to an empty conversation, so they wait for the
      // history rather than flashing before it lands. An unreadable history
      // might still hold turns, so it shows none.
      void Promise.all([historyLoaded, fetchStarterQuestions()]).then(
        ([page, starters]) => {
          const isConversationEmpty =
            page !== null &&
            page.turns.length === 0 &&
            !hasConversationTurns.current;
          if (
            !isActive ||
            !isConversationEmpty ||
            !starters ||
            starters.length === 0
          ) {
            return;
          }
          setStarterOffer({ questions: starters, origin: "recovered" });
          pushEntry(
            "info",
            "starter_questions.recovered",
            starters.join(" · "),
          );
        },
      );
    });
    return () => {
      isActive = false;
    };
  }, [pushEntry, setMessages]);

  const turns: ChatTurn[] = useMemo(() => {
    const mapped: ChatTurn[] = messages.map((message: UIMessage) => ({
      id: message.id,
      role: message.role === "user" ? "user" : "assistant",
      text: message.parts
        .filter(isTextUIPart)
        .map((part) => part.text)
        .join(""),
      citations: readMessageCitations(message),
      unfinishedAction: readMessageUnfinishedAction(message),
    }));

    // In flight but no delta yet: the typing indicator needs a turn to
    // attach to.
    if (status === "submitted") {
      mapped.push({ id: "pending-response", role: "assistant", text: "" });
    }

    return mapped;
  }, [messages, status]);

  const isStreaming = status === "submitted" || status === "streaming";

  const documentsHeld = sources.filter(
    (source) => source.status !== "failed",
  ).length;
  const capacity = {
    used: documentsHeld,
    allowed: DEMO_MAX_DOCUMENTS_PER_SESSION,
  };

  // The cursor and the in-flight guard live here, so the panel only ever calls
  // this and trusts it to no-op when there is nothing to fetch.
  const loadOlderTurns = useCallback(() => {
    if (isLoadingOlderTurns.current || !nextHistoryBefore.current) {
      return;
    }
    isLoadingOlderTurns.current = true;

    void fetchChatHistory({ before: nextHistoryBefore.current }).then(
      (page) => {
        isLoadingOlderTurns.current = false;
        if (!page) {
          return;
        }
        nextHistoryBefore.current = page.nextBefore;

        setMessages((current) => {
          const seen = new Set(current.map((message) => message.id));
          const older = page.turns
            .filter((turn) => !seen.has(turn.id))
            .map(toUIMessage);
          return older.length > 0 ? [...older, ...current] : current;
        });
      },
    );
  }, [setMessages]);

  const handleSend = useCallback(
    (message: string) => {
      setStreamFailure(null);
      setIsRetryHeldBack(false);
      setActionFailureMessage(undefined);
      setPassages([]);
      setActiveSourceIds([]);
      setSuggestions([]);
      setStarterOffer(NO_STARTERS);
      if (pendingCalls.length > 0) {
        // A new message cancels a waiting approval on ziza's side; an offer
        // simply expires.
        setPendingCalls([]);
        pushEntry(
          "info",
          "pending.superseded",
          pendingCalls.map((call) => call.id).join(", "),
        );
      }
      pushEntry("info", "request.send", `${message.length} chars`);
      void sendMessage({ text: message });
    },
    [pendingCalls, pushEntry, sendMessage],
  );

  // The failed exchange stays in the transcript rather than being rewound: it
  // is the visitor's evidence something went wrong, and re-sending is a fresh
  // request either way — the server kept nothing from the failed turn.
  const handleRetry = useCallback(() => {
    const lastUserMessage = messages.findLast(
      (message: UIMessage) => message.role === "user",
    );
    const text =
      lastUserMessage?.parts
        .filter(isTextUIPart)
        .map((part) => part.text)
        .join("") ?? "";
    if (text === "") {
      return;
    }
    pushEntry("info", "stream.retry", `${text.length} chars`);
    handleSend(text);
  }, [handleSend, messages, pushEntry]);

  const reloadSessionSources = useCallback(() => {
    void fetchSessionSources().then((restored) => {
      if (!restored) {
        pushEntry("error", "sources.reload_failed");
        return;
      }
      setSources((current) => mergeRestoredSources(current, restored));
      pushEntry(
        "info",
        "sources.reloaded",
        `${restored.length} source(s) in the session`,
      );
    });
  }, [pushEntry]);

  const removePendingCall = useCallback((callId: string) => {
    setPendingCalls((current) => current.filter((call) => call.id !== callId));
  }, []);

  const handleApprovalDecision = useCallback(
    (actionId: string, decision: ApprovalDecision) => {
      const call = pendingCalls.find((pending) => pending.id === actionId);
      if (!call || call.kind !== "approval") {
        return;
      }
      setResolvingCallId(actionId);
      setActionFailureMessage(undefined);
      pushEntry(
        "tool",
        decision === "approve" ? "approval.confirmed" : "approval.declined",
        `${call.toolName} · ${actionId}`,
      );

      void resolveApproval(actionId, decision).then((outcome) => {
        setResolvingCallId(null);

        if (isZizaFailure(outcome)) {
          if (isSpentDecision(outcome)) {
            removePendingCall(actionId);
          }
          const message = describeFailure(outcome);
          setActionFailureMessage(message);
          pushEntry("error", "approval.failed", message);
          return;
        }

        removePendingCall(actionId);
        const nextApproval = outcome.approvalRequired;
        if (nextApproval) {
          setPendingCalls((current) => [...current, nextApproval]);
          pushEntry(
            "tool",
            "approval.required",
            `${nextApproval.toolName} · ${nextApproval.id}`,
          );
        }

        // The resumed turn did not go through `useChat`, so it is added here.
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            parts: [
              { type: "text", text: outcome.text },
              ...(outcome.citations.length > 0
                ? [
                    {
                      type: CITATIONS_PART_TYPE,
                      data: outcome.citations,
                    } as const,
                  ]
                : []),
            ],
          },
        ]);
        setSuggestions(outcome.followUps);
        setActiveSourceIds(citedSourceIds(outcome.citations));
        if (outcome.failure) {
          const message = describeFailure({
            httpStatus: 0,
            code: outcome.failure.code,
            message: outcome.failure.message,
          });
          setStreamFailure({ message });
          pushEntry("error", "approval.turn_failed", message);
        }

        // Only now has the tool actually run, and what it did is ziza's to
        // say, so the panel is re-read rather than assumed empty.
        if (decision === "approve") {
          reloadSessionSources();
        }
      });
    },
    [
      pendingCalls,
      pushEntry,
      reloadSessionSources,
      removePendingCall,
      setMessages,
    ],
  );

  const handleLinkSelection = useCallback(
    (offerId: string, selectedLinks: readonly string[]) => {
      const offer = pendingCalls.find((pending) => pending.id === offerId);
      if (!offer || offer.kind !== "link_offer") {
        return;
      }
      setResolvingCallId(offerId);
      setActionFailureMessage(undefined);
      const selectedUrls = [
        offer.pageUrl,
        ...selectedLinks.filter((url) => url !== offer.pageUrl),
      ];
      pushEntry(
        "tool",
        "links.submitted",
        `${offer.pageUrl} + ${selectedLinks.length} link(s)`,
      );

      void resolveLinkOffer(offerId, selectedUrls).then((outcome) => {
        setResolvingCallId(null);

        if (isZizaFailure(outcome)) {
          if (isSpentDecision(outcome)) {
            removePendingCall(offerId);
          }
          const message = describeFailure(outcome);
          setActionFailureMessage(message);
          pushEntry("error", "links.failed", message);
          return;
        }

        removePendingCall(offerId);
        const titleByUrl = new Map([
          [offer.pageUrl, offer.pageTitle],
          ...offer.links.map((link) => [link.url, link.title] as const),
        ]);
        const startedAt = Date.now();
        const addedRows: KnowledgeSource[] = outcome.added.map((added) => ({
          id: crypto.randomUUID(),
          jobId: added.jobId,
          label: titleByUrl.get(added.url) ?? added.url,
          kind: "url",
          chunkCount: 0,
          status: "processing",
          startedAt,
        }));
        const refusedRows: KnowledgeSource[] = outcome.refused.map(
          (refused) => ({
            id: crypto.randomUUID(),
            label: titleByUrl.get(refused.url) ?? refused.url,
            kind: "url",
            chunkCount: 0,
            status: "failed",
            errorDetail: describeFailure({
              httpStatus: 0,
              code: refused.code,
              message: refused.message,
            }),
          }),
        );
        setSources((current) => [...current, ...addedRows, ...refusedRows]);
        for (const row of addedRows) {
          if (row.jobId) {
            followJobForRow(row.id, row.label, row.jobId);
          }
        }
        pushEntry(
          outcome.refused.length > 0 ? "error" : "info",
          "links.accepted",
          `${outcome.added.length} added · ${outcome.refused.length} refused`,
        );
      });
    },
    [followJobForRow, pendingCalls, pushEntry, removePendingCall],
  );

  const handleDismissCall = useCallback(
    (callId: string) => {
      removePendingCall(callId);
      pushEntry("info", "pending.dismissed", callId);
    },
    [pushEntry, removePendingCall],
  );

  const handleAddFile = useCallback(
    (file: File) => {
      const rowId = crypto.randomUUID();
      setSources((current) => [
        ...current,
        {
          id: rowId,
          label: file.name,
          kind: "file",
          chunkCount: 0,
          status: "uploading",
          startedAt: Date.now(),
        },
      ]);
      pushEntry(
        "info",
        "knowledge.upload",
        `${file.name} · ${(file.size / 1024).toFixed(0)}KB`,
      );

      void ingestFile(file).then((outcome) => {
        if (isZizaFailure(outcome)) {
          const message = describeFailure(outcome);
          updateSource(rowId, {
            status: "failed",
            startedAt: undefined,
            errorDetail: message,
          });
          pushEntry(
            "error",
            "knowledge.upload_failed",
            `${file.name}: ${message}`,
          );
          return;
        }

        updateSource(rowId, { jobId: outcome.id, status: "processing" });
        pushEntry(
          "info",
          "knowledge.queued",
          `${file.name} · job ${outcome.id}`,
        );
        followJobForRow(rowId, file.name, outcome.id);
      });
    },
    [followJobForRow, pushEntry, updateSource],
  );

  const handleRemoveSource = useCallback(
    (source: KnowledgeSource) => {
      const removeRow = () =>
        setSources((current) =>
          current.filter((existing) => existing.id !== source.id),
        );
      // A row that never reached ziza has nothing to delete there.
      if (!source.sourceId) {
        removeRow();
        return;
      }
      void removeSource(source.sourceId).then((failure) => {
        if (failure) {
          const message = describeFailure(failure);
          updateSource(source.id, { errorDetail: message });
          pushEntry(
            "error",
            "knowledge.remove_failed",
            `${source.label}: ${message}`,
          );
          return;
        }
        removeRow();
        setActiveSourceIds((current) =>
          current.filter((sourceId) => sourceId !== source.sourceId),
        );
        pushEntry("info", "knowledge.removed", source.label);
      });
    },
    [pushEntry, updateSource],
  );

  // Ends the whole session, so the conversation goes with the documents.
  const handleClearSession = useCallback(() => {
    void clearZizaSession().then((failure) => {
      if (failure) {
        const message = describeFailure(failure);
        setActionFailureMessage(message);
        pushEntry("error", "session.clear_failed", message);
        return;
      }
      stopFollowingAllJobs();
      setMessages([]);
      clearError();
      setSources([]);
      setPendingCalls([]);
      setSuggestions([]);
      setStarterOffer(NO_STARTERS);
      setPassages([]);
      setActiveSourceIds([]);
      setStreamFailure(null);
      setActionFailureMessage(undefined);
      nextHistoryBefore.current = null;
      pushEntry("info", "session.cleared", "documents and chat deleted");
    });
  }, [clearError, pushEntry, setMessages, stopFollowingAllJobs]);

  const chatErrorMessage = error
    ? describeFailure(readChatStreamFailure(error))
    : undefined;

  const sourcesPanel = (
    <SourcesPanel
      sources={sources}
      activeSourceIds={activeSourceIds}
      isReady={isSessionReady}
      elapsedTick={elapsedTick}
      capacity={capacity}
      onAddFileAction={handleAddFile}
      onRemoveSourceAction={handleRemoveSource}
      onClearSessionAction={handleClearSession}
    />
  );

  const inspectorPanel = (
    <InspectorPanel
      entries={entries}
      passages={passages}
      onClearAction={() => {
        setEntries([]);
        setPassages([]);
      }}
    />
  );

  const chatPanel = (
    <ChatPanel
      turns={turns}
      isStreaming={isStreaming}
      isReady={isSessionReady}
      errorMessage={
        chatErrorMessage ?? actionFailureMessage ?? sessionFailureMessage
      }
      pendingCalls={pendingCalls}
      suggestions={suggestions}
      starterQuestions={starterOffer.questions}
      starterQuestionsOrigin={starterOffer.origin}
      resolvingCallId={resolvingCallId}
      slotsLeft={Math.max(0, capacity.allowed - capacity.used)}
      streamFailureMessage={streamFailure?.message}
      canRetry={streamFailure !== null && !isStreaming && !isRetryHeldBack}
      onRetryAction={handleRetry}
      onSendAction={handleSend}
      onLoadOlderTurnsAction={loadOlderTurns}
      onApprovalDecisionAction={handleApprovalDecision}
      onLinkSelectionAction={handleLinkSelection}
      onDismissCallAction={handleDismissCall}
    />
  );

  if (!isDesktop) {
    return (
      <div className="border-border bg-background flex h-[70vh] min-h-[480px] flex-col overflow-hidden rounded-lg border">
        <div className="min-h-0 flex-1">{chatPanel}</div>
        <div className="border-border shrink-0 border-t p-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
                <SlidersHorizontalIcon weight="bold" data-icon="inline-start" />
                {sources.length} sources · {entries.length} events
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[80vh] p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Sources and inspector</SheetTitle>
              </SheetHeader>
              <Tabs
                defaultValue="sources"
                className="flex h-full flex-col gap-0"
              >
                <TabsList className="m-2 shrink-0">
                  <TabsTrigger value="sources">Sources</TabsTrigger>
                  <TabsTrigger value="inspector">Inspector</TabsTrigger>
                </TabsList>
                <TabsContent value="sources" className="mt-0 min-h-0 flex-1">
                  {sourcesPanel}
                </TabsContent>
                <TabsContent value="inspector" className="mt-0 min-h-0 flex-1">
                  {inspectorPanel}
                </TabsContent>
              </Tabs>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[70vh] min-h-[520px]">
      <ResizablePanelGroup
        orientation="horizontal"
        className="border-border bg-background rounded-lg border"
      >
        <ResizablePanel defaultSize="20%" minSize="14%" maxSize="32%">
          {sourcesPanel}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="52%" minSize="30%">
          {chatPanel}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="28%" minSize="18%" maxSize="44%">
          {inspectorPanel}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
