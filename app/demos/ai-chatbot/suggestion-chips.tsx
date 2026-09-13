"use client";

import { Button } from "@/components/ui/button";
import { type Suggestion } from "@/lib/ziza/ziza.types";

// The kicker is the only thing separating the kinds, so it has to be right.
// The two shipped kinds have opposite triggers: `add_page` follows a reply
// that found nothing, `ask` follows one that worked. Labelling an `ask` chip
// "try instead" apologises for a perfectly good answer.
//
// Keyed lookup rather than a closed union because `Suggestion.kind` is an open
// string by design — a kind the frontend has never seen must still render.
const KICKER_FOR_KIND: Record<string, string> = {
  add_page: "try instead",
  ask: "worth asking",
};

const FALLBACK_KICKER = "suggested";

// Every kicker in this UI is a terse two-or-three-word phrase — "confirmation
// required", "your choice", "streaming". A full clause breaks that register.
function kickerFor(kind: string): string {
  return KICKER_FOR_KIND[kind] ?? FALLBACK_KICKER;
}

// Insertion-ordered, so the groups render in the order the backend sent them.
function groupByKind(
  suggestions: readonly Suggestion[],
): [string, Suggestion[]][] {
  const groups = new Map<string, Suggestion[]>();
  for (const suggestion of suggestions) {
    const existing = groups.get(suggestion.kind);
    if (existing) {
      existing.push(suggestion);
    } else {
      groups.set(suggestion.kind, [suggestion]);
    }
  }
  return Array.from(groups);
}

type SuggestionChipsProps = {
  suggestions: readonly Suggestion[];
  // Overrides the per-kind kicker. Starter questions are about a document that
  // was just added, not about the turn above them, so they name themselves.
  kicker?: string;
  onSendAction: (message: string) => void;
};

/**
 * Optional offers, rendered as chips.
 *
 * Deliberately undifferentiated by kind beyond the kicker: no colour, no icon.
 * The assistant's reply directly above already says whether it found anything,
 * so the chip doesn't need to repeat it — and tinting these would borrow the
 * vocabulary `deferred-call-card.tsx` reserves for things that delete or send.
 * Recovery chips have zero stakes; colouring them as though they don't teaches
 * the wrong lesson about what colour means here.
 */
export function SuggestionChips({
  suggestions,
  kicker,
  onSendAction,
}: SuggestionChipsProps) {
  if (suggestions.length === 0) {
    return null;
  }

  // One row per kind, since the kicker describes the chips beneath it. With a
  // caller-supplied kicker the whole set is one row by definition.
  const rows: [string, Suggestion[]][] = kicker
    ? [[kicker, [...suggestions]]]
    : groupByKind(suggestions).map(([kind, group]) => [kickerFor(kind), group]);

  return (
    <div className="space-y-3">
      {rows.map(([label, group]) => (
        <div key={label} className="space-y-1.5">
          <p className="text-muted-foreground font-mono text-[0.625rem] tracking-widest uppercase">
            {label}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.map((suggestion) => (
              <Button
                key={`${suggestion.kind}:${suggestion.label}`}
                type="button"
                size="sm"
                variant="outline"
                // `message` is the payload, `label` is only what it reads.
                onClick={() => onSendAction(suggestion.message)}
              >
                {suggestion.label}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
