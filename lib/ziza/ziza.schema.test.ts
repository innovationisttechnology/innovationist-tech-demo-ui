import { describe, expect, it } from "vitest";

import { toPendingCall } from "./ziza.mapper";
import {
  KnowledgeIngestResponseSchema,
  KnowledgeSuggestionsResponseSchema,
  ZizaAgentEventSchema,
  ZizaTextFrameSchema,
} from "./ziza.schema";

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

describe("the ingest response", () => {
  const INGEST_RESPONSE = {
    session_id: "s1",
    source: "handbook.pdf",
    chunks_ingested: 12,
    searchable: true,
    images_described: 2,
    images_failed: 0,
    documents_used: 1,
    documents_allowed: 5,
    pages_summarised: 0,
  };

  // The backend does not generate starter questions yet, so today's responses
  // omit the field entirely and must still parse.
  it("parses without the suggestions the backend has yet to send", () => {
    const parsed = KnowledgeIngestResponseSchema.safeParse(INGEST_RESPONSE);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.suggestions).toEqual([]);
  });

  it("carries starter questions once they arrive", () => {
    const parsed = KnowledgeIngestResponseSchema.parse({
      ...INGEST_RESPONSE,
      suggestions: [
        {
          kind: "ask",
          label: "What happens if the release captain is on leave?",
          message: "What happens if the release captain is on leave?",
        },
      ],
    });
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.suggestions[0].kind).toBe("ask");
  });
});

// Verbatim from a real 201. The `"url": null` here is the whole point: a bare
// `.optional()` rejects null, which failed the entire response — so a stored
// document surfaced as "Failed (201)" and its questions were thrown away.
describe("a real ingest response", () => {
  const LIVE_RESPONSE = {
    session_id: "769fec48-95d5-4fb9-ae00-9700798066b4",
    source: "Screenshot 2026-09-12 at 3.29.46 PM.png",
    chunks_ingested: 1,
    images_described: 1,
    pages_summarised: 0,
    documents_used: 2,
    documents_allowed: 10,
    images_failed: 0,
    searchable: true,
    suggestions: [
      {
        kind: "ask",
        label:
          "What file formats does the AI chatbot accept for source uploads?",
        message:
          "What file formats does the AI chatbot accept for source uploads?",
        url: null,
      },
      {
        kind: "ask",
        label:
          "What is the localhost port and path for this AI chatbot interface?",
        message:
          "What is the localhost port and path for this AI chatbot interface?",
        url: null,
      },
    ],
  };

  it("parses, rather than failing the upload over a null url", () => {
    const parsed = KnowledgeIngestResponseSchema.safeParse(LIVE_RESPONSE);
    expect(parsed.success).toBe(true);
  });

  it("keeps both starter questions", () => {
    const parsed = KnowledgeIngestResponseSchema.parse(LIVE_RESPONSE);
    expect(parsed.suggestions).toHaveLength(2);
    expect(parsed.suggestions[0].kind).toBe("ask");
  });

  it("carries session capacity through", () => {
    const parsed = KnowledgeIngestResponseSchema.parse(LIVE_RESPONSE);
    expect(parsed.documents_used).toBe(2);
    expect(parsed.documents_allowed).toBe(10);
  });

  it("still accepts a suggestion whose url is simply absent", () => {
    const parsed = KnowledgeIngestResponseSchema.safeParse({
      ...LIVE_RESPONSE,
      suggestions: [{ kind: "ask", label: "Why?", message: "Why?" }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("the starter-question recovery read", () => {
  it("carries the document its questions are about", () => {
    const parsed = KnowledgeSuggestionsResponseSchema.parse({
      session_id: "s1",
      document: "handbook.pdf",
      suggestions: [
        {
          kind: "ask",
          label: "What happens if the release captain is on leave?",
          message: "What happens if the release captain is on leave?",
        },
      ],
    });
    expect(parsed.document).toBe("handbook.pdf");
    expect(parsed.suggestions).toHaveLength(1);
  });

  // A session with nothing in it, and a document nothing could be asked about,
  // are both normal answers rather than failures.
  it("accepts an empty session", () => {
    const parsed = KnowledgeSuggestionsResponseSchema.parse({
      session_id: "s1",
      document: null,
      suggestions: [],
    });
    expect(parsed.document).toBeNull();
    expect(parsed.suggestions).toEqual([]);
  });

  it("accepts a document that yielded no questions", () => {
    const parsed = KnowledgeSuggestionsResponseSchema.parse({
      session_id: "s1",
      document: "login-wall.html",
      suggestions: [],
    });
    expect(parsed.suggestions).toEqual([]);
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
