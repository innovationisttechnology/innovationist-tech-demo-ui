"use client";

import {
  type KeyboardEvent,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import { PaperPlaneRightIcon, RobotIcon } from "@phosphor-icons/react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type ApprovalDecision,
  type Citation,
  type PendingCall,
  type UnfinishedAction,
} from "@/lib/ziza/ziza.types";
import { CitationList } from "./citation-list";
import { DeferredCallCard } from "./deferred-call-card";
import { StarterQuestions } from "./starter-questions";
import { SuggestionChips } from "./suggestion-chips";

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: readonly Citation[];
  unfinishedAction?: UnfinishedAction;
};

const UNFINISHED_REASON_LABEL: Record<string, string> = {
  cancelled: "cancelled",
  expired: "expired",
};

// Deltas are token-sized and undebounced, so an unmemoised bubble re-parses
// every completed answer on the page for each token of the one still arriving.
const AssistantMessage = memo(function AssistantMessage({
  text,
}: {
  text: string;
}) {
  return (
    <div className="prose-sm [&_code]:bg-muted [&_pre]:bg-muted min-w-0 font-sans text-sm break-words [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
});

function TypingIndicator() {
  return (
    <div className="flex gap-1 py-1.5" aria-hidden>
      <span className="bg-muted-foreground size-1.5 animate-pulse rounded-full" />
      <span className="bg-muted-foreground size-1.5 animate-pulse rounded-full [animation-delay:150ms]" />
      <span className="bg-muted-foreground size-1.5 animate-pulse rounded-full [animation-delay:300ms]" />
    </div>
  );
}

// Recovered starters belong to an empty conversation; an upload's own
// starters are offered mid-conversation too.
export type StarterQuestionsOrigin = "recovered" | "upload";

type ChatPanelProps = {
  turns: readonly ChatTurn[];
  isStreaming: boolean;
  isReady: boolean;
  errorMessage?: string;
  pendingCalls: readonly PendingCall[];
  suggestions: readonly string[];
  starterQuestions: readonly string[];
  starterQuestionsOrigin: StarterQuestionsOrigin;
  // Which card is mid-request, so only that one shows as busy.
  resolvingCallId: string | null;
  slotsLeft?: number;
  // Set once a turn failed or was refused by a limit; what ziza said about it.
  streamFailureMessage?: string;
  canRetry: boolean;
  onRetryAction: () => void;
  onSendAction: (message: string) => void;
  onLoadOlderTurnsAction: () => void;
  onApprovalDecisionAction: (
    actionId: string,
    decision: ApprovalDecision,
  ) => void;
  onLinkSelectionAction: (
    offerId: string,
    selectedLinks: readonly string[],
  ) => void;
  onDismissCallAction: (callId: string) => void;
};

export function ChatPanel({
  turns,
  isStreaming,
  isReady,
  errorMessage,
  pendingCalls,
  suggestions,
  starterQuestions,
  starterQuestionsOrigin,
  resolvingCallId,
  slotsLeft,
  streamFailureMessage,
  canRetry,
  onRetryAction,
  onSendAction,
  onLoadOlderTurnsAction,
  onApprovalDecisionAction,
  onLinkSelectionAction,
  onDismissCallAction,
}: ChatPanelProps) {
  // Chips call onSendAction directly, bypassing handleSend's streaming guard,
  // so a click mid-stream would cut the answer off.
  const showStarterQuestions =
    starterQuestions.length > 0 &&
    !isStreaming &&
    (turns.length === 0 || starterQuestionsOrigin === "upload");

  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousFirstTurnId = useRef<string | undefined>(undefined);
  const previousScrollHeight = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const midConversationStartersRef = useRef<HTMLDivElement>(null);

  const findViewport = () =>
    scrollAreaRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );

  // A layout effect, not a plain one: correcting scrollTop after paint shows a
  // visible jump to the bottom before it lands. Scrolls the viewport directly
  // rather than `scrollIntoView` on a sentinel, which also scrolls ancestor
  // scrollports and drags the whole page down on mount.
  useLayoutEffect(() => {
    const viewport = findViewport();
    if (!viewport || turns.length === 0) {
      return;
    }

    const currentFirstId = turns[0]?.id;
    const previousFirstId = previousFirstTurnId.current;
    // The old first turn still being present is what separates a real prepend
    // from the list being replaced wholesale.
    const isPrepend =
      previousFirstId !== undefined &&
      currentFirstId !== previousFirstId &&
      turns.some((turn) => turn.id === previousFirstId);

    if (isPrepend) {
      viewport.scrollTop +=
        viewport.scrollHeight - previousScrollHeight.current;
      // Older turns would otherwise be announced as if they had just been
      // said. Set on the node rather than through state so it lands before the
      // prepended children are painted, and is restored once they have been.
      const log = logRef.current;
      if (log) {
        log.setAttribute("aria-live", "off");
        requestAnimationFrame(() => log.setAttribute("aria-live", "polite"));
      }
    } else {
      viewport.scrollTop = viewport.scrollHeight;
    }

    previousFirstTurnId.current = currentFirstId;
    previousScrollHeight.current = viewport.scrollHeight;
  }, [turns, isStreaming, pendingCalls]);

  const showMidConversationStarters = turns.length > 0 && showStarterQuestions;

  // Upload starters land below history the visitor may not be looking at, and
  // nothing above re-scrolls for them since the turns did not change. Their
  // top, not the bottom, so the heading stays in view when they are tall.
  // Smooth, so the visitor sees where they went.
  useLayoutEffect(() => {
    const viewport = findViewport();
    const starters = midConversationStartersRef.current;
    if (!viewport || !starters || !showMidConversationStarters) {
      return;
    }
    viewport.scrollTo({
      top:
        viewport.scrollTop +
        starters.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top,
      behavior: "smooth",
    });
  }, [starterQuestions, showMidConversationStarters]);

  // Fires on every qualifying scroll, which is safe: the parent owns the
  // in-flight and has-more guards, so this is a no-op when there is nothing
  // left to fetch. 200px rather than 0 so the page arrives before the reader
  // reaches the physical top.
  useEffect(() => {
    const viewport = findViewport();
    if (!viewport) {
      return;
    }
    const handleScroll = () => {
      if (viewport.scrollTop < 200) {
        onLoadOlderTurnsAction();
      }
    };
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [onLoadOlderTurnsAction]);

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
    <section
      className="flex h-full min-w-0 flex-col overflow-hidden"
      aria-label="Chat"
    >
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
        <div
          ref={logRef}
          className="min-w-0 space-y-6 px-8 py-6"
          role="log"
          aria-live="polite"
        >
          {turns.length === 0 && showStarterQuestions ? (
            <StarterQuestions
              questions={starterQuestions}
              onSendAction={onSendAction}
            />
          ) : turns.length === 0 ? (
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
            turns.map((turn, index) => {
              const isLastTurn = index === turns.length - 1;
              const showSuggestions =
                suggestions.length > 0 &&
                !isStreaming &&
                turn.role === "assistant" &&
                isLastTurn;
              // An answer can pause mid-sentence while the model runs a
              // retrieval tool, so this tracks the stream rather than the empty
              // text it used to — otherwise the gap reads as a hang.
              const isAnswering =
                isStreaming && turn.role === "assistant" && isLastTurn;

              return (
                <div key={turn.id} className="space-y-3">
                  {/*
                    Only the visitor's own words get a bubble. The answer is
                    the page's main content and reads as plain prose, so it
                    runs the full width with no container of its own.
                  */}
                  {turn.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="bg-primary text-primary-foreground max-w-[85%] min-w-0 rounded-lg px-3 py-2 font-sans text-sm break-words">
                        {turn.text}
                      </div>
                    </div>
                  ) : (
                    <>
                      {turn.text === "" ? null : (
                        <AssistantMessage text={turn.text} />
                      )}
                      {turn.citations && turn.citations.length > 0 ? (
                        <CitationList citations={turn.citations} />
                      ) : null}
                      {turn.unfinishedAction ? (
                        <p className="text-muted-foreground font-mono text-xs">
                          Not done: {turn.unfinishedAction.description} (
                          {UNFINISHED_REASON_LABEL[
                            turn.unfinishedAction.reason
                          ] ?? turn.unfinishedAction.reason}
                          )
                        </p>
                      ) : null}
                      {isAnswering ? <TypingIndicator /> : null}
                    </>
                  )}

                  {showSuggestions ? (
                    <SuggestionChips
                      suggestions={suggestions}
                      onSendAction={onSendAction}
                    />
                  ) : null}
                </div>
              );
            })
          )}

          {/* Stands alone: a new document has nothing to do with the last reply. */}
          {showMidConversationStarters ? (
            <div ref={midConversationStartersRef}>
              <StarterQuestions
                questions={starterQuestions}
                onSendAction={onSendAction}
              />
            </div>
          ) : null}

          {/*
            Real gates, not prompts: the run is parked server-side and resumes
            only once every one of these is answered.
          */}
          {pendingCalls.map((call) => (
            <DeferredCallCard
              key={call.id}
              call={call}
              isResolving={resolvingCallId === call.id}
              slotsLeft={slotsLeft}
              onApprovalDecisionAction={onApprovalDecisionAction}
              onLinkSelectionAction={onLinkSelectionAction}
              onDismissAction={onDismissCallAction}
            />
          ))}

          {/*
            Re-sending is the only recovery: a stream that failed left nothing
            server-side to resume from. A rate limit keeps the message up but
            holds the button back until the wait is over.
          */}
          {streamFailureMessage || canRetry ? (
            <div className="border-border flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
              <p className="text-muted-foreground font-mono text-[0.625rem] tracking-widest uppercase">
                answer cut short
              </p>
              {streamFailureMessage ? (
                <p className="text-muted-foreground min-w-0 flex-1 font-sans text-xs">
                  {streamFailureMessage}
                </p>
              ) : null}
              {canRetry ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onRetryAction}
                >
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}

          {errorMessage ? (
            <p className="text-destructive border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2 font-mono text-xs">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-border shrink-0 border-t p-4">
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
