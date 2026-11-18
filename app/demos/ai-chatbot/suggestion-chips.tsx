"use client";

import { Button } from "@/components/ui/button";

type SuggestionChipsProps = {
  suggestions: readonly string[];
  onSendAction: (message: string) => void;
};

/**
 * Optional follow-up questions, rendered as chips. Clicking one sends it as
 * the next chat message.
 *
 * No colour or icon: tinting these would borrow the vocabulary
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
    <div className="space-y-1.5">
      <p className="text-muted-foreground font-mono text-[0.625rem] tracking-widest uppercase">
        worth asking
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            type="button"
            size="sm"
            variant="outline"
            className="h-auto px-4 py-2 text-left whitespace-normal"
            onClick={() => onSendAction(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}
