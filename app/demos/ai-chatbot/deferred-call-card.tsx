"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { type PendingCall } from "@/lib/ziza/ziza.types";

type DeferredCallCardProps = {
  call: PendingCall;
  isResolving: boolean;
  onApprovalDecisionAction: (toolCallId: string, approved: boolean) => void;
  onLinkSelectionAction: (
    toolCallId: string,
    selectedLinks: readonly string[],
  ) => void;
  onDismissAction: (toolCallId: string) => void;
};

/**
 * One paused tool call, rendered as the decision it is actually asking for.
 *
 * The two kinds are not variations on a theme. An `approval` is a gate — the
 * tool has not run, and Confirm re-enters its body. A `call` is deferred for
 * external execution: nothing is being permitted, the visitor is supplying the
 * input the tool needs, and the answer they give becomes its return value.
 * Rendering both as Confirm/Cancel would misdescribe the second.
 */
export function DeferredCallCard({
  call,
  isResolving,
  onApprovalDecisionAction,
  onLinkSelectionAction,
  onDismissAction,
}: DeferredCallCardProps) {
  const [selectedLinks, setSelectedLinks] = useState<readonly string[]>([]);

  const isDestructive = call.kind === "approval" && call.isDestructive;

  const toggleLink = (url: string) => {
    setSelectedLinks((current) =>
      current.includes(url)
        ? current.filter((selected) => selected !== url)
        : [...current, url],
    );
  };

  return (
    <div
      role="group"
      aria-label={
        call.kind === "approval" ? "Confirmation required" : "Choice required"
      }
      className={`space-y-3 rounded-lg border p-3 ${
        isDestructive
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-muted/40"
      }`}
    >
      <p
        className={`font-mono text-[0.625rem] tracking-widest uppercase ${
          isDestructive ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {call.kind === "approval" ? "confirmation required" : "your choice"}
      </p>

      <p className="font-sans text-sm">
        {call.summary ??
          (call.kind === "approval"
            ? "This needs your confirmation before it can run."
            : "This needs your input before it can continue.")}
      </p>

      {call.kind === "approval" ? (
        <>
          {call.documents.length > 0 ? (
            <ul className="text-muted-foreground space-y-0.5 font-mono text-xs">
              {call.documents.map((document) => (
                <li key={document}>{document}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={isDestructive ? "destructive" : "default"}
              disabled={isResolving}
              onClick={() => onApprovalDecisionAction(call.toolCallId, true)}
            >
              {isResolving ? "Confirming…" : "Confirm"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isResolving}
              onClick={() => onApprovalDecisionAction(call.toolCallId, false)}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <LinkSelection
          call={call}
          isResolving={isResolving}
          selectedLinks={selectedLinks}
          onToggleAction={toggleLink}
          onSubmitAction={() =>
            onLinkSelectionAction(call.toolCallId, selectedLinks)
          }
          onDismissAction={() => onDismissAction(call.toolCallId)}
        />
      )}
    </div>
  );
}

type LinkSelectionProps = {
  call: Extract<PendingCall, { kind: "call" }>;
  isResolving: boolean;
  selectedLinks: readonly string[];
  onToggleAction: (url: string) => void;
  onSubmitAction: () => void;
  onDismissAction: () => void;
};

function LinkSelection({
  call,
  isResolving,
  selectedLinks,
  onToggleAction,
  onSubmitAction,
  onDismissAction,
}: LinkSelectionProps) {
  // The server needs a page to index; without one there is no answer this card
  // could submit, so it says so rather than offering a dead button.
  if (!call.pageUrl) {
    return (
      <p className="text-muted-foreground font-mono text-xs">
        This one can&apos;t be answered here yet.
      </p>
    );
  }

  // Over-selecting is refused server-side against the session's remaining
  // document slots, so the limit is shown before they hit it.
  const isOverSlots =
    call.slotsLeft !== undefined && selectedLinks.length + 1 > call.slotsLeft;

  return (
    <>
      {call.links.length > 0 ? (
        <fieldset
          className="border-border max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-2"
          disabled={isResolving}
        >
          <legend className="text-muted-foreground px-1 font-mono text-[0.625rem] tracking-widest uppercase">
            also index
          </legend>
          {call.links.map((link) => (
            <label
              key={link.url}
              className="hover:bg-muted flex cursor-pointer items-start gap-2 rounded px-1 py-1"
            >
              <input
                type="checkbox"
                checked={selectedLinks.includes(link.url)}
                onChange={() => onToggleAction(link.url)}
                className="accent-primary mt-0.5 size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-xs">
                  {link.text || link.url}
                </span>
                <span className="text-muted-foreground block truncate font-mono text-[0.625rem]">
                  {link.url}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {isOverSlots ? (
        <p className="text-destructive font-mono text-xs">
          Only {call.slotsLeft} slot(s) left in this session, page included.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isResolving}
          onClick={onSubmitAction}
        >
          {isResolving
            ? "Indexing…"
            : selectedLinks.length === 0
              ? "Index the page only"
              : `Index the page + ${selectedLinks.length} link(s)`}
        </Button>
        {/*
          There is no decline endpoint for a deferred call — walking away is
          the decline path — so this only clears the card. The run stays parked
          server-side until it ages out.
        */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isResolving}
          onClick={onDismissAction}
        >
          Not now
        </Button>
      </div>
    </>
  );
}
