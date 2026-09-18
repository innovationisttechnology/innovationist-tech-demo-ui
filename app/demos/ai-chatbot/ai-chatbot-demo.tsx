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
import { getSessionId } from "@/lib/content-sync/session";
import { useMediaQuery } from "@/lib/use-media-query";
import { toPendingCall } from "@/lib/ziza/ziza.mapper";
import {
  ZizaApprovalRequiredEventSchema,
  ZizaInputRequiredEventSchema,
  ZizaSuggestionsEventSchema,
} from "@/lib/ziza/ziza.schema";
import {
  ZIZA_STREAM_ROUTE,
  clearKnowledge,
  fetchChatHistory,
  fetchSessionSources,
  fetchStarterQuestions,
  ingestFile,
  isDeferralFailure,
  isIngestFailure,
  resolveApproval,
  resolveLinkSelection,
} from "@/lib/ziza/ziza.service";
import {
  type ChatHistoryTurn,
  type InspectorEntry,
  type DeferralResult,
  type KnowledgeSource,
  type PendingCall,
  type RetrievedChunk,
  type Suggestion,
} from "@/lib/ziza/ziza.types";
import { ChatPanel, type ChatTurn } from "./chat-panel";
import { InspectorPanel } from "./inspector-panel";
import { SourcesPanel } from "./sources-panel";

const MAX_INSPECTOR_ENTRIES = 200;
const ELAPSED_TICK_MS = 1000;

// Status codes come straight from `app/ziza_chat/router.py`.
const UPLOAD_FAILURE_MESSAGE: Record<number, string> = {
  413: "Too big. The cap is 25MB.",
  415: "We can't read that kind of file.",
  422: "That file arrived empty.",
  503: "The knowledge base is offline right now.",
};

const DEFERRAL_FAILURE_MESSAGE: Record<number, string> = {
  409: "That's no longer waiting on you. Ask again if you still want it.",
  422: "Some of those links weren't part of this offer.",
  503: "This isn't available in the current session.",
};

function failureMessage(
  messages: Record<number, string>,
  status: number,
  detail?: string,
): string {
  return detail ?? messages[status] ?? `Failed (${status}).`;
}

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const toUIMessage = (turn: ChatHistoryTurn): UIMessage => ({
  id: turn.id,
  role: turn.role,
  parts: [{ type: "text", text: turn.text }],
});

// Shape is only known at runtime, so narrow rather than trusting a cast.
function readEventType(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const candidate = (payload as { type?: unknown }).type;
  return typeof candidate === "string" ? candidate : undefined;
}

export function AiChatbotDemo() {
  const [sessionId, setSessionId] = useState("");
  const [sources, setSources] = useState<readonly KnowledgeSource[]>([]);
  const [entries, setEntries] = useState<readonly InspectorEntry[]>([]);
  const [chunks, setChunks] = useState<readonly RetrievedChunk[]>([]);
  const [activeSourceLabels, setActiveSourceLabels] = useState<
    readonly string[]
  >([]);
  const [pendingCalls, setPendingCalls] = useState<readonly PendingCall[]>([]);
  const [resolvingCallId, setResolvingCallId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  // `useChat`'s own `error` never fires for a mid-stream failure: the response
  // is a clean 200 that ends normally, so the frame is the only signal there is.
  const [streamFailed, setStreamFailed] = useState(false);
  // Its own slot, not a `kind` filter on the array above: an upload can finish
  // while an unclicked turn-level chip is showing, and sharing would wipe it.
  const [starterQuestions, setStarterQuestions] = useState<
    readonly Suggestion[]
  >([]);
  const [capacity, setCapacity] = useState<{
    used: number;
    allowed: number;
  } | null>(null);
  const nextEntryId = useRef(0);
  const nextChunkId = useRef(0);
  // Refs, not state: the cursor is never rendered, and a scroll handler firing
  // between renders must see the current value.
  const nextHistoryBefore = useRef<string | null>(null);
  const hasMoreHistory = useRef(false);
  const isLoadingOlderTurns = useRef(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Only ticks while an upload is in flight: a long extraction with a frozen
  // row reads as hung, but an idle panel shouldn't repaint forever.
  const [elapsedTick, setElapsedTick] = useState(() => Date.now());
  const hasBusySource = sources.some(
    (source) => source.status === "uploading" || source.status === "processing",
  );

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

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: ZIZA_STREAM_ROUTE,
        prepareSendMessagesRequest: ({ messages }) => {
          const lastMessage = messages.at(-1);
          const message =
            lastMessage?.parts
              .filter(isTextUIPart)
              .map((part) => part.text)
              .join("") ?? "";
          return { body: { message, session_id: sessionId } };
        },
      }),
    [sessionId],
  );

  const handleData = useCallback(
    (dataPart: { type: string; data?: unknown }) => {
      const payload = dataPart.data;
      const eventType = readEventType(payload);

      switch (eventType) {
        case "stream_open":
          pushEntry("open", "stream.open", ZIZA_STREAM_ROUTE);
          break;
        case "stream_close":
          pushEntry("done", "stream.close");
          break;
        case "intent": {
          const intentEvent = payload as {
            intents: string[];
            needs_rag: boolean;
            rag_query?: string | null;
          };
          pushEntry(
            "info",
            "intent",
            `${intentEvent.intents.join(", ")} · needs_rag: ${intentEvent.needs_rag}${
              intentEvent.rag_query
                ? ` · query: "${intentEvent.rag_query}"`
                : ""
            }`,
          );
          break;
        }
        case "tool_call": {
          const toolEvent = payload as { tool: string; args?: unknown };
          pushEntry(
            "tool",
            `tool: ${toolEvent.tool}`,
            toolEvent.args ? JSON.stringify(toolEvent.args) : undefined,
          );
          break;
        }
        case "chunk_retrieved": {
          const chunkEvent = payload as {
            source: string;
            score: number;
            text: string;
          };
          setChunks((current) => [
            ...current,
            { id: nextChunkId.current++, ...chunkEvent },
          ]);
          setActiveSourceLabels((current) =>
            current.includes(chunkEvent.source)
              ? current
              : [...current, chunkEvent.source],
          );
          pushEntry(
            "tool",
            "chunk.retrieved",
            `${chunkEvent.source} · ${chunkEvent.score.toFixed(2)}`,
          );
          break;
        }
        case "chat.approval_required":
        case "chat.input_required": {
          const schema =
            eventType === "chat.approval_required"
              ? ZizaApprovalRequiredEventSchema
              : ZizaInputRequiredEventSchema;
          const deferralEvent = schema.safeParse(payload);
          if (!deferralEvent.success) {
            pushEntry(
              "error",
              "deferral.malformed",
              `A ${eventType} frame arrived that the UI could not read.`,
            );
            break;
          }
          const call = toPendingCall(deferralEvent.data.pending_call);
          // A resolution can re-announce what is still outstanding, so
          // replace by id rather than append.
          setPendingCalls((current) => [
            ...current.filter(
              (existing) => existing.toolCallId !== call.toolCallId,
            ),
            call,
          ]);
          pushEntry(
            "tool",
            eventType === "chat.approval_required"
              ? "approval.required"
              : "input.required",
            `${call.toolName} · ${call.toolCallId}`,
          );
          break;
        }
        case "chat.suggestions": {
          const suggestionsEvent =
            ZizaSuggestionsEventSchema.safeParse(payload);
          if (!suggestionsEvent.success) {
            pushEntry(
              "error",
              "suggestions.malformed",
              "A chat.suggestions frame arrived that the UI could not read.",
            );
            break;
          }
          setSuggestions(suggestionsEvent.data.suggestions);
          pushEntry(
            "info",
            "suggestions.offered",
            suggestionsEvent.data.suggestions
              .map((suggestion) => suggestion.label)
              .join(", "),
          );
          break;
        }
        case "chat.error":
          pushEntry("error", "stream.error", "The answer was cut short.");
          setStreamFailed(true);
          break;
        case "error": {
          const errorEvent = payload as { message: string };
          pushEntry("error", "stream.error", errorEvent.message);
          break;
        }
        default:
          break;
      }
    },
    [pushEntry],
  );

  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport,
    onData: handleData,
  });

  useEffect(() => {
    let isActive = true;
    getSessionId()
      .then((id) => {
        if (isActive && id) {
          setSessionId(id);
          pushEntry("info", "session.ready", id);
          void fetchChatHistory(id).then((page) => {
            if (!isActive || !page) {
              return;
            }
            hasMoreHistory.current = page.hasMore;
            nextHistoryBefore.current = page.nextBefore;
            if (page.turns.length === 0) {
              return;
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
              `${page.turns.length} turns · more: ${page.hasMore}`,
            );
          });

          void fetchSessionSources(id).then((restored) => {
            if (!isActive || !restored) {
              return;
            }
            setCapacity({
              used: restored.documentsUsed,
              allowed: restored.documentsAllowed,
            });
            if (restored.sources.length === 0) {
              return;
            }
            // An upload started before this settled wins: the cold read is
            // already stale by then.
            setSources((current) =>
              current.length > 0 ? current : restored.sources,
            );
            pushEntry(
              "info",
              "sources.restored",
              restored.sources.map((source) => source.label).join(", "),
            );
          });

          void fetchStarterQuestions(id).then((recovered) => {
            if (!isActive || !recovered || recovered.suggestions.length === 0) {
              return;
            }
            setStarterQuestions(recovered.suggestions);
            pushEntry(
              "info",
              "starter_questions.recovered",
              recovered.document ?? undefined,
            );
          });
        }
      })
      .catch(() => {
        if (isActive) {
          pushEntry("error", "session.failed", "IndexedDB unavailable");
        }
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
    }));

    // In flight but no delta yet: the typing indicator needs a turn to
    // attach to.
    if (status === "submitted") {
      mapped.push({ id: "pending-response", role: "assistant", text: "" });
    }

    return mapped;
  }, [messages, status]);

  const isStreaming = status === "submitted" || status === "streaming";
  const isReady = sessionId !== "";

  // The cursor and the in-flight guard live here, so the panel only ever calls
  // this and trusts it to no-op when there is nothing to fetch.
  const loadOlderTurns = useCallback(() => {
    if (
      isLoadingOlderTurns.current ||
      !hasMoreHistory.current ||
      !nextHistoryBefore.current
    ) {
      return;
    }
    isLoadingOlderTurns.current = true;

    void fetchChatHistory(sessionId, {
      before: nextHistoryBefore.current,
    }).then((page) => {
      isLoadingOlderTurns.current = false;
      if (!page) {
        return;
      }
      hasMoreHistory.current = page.hasMore;
      nextHistoryBefore.current = page.nextBefore;

      setMessages((current) => {
        const seen = new Set(current.map((message) => message.id));
        const older = page.turns
          .filter((turn) => !seen.has(turn.id))
          .map(toUIMessage);
        return older.length > 0 ? [...older, ...current] : current;
      });
    });
  }, [sessionId, setMessages]);

  const handleSend = useCallback(
    (message: string) => {
      setStreamFailed(false);
      setChunks([]);
      setActiveSourceLabels([]);
      setSuggestions([]);
      setStarterQuestions([]);
      if (pendingCalls.length > 0) {
        setPendingCalls([]);
        pushEntry(
          "info",
          "deferral.superseded",
          pendingCalls.map((call) => call.toolCallId).join(", "),
        );
      }
      pushEntry("info", "request.send", `${message.length} chars`);
      void sendMessage({ text: message });
    },
    [pendingCalls, pushEntry, sendMessage],
  );

  // The failed exchange stays in the transcript rather than being rewound: the
  // apology is the visitor's evidence something went wrong, and re-sending is a
  // fresh request either way — the server kept nothing from the failed turn.
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

  const applyDeferralOutcome = useCallback(
    (
      toolCallId: string,
      outcome: Awaited<ReturnType<typeof resolveApproval>>,
      onResumed?: () => void,
    ) => {
      setResolvingCallId(null);

      if (isDeferralFailure(outcome)) {
        // A 409 means the answer can never land, so stop offering it.
        if (outcome.status === 409) {
          setPendingCalls((current) =>
            current.filter((call) => call.toolCallId !== toolCallId),
          );
        }
        pushEntry(
          "error",
          "deferral.failed",
          failureMessage(
            DEFERRAL_FAILURE_MESSAGE,
            outcome.status,
            outcome.detail,
          ),
        );
        return;
      }

      const resolved: DeferralResult = outcome;
      setPendingCalls(resolved.pendingCalls);

      // Neither endpoint streams, and `useChat` never saw the request.
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [{ type: "text", text: resolved.response }],
        },
      ]);

      if (resolved.pendingCalls.length === 0) {
        onResumed?.();
      }
    },
    [pushEntry, setMessages],
  );

  const handleApprovalDecision = useCallback(
    (toolCallId: string, approved: boolean) => {
      const call = pendingCalls.find(
        (pending) => pending.toolCallId === toolCallId,
      );
      if (!call) {
        return;
      }
      setResolvingCallId(toolCallId);
      pushEntry(
        "tool",
        approved ? "approval.confirmed" : "approval.declined",
        `${call.toolName} · ${toolCallId}`,
      );

      void resolveApproval(sessionId, toolCallId, approved).then((outcome) => {
        applyDeferralOutcome(toolCallId, outcome, () => {
          if (approved && call.toolName === "clear_knowledge_base") {
            setSources([]);
            setActiveSourceLabels([]);
            pushEntry("info", "knowledge.cleared", "by approved tool call");
          }
        });
      });
    },
    [applyDeferralOutcome, pendingCalls, pushEntry, sessionId],
  );

  const handleLinkSelection = useCallback(
    (toolCallId: string, selectedLinks: readonly string[]) => {
      const call = pendingCalls.find(
        (pending) => pending.toolCallId === toolCallId,
      );
      if (!call || call.kind !== "call") {
        return;
      }
      setResolvingCallId(toolCallId);
      pushEntry(
        "tool",
        "links.submitted",
        `${call.pageUrl} + ${selectedLinks.length} link(s)`,
      );

      void resolveLinkSelection(sessionId, toolCallId, selectedLinks).then(
        (outcome) => {
          applyDeferralOutcome(toolCallId, outcome, () => {
            // The API exposes no way to re-read a session's documents, so
            // rows come from what was submitted. Chunk counts stay 0 rather
            // than invented; the panel omits a 0.
            const indexed = [call.pageUrl, ...selectedLinks].filter(
              (url): url is string => Boolean(url),
            );
            setSources((current) => [
              ...current,
              ...indexed.map((url) => ({
                id: crypto.randomUUID(),
                label: url === call.pageUrl ? (call.pageTitle ?? url) : url,
                kind: "url" as const,
                chunkCount: 0,
                status: "indexed" as const,
              })),
            ]);
          });
        },
      );
    },
    [applyDeferralOutcome, pendingCalls, pushEntry, sessionId],
  );

  const handleDismissCall = useCallback(
    (toolCallId: string) => {
      setPendingCalls((current) =>
        current.filter((call) => call.toolCallId !== toolCallId),
      );
      // A deferred call has no decline endpoint; the parked run ages out.
      pushEntry("info", "deferral.dismissed", toolCallId);
    },
    [pushEntry],
  );

  const handleAddFile = useCallback(
    (file: File) => {
      const sourceId = crypto.randomUUID();
      setSources((current) => [
        ...current,
        {
          id: sourceId,
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

      void ingestFile(sessionId, file).then((result) => {
        if (isIngestFailure(result)) {
          // A 2xx that still failed is a schema mismatch, not a rejected
          // upload — the document is stored, so the row must not say otherwise.
          if (result.status >= 200 && result.status < 300) {
            setSources((current) =>
              current.map((source) =>
                source.id === sourceId
                  ? { ...source, status: "indexed", startedAt: undefined }
                  : source,
              ),
            );
            pushEntry(
              "error",
              "knowledge.response_unreadable",
              `${file.name}: stored (${result.status}), but the response did not match the expected shape`,
            );
            return;
          }

          const message = failureMessage(
            UPLOAD_FAILURE_MESSAGE,
            result.status,
            result.detail,
          );
          setSources((current) =>
            current.map((source) =>
              source.id === sourceId
                ? {
                    ...source,
                    status: "failed",
                    startedAt: undefined,
                    errorDetail: message,
                  }
                : source,
            ),
          );
          pushEntry(
            "error",
            "knowledge.upload_failed",
            `${file.name}: ${message}`,
          );

          // `request()` reports 503 for a network error or timeout, where the
          // work may have completed and only the reply was lost. Every other
          // status is an outright refusal with nothing to recover.
          if (result.status === 503) {
            void fetchStarterQuestions(sessionId).then((recovered) => {
              if (!recovered || recovered.document !== file.name) {
                return;
              }
              setSources((current) =>
                current.map((source) =>
                  source.id === sourceId
                    ? {
                        ...source,
                        status: "indexed",
                        errorDetail: undefined,
                      }
                    : source,
                ),
              );
              setStarterQuestions(recovered.suggestions);
              pushEntry(
                "info",
                "knowledge.upload_recovered",
                `${file.name} landed despite the lost response`,
              );
            });
          }
          return;
        }

        setSources((current) =>
          current.map((source) =>
            source.id === sourceId
              ? {
                  ...source,
                  label: result.source,
                  chunkCount: result.chunksIngested,
                  status: result.searchable ? "indexed" : "pending-index",
                  startedAt: undefined,
                  imagesDescribed: result.imagesDescribed,
                  imagesFailed: result.imagesFailed,
                }
              : source,
          ),
        );
        setCapacity({
          used: result.documentsUsed,
          allowed: result.documentsAllowed,
        });
        setStarterQuestions(result.suggestions);
        if (result.suggestions.length > 0) {
          pushEntry(
            "info",
            "starter_questions.offered",
            result.suggestions.map((question) => question.label).join(", "),
          );
        }
        pushEntry(
          result.imagesFailed > 0 ? "error" : "info",
          "knowledge.indexed",
          `${result.source} · ${result.chunksIngested} chunks · ${result.imagesDescribed} images · ${result.documentsUsed}/${result.documentsAllowed} documents · searchable: ${result.searchable}`,
        );
      });
    },
    [pushEntry, sessionId],
  );

  const handleClearSources = useCallback(() => {
    void clearKnowledge(sessionId).then((deleted) => {
      setSources([]);
      setActiveSourceLabels([]);
      setCapacity(null);
      pushEntry(
        deleted === null ? "error" : "info",
        deleted === null ? "knowledge.clear_failed" : "knowledge.cleared",
        deleted === null ? undefined : `${deleted} chunks deleted`,
      );
    });
  }, [pushEntry, sessionId]);

  const sourcesPanel = (
    <SourcesPanel
      sources={sources}
      activeSourceLabels={activeSourceLabels}
      isReady={isReady}
      elapsedTick={elapsedTick}
      capacity={capacity ?? undefined}
      onAddFileAction={handleAddFile}
      onClearAllAction={handleClearSources}
    />
  );

  const inspectorPanel = (
    <InspectorPanel
      entries={entries}
      chunks={chunks}
      onClearAction={() => {
        setEntries([]);
        setChunks([]);
      }}
    />
  );

  const chatPanel = (
    <ChatPanel
      turns={turns}
      isStreaming={isStreaming}
      isReady={isReady}
      errorMessage={error?.message}
      pendingCalls={pendingCalls}
      suggestions={suggestions}
      starterQuestions={starterQuestions}
      resolvingCallId={resolvingCallId}
      canRetry={streamFailed && !isStreaming}
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
