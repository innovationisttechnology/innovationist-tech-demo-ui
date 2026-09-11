import { describe, expect, it } from "vitest";

import { toPendingCall } from "./ziza.mapper";
import { ZizaAgentEventSchema, ZizaTextFrameSchema } from "./ziza.schema";

// Verbatim from the backend SSE. A frame that matches neither schema is
// dropped in the route handler, which is invisible from the browser — these
// pin the wire contract so that regression is a red test instead of a
// terminal-log hunt.
const APPROVAL_FRAME = {
  type: "chat.approval_required",
  pending_call: {
    tool_call_id: "toolu_01AxASaNG7y1vyVu4tW4cCkG",
    tool_name: "clear_knowledge_base",
    kind: "approval",
    details: {
      action: "clear_knowledge_base",
      documents: ["https://innovationisttech.com/"],
      summary:
        "Delete 1 document(s) from this session, along with their image descriptions and this conversation.",
    },
  },
};

const INPUT_FRAME = {
  type: "chat.input_required",
  pending_call: {
    tool_call_id: "toolu_02",
    tool_name: "add_url_to_knowledge_base",
    kind: "call",
    details: {
      action: "add_url_to_knowledge_base",
      url: "https://innovationisttech.com/",
      page_title: "Innovationist Technology Solutions",
      links: [
        { url: "https://innovationisttech.com/blog", text: "Blog" },
        { url: "https://innovationisttech.com/services", text: "Services" },
      ],
      slots_left: 4,
      summary: "Index Innovationist Technology Solutions, and choose any of…",
    },
  },
};

function parseCall(frame: unknown) {
  const parsed = ZizaAgentEventSchema.parse(frame);
  if (
    parsed.type !== "chat.approval_required" &&
    parsed.type !== "chat.input_required"
  ) {
    throw new Error("expected a deferral event");
  }
  return toPendingCall(parsed.pending_call);
}

describe("the approval frame", () => {
  it("is not mistaken for a text delta", () => {
    expect(ZizaTextFrameSchema.safeParse(APPROVAL_FRAME).success).toBe(false);
  });

  it("parses as an agent event so the route forwards it", () => {
    expect(ZizaAgentEventSchema.safeParse(APPROVAL_FRAME).success).toBe(true);
  });

  it("carries the call id, summary and documents through the mapper", () => {
    const call = parseCall(APPROVAL_FRAME);
    expect(call.kind).toBe("approval");
    expect(call.toolCallId).toBe("toolu_01AxASaNG7y1vyVu4tW4cCkG");
    expect(call.summary).toContain("Delete 1 document(s)");
    if (call.kind !== "approval") {
      throw new Error("expected an approval");
    }
    expect(call.documents).toEqual(["https://innovationisttech.com/"]);
    expect(call.isDestructive).toBe(true);
  });

  it("lets an explicit severity override the tool name", () => {
    const call = parseCall({
      ...APPROVAL_FRAME,
      pending_call: {
        ...APPROVAL_FRAME.pending_call,
        details: { ...APPROVAL_FRAME.pending_call.details, severity: "info" },
      },
    });
    expect(call.kind === "approval" && call.isDestructive).toBe(false);
  });

  it("treats an unknown gated tool as ordinary, not dangerous", () => {
    const call = parseCall({
      type: "chat.approval_required",
      pending_call: {
        tool_call_id: "toolu_03",
        tool_name: "some_future_tool",
        kind: "approval",
        details: {},
      },
    });
    expect(call.kind === "approval" && call.isDestructive).toBe(false);
  });
});

describe("the input-required frame", () => {
  it("parses as an agent event so the route forwards it", () => {
    expect(ZizaAgentEventSchema.safeParse(INPUT_FRAME).success).toBe(true);
  });

  it("carries the page and its offered links through the mapper", () => {
    const call = parseCall(INPUT_FRAME);
    expect(call.kind).toBe("call");
    if (call.kind !== "call") {
      throw new Error("expected a deferred call");
    }
    expect(call.pageUrl).toBe("https://innovationisttech.com/");
    expect(call.pageTitle).toBe("Innovationist Technology Solutions");
    expect(call.links).toHaveLength(2);
    expect(call.slotsLeft).toBe(4);
  });

  it("survives a page with no title", () => {
    const call = parseCall({
      ...INPUT_FRAME,
      pending_call: {
        ...INPUT_FRAME.pending_call,
        details: { ...INPUT_FRAME.pending_call.details, page_title: null },
      },
    });
    expect(call.kind === "call" && call.pageTitle).toBeUndefined();
  });

  it("survives metadata from a deferred tool it has never seen", () => {
    const parsed = ZizaAgentEventSchema.safeParse({
      type: "chat.input_required",
      pending_call: {
        tool_call_id: "toolu_04",
        tool_name: "some_future_tool",
        kind: "call",
        details: { rows_affected: 12 },
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("the suggestions frame", () => {
  const SUGGESTIONS_FRAME = {
    type: "chat.suggestions",
    suggestions: [
      {
        kind: "add_page",
        label: "Index innovationisttech.com",
        message: "Add https://innovationisttech.com/ to my knowledge base",
        url: "https://innovationisttech.com/",
      },
    ],
  };

  it("parses as an agent event so the route forwards it", () => {
    expect(ZizaAgentEventSchema.safeParse(SUGGESTIONS_FRAME).success).toBe(
      true,
    );
  });

  it("round-trips the chip label and the message it sends", () => {
    const parsed = ZizaAgentEventSchema.parse(SUGGESTIONS_FRAME);
    if (parsed.type !== "chat.suggestions") {
      throw new Error("expected a suggestions event");
    }
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.suggestions[0].label).toBe("Index innovationisttech.com");
    expect(parsed.suggestions[0].message).toBe(
      "Add https://innovationisttech.com/ to my knowledge base",
    );
  });

  // More kinds are coming server-side. An unrecognised one must still parse,
  // so the chip renders and falls back to sending `message`.
  it("parses a kind the frontend has never seen", () => {
    const parsed = ZizaAgentEventSchema.safeParse({
      type: "chat.suggestions",
      suggestions: [
        { kind: "some_future_kind", label: "Do the thing", message: "do it" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("survives a suggestion with no url", () => {
    const parsed = ZizaAgentEventSchema.safeParse({
      type: "chat.suggestions",
      suggestions: [{ kind: "add_page", label: "Upload", message: "help" }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("a text frame", () => {
  it("still parses as a delta despite carrying a type", () => {
    expect(
      ZizaTextFrameSchema.safeParse({ type: "chat.chunk", chunk: "hello" })
        .success,
    ).toBe(true);
  });
});
