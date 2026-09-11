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
  render(
    <ChatPanel
      turns={[ANSWER]}
      isStreaming={false}
      isReady
      pendingCalls={[]}
      suggestions={[SUGGESTION]}
      resolvingCallId={null}
      onSendAction={onSendAction}
      onApprovalDecisionAction={vi.fn()}
      onLinkSelectionAction={vi.fn()}
      onDismissCallAction={vi.fn()}
      {...overrides}
    />,
  );
  return { onSendAction };
}

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
