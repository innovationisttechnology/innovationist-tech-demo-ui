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
  ingestFile,
  isDeferralFailure,
  isIngestFailure,
  resolveApproval,
  resolveLinkSelection,
} from "@/lib/ziza/ziza.service";
import {
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

// Extraction runs one vision call per embedded image, so a large PDF can hold
// this single request open for minutes. Status codes come straight from
// `app/ziza_chat/router.py`.
const UPLOAD_FAILURE_MESSAGE: Record<number, string> = {
  413: "Too big. The cap is 25MB.",
  415: "We can't read that kind of file.",
  422: "That file arrived empty.",
  503: "The knowledge base is offline right now.",
};

// 409 is the one worth wording carefully: the call was already answered, or
// the paused run aged out, so re-clicking cannot help. 422 means a link was
// submitted that this call never offered.
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

// The route handler forwards backend frames as `data-ziza` parts. Their shape is
// only known at runtime, so narrow defensively rather than trusting a cast.
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
  const nextEntryId = useRef(0);
  const nextChunkId = useRef(0);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Re-render once a second, but only while an upload is in flight — a long
  // extraction with a frozen row reads as hung. Gated on `hasBusySource` so an
  // idle panel isn't repainting forever.
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

  useEffect(() => {
    let isActive = true;
    getSessionId()
      .then((id) => {
        if (isActive && id) {
          setSessionId(id);
          pushEntry("info", "session.ready", id);
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
  }, [pushEntry]);

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
          // One frame per unanswered call, and a resolution can re-announce
          // what is still outstanding, so replace by id rather than append.
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

  const turns: ChatTurn[] = useMemo(() => {
    const mapped: ChatTurn[] = messages.map((message: UIMessage) => ({
      id: message.id,
      role: message.role === "user" ? "user" : "assistant",
      text: message.parts
        .filter(isTextUIPart)
        .map((part) => part.text)
        .join(""),
    }));

    // `submitted` means the request is in flight but no delta has arrived —
    // render an empty assistant turn so the typing indicator has something to
    // attach to.
    if (status === "submitted") {
      mapped.push({ id: "pending-response", role: "assistant", text: "" });
    }

    return mapped;
  }, [messages, status]);

  const isStreaming = status === "submitted" || status === "streaming";
  const isReady = sessionId !== "";

  const handleSend = useCallback(
    (message: string) => {
      setChunks([]);
      setActiveSourceLabels([]);
      // Same reasoning as the superseded calls below: an offer made about the
      // previous question has no standing once a new one is asked.
      setSuggestions([]);
      // A new message supersedes unanswered calls: the tool calls they belong
      // to are a turn back by the time the answer lands, so the cards would be
      // offering decisions that no longer fit the conversation.
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

  // Both resolution endpoints answer one call and return what is still
  // outstanding, so the bookkeeping either way is identical.
  const applyDeferralOutcome = useCallback(
    (
      toolCallId: string,
      outcome: Awaited<ReturnType<typeof resolveApproval>>,
      onResumed?: () => void,
    ) => {
      setResolvingCallId(null);

      if (isDeferralFailure(outcome)) {
        // The card stays up only while the answer might still land; a 409
        // means it never can, so drop it.
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
      // The server says what is still waiting, including calls this one never
      // knew about, so its list replaces the local one outright.
      setPendingCalls(resolved.pendingCalls);

      // Neither endpoint streams, so the reply arrives whole and has to be
      // appended by hand — `useChat` never saw the request.
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [{ type: "text", text: resolved.response }],
        },
      ]);

      // A run only resumes once nothing is outstanding; until then the reply
      // is a progress note and no tool has actually run.
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
          // An approved clear deletes the documents server-side, so the
          // sources panel is describing things that no longer exist.
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
            // That endpoint indexes as it resolves, and the API exposes no way
            // to re-read a session's documents, so the rows are added from
            // what was submitted. Chunk counts are left at 0 rather than
            // invented — the panel omits the count when it is 0.
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
      // Nothing is told to the server: a deferred call has no decline
      // endpoint, so the parked run simply ages out.
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
      resolvingCallId={resolvingCallId}
      onSendAction={handleSend}
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
