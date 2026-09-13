"use client";

import { type Suggestion } from "@/lib/ziza/ziza.types";

type StarterQuestionsProps = {
  questions: readonly Suggestion[];
  onSendAction: (message: string) => void;
};

/**
 * Questions answerable from a document that was just added, as a card grid.
 *
 * Cards rather than the chips used for turn-level suggestions, because these
 * are read before there is anything else to read. A chip row is a footnote to
 * an answer above it; at cold start there is no answer, and these are the only
 * thing on screen — so they get room to be legible at a glance.
 *
 * `label` is displayed, `message` is sent. They are usually identical, and the
 * distinction only matters when the backend wants a shorter card than prompt.
 */
export function StarterQuestions({
  questions,
  onSendAction,
}: StarterQuestionsProps) {
  if (questions.length === 0) {
    return null;
  }

  return (
    // Container query, not a viewport breakpoint: the chat pane is a
    // ResizablePanel, so it can be dragged narrow while the window stays wide.
    // `sm:` would read the window and split a 300px pane into two columns.
    <div className="@container space-y-4 p-12">
      {/*
        A question rather than a label: at cold start this is the first thing
        in the pane, so it has to hand the visitor the turn, not caption a UI
        region. Singular "source" is accurate — only the most recently added
        document's questions are ever shown.

        `text-foreground` rather than `text-white`, so it reads white on the
        dark theme without vanishing into the background on the light one.
      */}
      <h3 className="text-foreground text-center font-sans text-lg text-balance">
        What would you like to know about the source you added?
      </h3>

      {/*
        Two per row is the intended shape, so the threshold is low — one column
        only when the pane is genuinely too narrow to split.
      */}
      <div className="grid gap-4 @xs:grid-cols-2">
        {questions.map((question) => (
          <button
            key={`${question.kind}:${question.label}`}
            type="button"
            onClick={() => onSendAction(question.message)}
            className="border-border bg-card hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-ring/50 flex flex-col gap-2 rounded-lg border p-5 text-left transition-colors outline-none focus-visible:ring-2"
          >
            {question.category ? (
              <span className="text-primary font-mono text-[0.625rem] tracking-widest uppercase">
                {question.category}
              </span>
            ) : null}
            <span className="font-sans text-sm leading-snug text-balance">
              {question.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
