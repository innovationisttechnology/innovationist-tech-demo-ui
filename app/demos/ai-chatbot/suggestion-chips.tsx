"use client";

import { Button } from "@/components/ui/button";
import { type Suggestion } from "@/lib/ziza/ziza.types";

// The two kinds have opposite triggers — `add_page` follows a reply that found
// nothing, `ask` follows one that worked — so a shared kicker would apologise
// for a good answer. Keyed lookup, not a union: `kind` is an open string and an
// unrecognised one still has to render.
const KICKER_FOR_KIND: Record<string, string> = {
  add_page: "try instead",
  ask: "worth asking",
};

const FALLBACK_KICKER = "suggested";

function kickerFor(kind: string): string {
  return KICKER_FOR_KIND[kind] ?? FALLBACK_KICKER;
}

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
  onSendAction: (message: string) => void;
};

/**
 * Optional offers, rendered as chips.
 *
 * No colour or icon per kind: tinting these would borrow the vocabulary
 * `deferred-call-card.tsx` reserves for things that delete or send, and these
 * have zero stakes.
 */
export function SuggestionChips({
  suggestions,
  onSendAction,
}: SuggestionChipsProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {groupByKind(suggestions).map(([kind, group]) => (
        <div key={kind} className="space-y-1.5">
          <p className="text-muted-foreground font-mono text-[0.625rem] tracking-widest uppercase">
            {kickerFor(kind)}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.map((suggestion) => (
              <Button
                key={`${suggestion.kind}:${suggestion.label}`}
                type="button"
                size="sm"
                variant="outline"
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
