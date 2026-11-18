"use client";

import { type Citation } from "@/lib/ziza/ziza.types";

type CitationListProps = {
  citations: readonly Citation[];
};

// The answer's `[n]` markers point here: each `number` matches one marker.
export function CitationList({ citations }: CitationListProps) {
  const orderedCitations = [...citations].sort(
    (left, right) => left.number - right.number,
  );

  return (
    <ol
      aria-label="Sources cited"
      className="border-border text-muted-foreground space-y-0.5 border-l-2 pl-3 font-mono text-[0.6875rem] leading-relaxed"
    >
      {orderedCitations.map((citation) => (
        <li
          key={citation.number}
          className={citation.isRemoved ? "line-through opacity-60" : undefined}
        >
          <span className="text-foreground">[{citation.number}]</span>{" "}
          <span className="break-all">
            {citation.sourceRef ?? "unnamed source"}
          </span>
          {citation.locator ? <span> · {citation.locator}</span> : null}
          {citation.isRemoved ? (
            <span className="ml-1 no-underline">(removed)</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
