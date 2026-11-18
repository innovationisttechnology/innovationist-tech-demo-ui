import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPanel } from "./chat-panel";

const ANSWER = {
  id: "a1",
  role: "assistant" as const,
  text: "I can only answer from the documents in this session.",
};

const SUGGESTION = "How does the release captain rotate?";

const STARTER = "What happens if the release captain is on leave?";

function renderPanel(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const onSendAction = vi.fn();
  const onRetryAction = vi.fn();
  const onApprovalDecisionAction = vi.fn();
  const onLinkSelectionAction = vi.fn();
  const onDismissCallAction = vi.fn();
  const renderWith = (
    currentOverrides: Partial<Parameters<typeof ChatPanel>[0]>,
  ) => (
    <ChatPanel
      turns={[ANSWER]}
      isStreaming={false}
      isReady
      pendingCalls={[]}
      suggestions={[SUGGESTION]}
      starterQuestions={[]}
      starterQuestionsOrigin="recovered"
      resolvingCallId={null}
      canRetry={false}
      onRetryAction={onRetryAction}
      onSendAction={onSendAction}
      onLoadOlderTurnsAction={vi.fn()}
      onApprovalDecisionAction={onApprovalDecisionAction}
      onLinkSelectionAction={onLinkSelectionAction}
      onDismissCallAction={onDismissCallAction}
      {...currentOverrides}
    />
  );
  const rendered = render(renderWith(overrides));
  return {
    ...rendered,
    rerenderPanel: (nextOverrides: Partial<Parameters<typeof ChatPanel>[0]>) =>
      rendered.rerender(renderWith(nextOverrides)),
    onSendAction,
    onRetryAction,
    onApprovalDecisionAction,
    onLinkSelectionAction,
    onDismissCallAction,
  };
}

describe("recovering from a cut-off answer", () => {
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

  // ziza's `error` and `limit` events carry no answer text, so what they say
  // has to be shown here or nowhere.
  it("says what went wrong", () => {
    renderPanel({
      canRetry: true,
      streamFailureMessage: "The model is unavailable. Try again shortly.",
    });
    expect(
      screen.getByText("The model is unavailable. Try again shortly."),
    ).toBeVisible();
  });

  // A rate limit names a wait; offering the button before it is over only
  // earns another refusal.
  it("keeps the message but holds the button back during a wait", () => {
    renderPanel({
      canRetry: false,
      streamFailureMessage: "Too many requests. Try again in 30s.",
    });
    expect(screen.getByText(/Try again in 30s/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });
});

describe("follow-up chips", () => {
  it("shows the question", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: SUGGESTION })).toBeVisible();
    expect(screen.getByText("worth asking")).toBeInTheDocument();
  });

  // Acting on a suggestion is an ordinary chat message — no second endpoint
  // sits behind a chip.
  it("sends it through the normal send path", async () => {
    const { onSendAction } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: SUGGESTION }));
    expect(onSendAction).toHaveBeenCalledWith(SUGGESTION);
  });

  // Clicking mid-stream would cut the answer off.
  it("stays hidden while a reply is still streaming", () => {
    renderPanel({ isStreaming: true });
    expect(
      screen.queryByRole("button", { name: SUGGESTION }),
    ).not.toBeInTheDocument();
  });

  it("stays hidden when the last turn is the visitor's", () => {
    renderPanel({
      turns: [ANSWER, { id: "u1", role: "user", text: "what about pricing?" }],
    });
    expect(
      screen.queryByRole("button", { name: SUGGESTION }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing extra when there are none", () => {
    renderPanel({ suggestions: [] });
    expect(screen.queryByText("worth asking")).not.toBeInTheDocument();
  });
});

describe("starter questions after an upload", () => {
  // Real questions say "what to do here" better than a card telling you to
  // ask something, so they take the zero state's place rather than joining it.
  it("replaces the zero-state card entirely", () => {
    renderPanel({ turns: [], suggestions: [], starterQuestions: [STARTER] });
    expect(screen.getByRole("button", { name: STARTER })).toBeVisible();
    expect(screen.queryByText("Ask anything")).not.toBeInTheDocument();
    expect(screen.queryByText(/Add a source and it will search/)).toBeNull();
  });

  it("keeps the zero-state card when there are no questions", () => {
    renderPanel({ turns: [], suggestions: [], starterQuestions: [] });
    expect(screen.getByText("Ask anything")).toBeInTheDocument();
  });

  it("shows no recovered ones once the conversation has turns", () => {
    renderPanel({ starterQuestions: [STARTER] });
    expect(
      screen.queryByRole("button", { name: STARTER }),
    ).not.toBeInTheDocument();
  });

  it("shows an upload's own mid-conversation, apart from the last reply", () => {
    renderPanel({
      suggestions: [],
      starterQuestions: [STARTER],
      starterQuestionsOrigin: "upload",
    });
    expect(screen.getByRole("button", { name: STARTER })).toBeVisible();
  });

  it("sends through the same path as every other chip", async () => {
    const { onSendAction } = renderPanel({
      turns: [],
      starterQuestions: [STARTER],
    });
    await userEvent.click(screen.getByRole("button", { name: STARTER }));
    expect(onSendAction).toHaveBeenCalledWith(STARTER);
  });

  // They share the turn-level gate: chips call onSendAction directly, so a
  // click mid-stream would cut the answer off.
  it("stays hidden while a reply is streaming", () => {
    renderPanel({ turns: [], starterQuestions: [STARTER], isStreaming: true });
    expect(
      screen.queryByRole("button", { name: STARTER }),
    ).not.toBeInTheDocument();
  });

  it("smoothly scrolls an upload's starters into view below the history", () => {
    const { container, rerenderPanel } = renderPanel({ suggestions: [] });
    const viewport = container.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )!;
    const scrollTo = vi.spyOn(viewport, "scrollTo");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const top = this === viewport ? 100 : 700;
        return { top } as DOMRect;
      },
    );

    rerenderPanel({
      suggestions: [],
      starterQuestions: [STARTER],
      starterQuestionsOrigin: "upload",
    });
    const scrollCalls = scrollTo.mock.calls;
    vi.restoreAllMocks();
    expect(scrollCalls).toEqual([[{ top: 600, behavior: "smooth" }]]);
  });

  // Separate state slots: an upload finishing must not wipe an unclicked chip.
  it("coexists with an unanswered follow-up", () => {
    renderPanel({
      suggestions: [SUGGESTION],
      starterQuestions: [STARTER],
      starterQuestionsOrigin: "upload",
    });
    expect(screen.getByRole("button", { name: SUGGESTION })).toBeVisible();
    expect(screen.getByRole("button", { name: STARTER })).toBeVisible();
  });

  it("asks the visitor what they want to know", () => {
    renderPanel({ turns: [], starterQuestions: [STARTER] });
    expect(
      screen.getByRole("heading", { name: /what would you like to know/i }),
    ).toBeInTheDocument();
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

describe("citations under an answer", () => {
  const CITED_ANSWER = {
    ...ANSWER,
    text: "Captains rotate weekly [1], unless on leave [2].",
    citations: [
      {
        number: 2,
        sourceRef: "leave-policy.pdf",
        locator: "page 4",
        isRemoved: false,
      },
      { number: 1, sourceRef: "handbook.pdf", isRemoved: false },
    ],
  };

  it("lists each source in marker order", () => {
    renderPanel({ turns: [CITED_ANSWER], suggestions: [] });
    const items = screen
      .getByRole("list", { name: "Sources cited" })
      .querySelectorAll("li");
    expect(items[0]).toHaveTextContent("[1] handbook.pdf");
    expect(items[1]).toHaveTextContent("[2] leave-policy.pdf · page 4");
  });

  // History marks a cited source that was removed since; the answer still
  // points at it, so it stays listed rather than renumbering the markers.
  it("keeps a removed source in place but says so", () => {
    renderPanel({
      turns: [
        {
          ...CITED_ANSWER,
          citations: [{ number: 1, sourceRef: "old.pdf", isRemoved: true }],
        },
      ],
      suggestions: [],
    });
    expect(screen.getByText("(removed)")).toBeInTheDocument();
  });

  it("adds nothing to an answer that cited nothing", () => {
    renderPanel({ suggestions: [] });
    expect(
      screen.queryByRole("list", { name: "Sources cited" }),
    ).not.toBeInTheDocument();
  });
});

describe("an action that never finished", () => {
  // History cannot bring the card back, so the turn says what became of it.
  it("shows as a muted note on the turn", () => {
    renderPanel({
      turns: [
        {
          ...ANSWER,
          unfinishedAction: {
            description: "Clear all documents in this session",
            reason: "expired",
          },
        },
      ],
      suggestions: [],
    });
    expect(
      screen.getByText(/Not done: Clear all documents in this session/),
    ).toHaveTextContent("(expired)");
  });
});

describe("pending cards", () => {
  const CLEAR_APPROVAL = {
    kind: "approval" as const,
    id: "act_1",
    toolName: "clear_session_knowledge",
    description: "Remove all 3 documents from this session",
    isDestructive: true,
  };

  const LINK_OFFER = {
    kind: "link_offer" as const,
    id: "off_1",
    pageUrl: "https://example.com/",
    links: [{ url: "https://example.com/pricing", title: "Pricing" }],
  };

  it("sends an explicit decline only from the Cancel button", async () => {
    const { onApprovalDecisionAction } = renderPanel({
      pendingCalls: [CLEAR_APPROVAL],
    });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApprovalDecisionAction).toHaveBeenCalledWith("act_1", "decline");
  });

  it("approves by action id", async () => {
    const { onApprovalDecisionAction } = renderPanel({
      pendingCalls: [CLEAR_APPROVAL],
    });
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onApprovalDecisionAction).toHaveBeenCalledWith("act_1", "approve");
  });

  it("shows the clear in the destructive treatment", () => {
    renderPanel({ pendingCalls: [CLEAR_APPROVAL] });
    expect(screen.getByText("confirmation required")).toHaveClass(
      "text-destructive",
    );
  });

  it("offers the page's links by title and submits the ones picked", async () => {
    const { onLinkSelectionAction } = renderPanel({
      pendingCalls: [LINK_OFFER],
    });
    await userEvent.click(screen.getByRole("checkbox", { name: /Pricing/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Index the page + 1 link(s)" }),
    );
    expect(onLinkSelectionAction).toHaveBeenCalledWith("off_1", [
      "https://example.com/pricing",
    ]);
  });

  // An offer has nothing to decline: walking away is the decline.
  it("lets an offer be put aside without telling ziza", async () => {
    const { onDismissCallAction, onLinkSelectionAction } = renderPanel({
      pendingCalls: [LINK_OFFER],
    });
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDismissCallAction).toHaveBeenCalledWith("off_1");
    expect(onLinkSelectionAction).not.toHaveBeenCalled();
  });

  it("warns before the picked pages would exceed the session's slots", async () => {
    renderPanel({ pendingCalls: [LINK_OFFER], slotsLeft: 1 });
    await userEvent.click(screen.getByRole("checkbox", { name: /Pricing/ }));
    expect(screen.getByText(/Only 1 slot\(s\) left/)).toBeInTheDocument();
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
