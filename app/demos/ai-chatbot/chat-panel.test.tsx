import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPanel } from "./chat-panel";

const ANSWER = {
  id: "a1",
  role: "assistant" as const,
  text: "I can only answer from the documents in this session.",
};

const SUGGESTION = {
  kind: "add_page",
  label: "Index innovationisttech.com",
  message: "Add https://innovationisttech.com/ to my knowledge base",
  url: "https://innovationisttech.com/",
};

function renderPanel(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const onSendAction = vi.fn();
  const onRetryAction = vi.fn();
  const rendered = render(
    <ChatPanel
      turns={[ANSWER]}
      isStreaming={false}
      isReady
      pendingCalls={[]}
      suggestions={[SUGGESTION]}
      starterQuestions={[]}
      resolvingCallId={null}
      canRetry={false}
      onRetryAction={onRetryAction}
      onSendAction={onSendAction}
      onLoadOlderTurnsAction={vi.fn()}
      onApprovalDecisionAction={vi.fn()}
      onLinkSelectionAction={vi.fn()}
      onDismissCallAction={vi.fn()}
      {...overrides}
    />,
  );
  return { ...rendered, onSendAction, onRetryAction };
}

describe("recovering from a cut-off answer", () => {
  // The apology reaches the bubble as ordinary answer text, so the panel would
  // look like a normal reply if nothing marked it as recoverable.
  it("stays out of the way until the stream actually fails", () => {
    renderPanel();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("offers a retry once it has", () => {
    renderPanel({ canRetry: true });
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("hands the retry back rather than resending on its own", async () => {
    const { onRetryAction, onSendAction } = renderPanel({ canRetry: true });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryAction).toHaveBeenCalledTimes(1);
    expect(onSendAction).not.toHaveBeenCalled();
  });
});

describe("suggestion chips", () => {
  it("shows the label, not the message that gets sent", () => {
    renderPanel();
    expect(
      screen.getByRole("button", { name: SUGGESTION.label }),
    ).toBeVisible();
    expect(screen.queryByText(SUGGESTION.message)).not.toBeInTheDocument();
  });

  // Acting on a suggestion is an ordinary chat message — no second endpoint
  // sits behind a chip.
  it("sends the message through the normal send path", async () => {
    const { onSendAction } = renderPanel();
    await userEvent.click(
      screen.getByRole("button", { name: SUGGESTION.label }),
    );
    expect(onSendAction).toHaveBeenCalledWith(SUGGESTION.message);
  });

  // Clicking mid-stream would cut the answer off.
  it("stays hidden while a reply is still streaming", () => {
    renderPanel({ isStreaming: true });
    expect(
      screen.queryByRole("button", { name: SUGGESTION.label }),
    ).not.toBeInTheDocument();
  });

  it("stays hidden when the last turn is the visitor's", () => {
    renderPanel({
      turns: [ANSWER, { id: "u1", role: "user", text: "what about pricing?" }],
    });
    expect(
      screen.queryByRole("button", { name: SUGGESTION.label }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing extra when there are none", () => {
    renderPanel({ suggestions: [] });
    expect(screen.queryByText("try instead")).not.toBeInTheDocument();
  });
});

const ASK_SUGGESTION = {
  kind: "ask",
  label: "How does the release captain rotate?",
  message: "How does the release captain rotate?",
};

const CATEGORISED_SUGGESTION = {
  kind: "ask",
  label: "Why did the invoice amount increase from $69.89 to $74.84?",
  message: "Why did the invoice amount increase from $69.89 to $74.84?",
  category: "Billing changes",
};

const STARTER = {
  kind: "ask",
  label: "What happens if the release captain is on leave?",
  message: "What happens if the release captain is on leave?",
};

describe("the kicker above the chips", () => {
  it("apologises only for the kind that found nothing", () => {
    renderPanel({ suggestions: [SUGGESTION] });
    expect(screen.getByText("try instead")).toBeInTheDocument();
    expect(screen.queryByText("worth asking")).not.toBeInTheDocument();
  });

  // "try instead" over an `ask` chip apologises for an answer that worked.
  it("reads as a follow-on when retrieval succeeded", () => {
    renderPanel({ suggestions: [ASK_SUGGESTION] });
    expect(screen.getByText("worth asking")).toBeInTheDocument();
    expect(screen.queryByText("try instead")).not.toBeInTheDocument();
  });

  it("falls back to something neutral for a kind it has never seen", () => {
    renderPanel({
      suggestions: [
        { kind: "some_future_kind", label: "Do it", message: "do" },
      ],
    });
    expect(screen.getByText("suggested")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Do it" })).toBeInTheDocument();
  });

  // Triggers are mutually exclusive today, so this never happens — but one
  // kicker cannot describe two opposite meanings if it ever does.
  it("gives each kind its own row when both arrive together", () => {
    renderPanel({ suggestions: [SUGGESTION, ASK_SUGGESTION] });
    expect(screen.getByText("try instead")).toBeInTheDocument();
    expect(screen.getByText("worth asking")).toBeInTheDocument();
  });

  // The kicker is a stand-in for a topic the backend could not name. Once it
  // names one, the stand-in is noise.
  it("gives way to the real topic when the backend sends one", () => {
    renderPanel({ suggestions: [CATEGORISED_SUGGESTION] });
    expect(screen.getByText("Billing changes")).toBeInTheDocument();
    expect(screen.queryByText("worth asking")).not.toBeInTheDocument();
  });

  // `add_page` suggestions never carry a category, so a categorised `ask`
  // alongside them must not strip the kicker they still need.
  it("keeps the kicker for a kind that has no topic of its own", () => {
    renderPanel({ suggestions: [SUGGESTION, CATEGORISED_SUGGESTION] });
    expect(screen.getByText("try instead")).toBeInTheDocument();
    expect(screen.getByText("Billing changes")).toBeInTheDocument();
    expect(screen.queryByText("worth asking")).not.toBeInTheDocument();
  });
});

describe("starter questions after an upload", () => {
  // Real questions say "what to do here" better than a card telling you to
  // ask something, so they take the zero state's place rather than joining it.
  it("replaces the zero-state card entirely", () => {
    renderPanel({ turns: [], suggestions: [], starterQuestions: [STARTER] });
    expect(screen.getByRole("button", { name: STARTER.label })).toBeVisible();
    expect(screen.queryByText("Ask anything")).not.toBeInTheDocument();
    expect(screen.queryByText(/Add a source and it will search/)).toBeNull();
  });

  it("keeps the zero-state card when there are no questions", () => {
    renderPanel({ turns: [], suggestions: [], starterQuestions: [] });
    expect(screen.getByText("Ask anything")).toBeInTheDocument();
  });

  it("stands on its own mid-conversation rather than under the last reply", () => {
    renderPanel({ starterQuestions: [STARTER] });
    expect(screen.getByRole("button", { name: STARTER.label })).toBeVisible();
  });

  it("sends through the same path as every other chip", async () => {
    const { onSendAction } = renderPanel({ starterQuestions: [STARTER] });
    await userEvent.click(screen.getByRole("button", { name: STARTER.label }));
    expect(onSendAction).toHaveBeenCalledWith(STARTER.message);
  });

  // They share the turn-level gate: chips call onSendAction directly, so a
  // click mid-stream would cut the answer off.
  it("stays hidden while a reply is streaming", () => {
    renderPanel({ starterQuestions: [STARTER], isStreaming: true });
    expect(
      screen.queryByRole("button", { name: STARTER.label }),
    ).not.toBeInTheDocument();
  });

  // Separate state slots: an upload finishing must not wipe an unclicked chip.
  it("coexists with an unanswered turn-level suggestion", () => {
    renderPanel({ suggestions: [SUGGESTION], starterQuestions: [STARTER] });
    expect(screen.getByText("try instead")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: STARTER.label })).toBeVisible();
  });
});

describe("the starter-question cards", () => {
  const CATEGORISED = {
    kind: "ask",
    category: "Scope",
    label: "How long does a first release usually take?",
    message: "How long does a first release usually take?",
  };

  it("asks the visitor what they want to know", () => {
    renderPanel({ turns: [], starterQuestions: [STARTER] });
    expect(
      screen.getByRole("heading", { name: /what would you like to know/i }),
    ).toBeInTheDocument();
  });

  it("renders each question as its own card button", () => {
    renderPanel({ turns: [], starterQuestions: [STARTER, CATEGORISED] });
    expect(screen.getByRole("button", { name: STARTER.label })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /How long does a first release/ }),
    ).toBeVisible();
  });

  it("shows the topic label when the backend sends one", () => {
    renderPanel({ turns: [], starterQuestions: [CATEGORISED] });
    expect(screen.getByText("Scope")).toBeInTheDocument();
  });

  // `category` is nullish on the wire and null for every `add_page`, so the
  // card must not leave a blank line where the topic would go.
  it("omits the topic line when there is none", () => {
    const { container } = renderPanel({
      turns: [],
      starterQuestions: [STARTER],
    });
    expect(container.querySelectorAll(".text-primary")).toHaveLength(0);
  });

  // The chat pane is resizable, so columns key off the container, not the
  // viewport — `sm:` would split a dragged-narrow pane into two cramped ones.
  it("splits into columns on container width, not viewport width", () => {
    const { container } = renderPanel({
      turns: [],
      starterQuestions: [STARTER],
    });
    expect(container.querySelector(".\\@container")).not.toBeNull();
    expect(container.querySelector(".\\@xs\\:grid-cols-2")).not.toBeNull();
  });
});

describe("the activity indicator", () => {
  // Scoped to the log: the panel header carries its own pulsing pip whenever
  // the stream is open, which would be counted too.
  const countDots = (container: HTMLElement) =>
    container.querySelectorAll('[role="log"] .animate-pulse').length;

  it("shows while the answer is still empty", () => {
    const { container } = renderPanel({
      turns: [{ id: "a1", role: "assistant", text: "" }],
      isStreaming: true,
      suggestions: [],
    });
    expect(countDots(container)).toBe(3);
  });

  // The model can pause mid-sentence to run a retrieval tool. Keying off empty
  // text alone left the visitor watching a half-finished sentence with nothing
  // to say anything was still happening.
  it("stays up once the first delta has landed", () => {
    const { container } = renderPanel({
      turns: [{ id: "a1", role: "assistant", text: "Let me search " }],
      isStreaming: true,
      suggestions: [],
    });
    expect(screen.getByText(/Let me search/)).toBeVisible();
    expect(countDots(container)).toBe(3);
  });

  it("goes away when the stream finishes", () => {
    const { container } = renderPanel({ suggestions: [] });
    expect(countDots(container)).toBe(0);
  });

  it("attaches to the newest turn only", () => {
    const { container } = renderPanel({
      turns: [ANSWER, { id: "u1", role: "user", text: "and pricing?" }],
      isStreaming: true,
      suggestions: [],
    });
    expect(countDots(container)).toBe(0);
  });
});
