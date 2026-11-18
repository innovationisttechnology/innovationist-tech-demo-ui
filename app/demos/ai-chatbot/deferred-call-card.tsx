"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type ApprovalDecision,
  type PendingCall,
  type PendingLinkOffer,
} from "@/lib/ziza/ziza.types";

type DeferredCallCardProps = {
  call: PendingCall;
  isResolving: boolean;
  // Document slots the session has left, if known.
  slotsLeft?: number;
  onApprovalDecisionAction: (
    actionId: string,
    decision: ApprovalDecision,
  ) => void;
  onLinkSelectionAction: (
    offerId: string,
    selectedLinks: readonly string[],
  ) => void;
  onDismissAction: (callId: string) => void;
};

/**
 * One thing the conversation is waiting on, rendered as the decision it is
 * actually asking for.
 *
 * The two kinds are not variations on a theme. An `approval` is a gate — the
 * tool has not run, and Confirm resumes the turn with it. A `link_offer` asks
 * nothing to be permitted: the visitor picks which pages to index. Rendering
 * both as Confirm/Cancel would misdescribe the second.
 */
export function DeferredCallCard({
  call,
  isResolving,
  slotsLeft,
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

      {call.kind === "approval" ? (
        <>
          <p className="font-sans text-sm break-words">
            {call.description ??
              "This needs your confirmation before it can run."}
          </p>

          {/*
            Cancel is an explicit decline: ziza resumes the turn with it. There
            is deliberately no quiet dismiss here — a new message cancels the
            action, and an unanswered one expires on its own.
          */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={isDestructive ? "destructive" : "default"}
              disabled={isResolving}
              onClick={() => onApprovalDecisionAction(call.id, "approve")}
            >
              {isResolving ? "Confirming…" : "Confirm"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isResolving}
              onClick={() => onApprovalDecisionAction(call.id, "decline")}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <LinkSelection
          offer={call}
          isResolving={isResolving}
          slotsLeft={slotsLeft}
          selectedLinks={selectedLinks}
          onToggleAction={toggleLink}
          onSubmitAction={() => onLinkSelectionAction(call.id, selectedLinks)}
          onDismissAction={() => onDismissAction(call.id)}
        />
      )}
    </div>
  );
}

type LinkSelectionProps = {
  offer: PendingLinkOffer;
  isResolving: boolean;
  slotsLeft?: number;
  selectedLinks: readonly string[];
  onToggleAction: (url: string) => void;
  onSubmitAction: () => void;
  onDismissAction: () => void;
};

function LinkSelection({
  offer,
  isResolving,
  slotsLeft,
  selectedLinks,
  onToggleAction,
  onSubmitAction,
  onDismissAction,
}: LinkSelectionProps) {
  // Over-selecting is refused server-side against the session's remaining
  // document slots, so the limit is shown before they hit it.
  const isOverSlots =
    slotsLeft !== undefined && selectedLinks.length + 1 > slotsLeft;

  return (
    <>
      <p className="font-sans text-sm break-words">
        Index {offer.pageTitle ? <>{offer.pageTitle} </> : null}
        <span className="font-mono text-xs break-all">{offer.pageUrl}</span>?
      </p>

      {offer.links.length > 0 ? (
        <fieldset
          className="border-border max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-2"
          disabled={isResolving}
        >
          <legend className="text-muted-foreground px-1 font-mono text-[0.625rem] tracking-widest uppercase">
            also index
          </legend>
          {offer.links.map((link) => (
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
                  {link.title || link.url}
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
          Only {slotsLeft} slot(s) left in this session, page included.
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
          An offer has no decline: walking away is the decline, so this only
          clears the card and the offer expires on its own.
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
