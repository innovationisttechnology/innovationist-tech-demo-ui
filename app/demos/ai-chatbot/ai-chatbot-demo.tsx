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
import {
  ZIZA_STREAM_ROUTE,
  clearKnowledge,
  ingestFile,
  ingestKnowledge,
  ingestUrl,
  isIngestFailure,
} from "@/lib/ziza/ziza.service";
import {
  type InspectorEntry,
  type KnowledgeSource,
  type RetrievedChunk,
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

// The server rejects private and internal addresses at every redirect hop, so
// 422 here usually means the URL resolved somewhere it won't fetch from.
const URL_FAILURE_MESSAGE: Record<number, string> = {
  415: "Nothing readable on that page.",
  422: "We can't fetch that link.",
  502: "Could not reach that page.",
  503: "The knowledge base is offline right now.",
};

function ingestFailureMessage(
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

  const { messages, sendMessage, status, error } = useChat({
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
      pushEntry("info", "request.send", `${message.length} chars`);
      void sendMessage({ text: message });
    },
    [pushEntry, sendMessage],
  );

  const handleAddText = useCallback(
    (label: string, text: string) => {
      const sourceId = crypto.randomUUID();
      setSources((current) => [
        ...current,
        {
          id: sourceId,
          label,
          kind: "text",
          chunkCount: 0,
          status: "processing",
          startedAt: Date.now(),
        },
      ]);
      pushEntry("info", "knowledge.ingest", `${label} · ${text.length} chars`);

      void ingestKnowledge(sessionId, label, text).then((result) => {
        setSources((current) =>
          current.map((source) =>
            source.id === sourceId
              ? {
                  ...source,
                  chunkCount: result?.chunksIngested ?? 0,
                  startedAt: undefined,
                  status: result
                    ? result.searchable
                      ? "indexed"
                      : "pending-index"
                    : "failed",
                  errorDetail: result ? undefined : "Could not be ingested.",
                }
              : source,
          ),
        );
        pushEntry(
          result ? "info" : "error",
          result ? "knowledge.indexed" : "knowledge.failed",
          result
            ? `${label} · ${result.chunksIngested} chunks · searchable: ${result.searchable}`
            : label,
        );
      });
    },
    [pushEntry, sessionId],
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
          const message = ingestFailureMessage(
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

        // Anything over the server's per-document image cap is dropped with
        // only a log line, so this subtraction is the only way the UI can tell
        // someone their content never made it into the index.
        const imagesSkipped = Math.max(
          0,
          result.imagesTotal - result.imagesDescribed - result.imagesFailed,
        );

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
                  imagesSkipped,
                }
              : source,
          ),
        );
        pushEntry(
          imagesSkipped > 0 || result.imagesFailed > 0 ? "error" : "info",
          "knowledge.indexed",
          `${result.source} · ${result.chunksIngested} chunks · ${result.imagesDescribed}/${result.imagesTotal} images · searchable: ${result.searchable}`,
        );
      });
    },
    [pushEntry, sessionId],
  );

  const handleAddUrl = useCallback(
    (url: string) => {
      const sourceId = crypto.randomUUID();
      let label = url;
      try {
        label = new URL(url).hostname || url;
      } catch {
        // validateUrl already ran in the panel; fall back to the raw string.
      }
      setSources((current) => [
        ...current,
        {
          id: sourceId,
          label,
          kind: "url",
          chunkCount: 0,
          status: "uploading",
          startedAt: Date.now(),
        },
      ]);
      pushEntry("info", "knowledge.fetch", url);

      void ingestUrl(sessionId, url).then((result) => {
        if (isIngestFailure(result)) {
          const message = ingestFailureMessage(
            URL_FAILURE_MESSAGE,
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
          pushEntry("error", "knowledge.fetch_failed", `${url}: ${message}`);
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
                  pagesSummarised: result.pagesSummarised,
                }
              : source,
          ),
        );
        pushEntry(
          "info",
          "knowledge.indexed",
          `${result.source} · ${result.chunksIngested} chunks · summary: ${result.pagesSummarised === 1} · searchable: ${result.searchable}`,
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
      onAddTextAction={handleAddText}
      onAddFileAction={handleAddFile}
      onAddUrlAction={handleAddUrl}
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
      onSendAction={handleSend}
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
