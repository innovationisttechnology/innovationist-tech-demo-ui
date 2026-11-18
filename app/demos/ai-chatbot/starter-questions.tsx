"use client";

type StarterQuestionsProps = {
  questions: readonly string[];
  onSendAction: (message: string) => void;
};

export function StarterQuestions({
  questions,
  onSendAction,
}: StarterQuestionsProps) {
  if (questions.length === 0) {
    return null;
  }

  return (
    <div className="@container space-y-4 p-12">
      <h3 className="text-foreground text-center font-sans text-lg text-balance">
        What would you like to know about the source you added?
      </h3>

      <div className="grid gap-4 @xs:grid-cols-2">
        {questions.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onSendAction(question)}
            className="border-border bg-card hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-ring/50 flex flex-col gap-2 rounded-lg border p-5 text-left transition-colors outline-none focus-visible:ring-2"
          >
            <span className="font-sans text-sm leading-snug text-balance">
              {question}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
