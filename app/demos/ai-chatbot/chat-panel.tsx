"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { PaperPlaneRightIcon, RobotIcon } from "@phosphor-icons/react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ChatPanelProps = {
  turns: readonly ChatTurn[];
  isStreaming: boolean;
  isReady: boolean;
  errorMessage?: string;
  onSendAction: (message: string) => void;
};

export function ChatPanel({
  turns,
  isStreaming,
  isReady,
  errorMessage,
  onSendAction,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll the viewport directly rather than calling `scrollIntoView` on a
  // sentinel — that also scrolls ancestor scrollports, which yanks the whole
  // page down on mount.
  useEffect(() => {
    if (turns.length === 0) {
      return;
    }
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [turns, isStreaming]);

  // Controls stay enabled — clicking with invalid input explains what's wrong
  // instead of silently doing nothing. A disabled button gives screen-reader
  // users no reason why it won't work.
  function handleSend() {
    const message = draft.trim();

    if (!isReady) {
      setNotice("Still setting up your session. Give it a second.");
      return;
    }
    if (isStreaming) {
      setNotice("Let the current answer finish first.");
      return;
    }
    if (!message) {
      setNotice("Type something first.");
      textareaRef.current?.focus();
      return;
    }

    setNotice("");
    onSendAction(message);
    setDraft("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <section className="flex h-full flex-col overflow-hidden" aria-label="Chat">
      <header className="border-border text-muted-foreground flex shrink-0 items-center justify-between border-b px-4 py-2.5 font-mono text-[0.625rem] tracking-widest uppercase">
        <span>Chat</span>
        {isStreaming ? (
          <span className="text-primary flex items-center gap-1.5">
            <span className="bg-primary size-1.5 animate-pulse rounded-full" />
            streaming
          </span>
        ) : null}
      </header>

      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <div className="space-y-4 p-4" role="log" aria-live="polite">
          {turns.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RobotIcon weight="duotone" />
                </EmptyMedia>
                <EmptyTitle className="font-mono text-xs tracking-widest uppercase">
                  Ask anything
                </EmptyTitle>
                <EmptyDescription>
                  Add a source and it will search that before answering. Press{" "}
                  <Kbd>Enter</Kbd> to send.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={
                  turn.role === "user"
                    ? "flex justify-end"
                    : "flex justify-start"
                }
              >
                {turn.role === "assistant" && turn.text === "" ? (
                  <div className="border-border bg-card flex gap-1 rounded-lg border px-3 py-2.5">
                    <span className="bg-muted-foreground size-1.5 animate-pulse rounded-full" />
                    <span className="bg-muted-foreground size-1.5 animate-pulse rounded-full [animation-delay:150ms]" />
                    <span className="bg-muted-foreground size-1.5 animate-pulse rounded-full [animation-delay:300ms]" />
                  </div>
                ) : (
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 font-sans text-sm ${
                      turn.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border-border bg-card border"
                    }`}
                  >
                    {turn.role === "assistant" ? (
                      <div className="prose-sm [&_code]:bg-muted [&_pre]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
                        <ReactMarkdown>{turn.text}</ReactMarkdown>
                      </div>
                    ) : (
                      turn.text
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {errorMessage ? (
            <p className="text-destructive border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2 font-mono text-xs">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-border shrink-0 border-t p-3">
        {notice ? (
          <p
            role="status"
            aria-live="polite"
            className="text-muted-foreground border-border bg-muted/40 mb-2 rounded-md border px-2.5 py-1.5 font-mono text-[0.6875rem]"
          >
            {notice}
          </p>
        ) : null}

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setNotice("");
            }}
            onKeyDown={handleKeyDown}
            placeholder={isReady ? "Ask something…" : "Starting session…"}
            aria-label="Message input"
            rows={2}
            maxLength={4000}
            className="border-border bg-background focus-visible:ring-ring/50 w-full resize-none rounded-md border py-2 pr-10 pl-3 font-sans text-sm outline-none focus-visible:ring-2"
          />
          {/*
            Gated on raw length, not the trimmed value — typing only whitespace
            still surfaces the button, and clicking it explains why nothing
            sent rather than leaving a dead control.
          */}
          {draft.length > 0 ? (
            <button
              type="button"
              onClick={handleSend}
              aria-label="Send message"
              className="text-primary hover:text-primary/70 focus-visible:ring-ring/50 animate-in fade-in-0 zoom-in-95 absolute top-1/2 right-3 -translate-y-1/2 rounded-sm transition-colors duration-150 outline-none focus-visible:ring-2"
            >
              <PaperPlaneRightIcon weight="fill" className="size-5" />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
