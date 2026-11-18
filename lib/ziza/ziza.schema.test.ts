import { describe, expect, it } from "vitest";

import {
  toChatHistoryPage,
  toSessionJob,
  toPendingApproval,
  toPendingLinkOffer,
  toResumedTurn,
  toSessionSources,
  toZizaFailure,
} from "./ziza.mapper";
import {
  ZizaErrorBodySchema,
  ZizaHistoryPageSchema,
  ZizaJobViewSchema,
  ZizaResumedTurnSchema,
  ZizaSourcesPageSchema,
  parseZizaChatEvent,
} from "./ziza.schema";

describe("chat stream events", () => {
  it("reads a text chunk", () => {
    expect(parseZizaChatEvent("text", { text: "Hi" })).toEqual({
      type: "text",
      text: "Hi",
    });
  });

  it("rejects an event name it does not know", () => {
    expect(parseZizaChatEvent("toString", {})).toBeNull();
    expect(parseZizaChatEvent("chunk", { chunk: "Hi" })).toBeNull();
  });

  it("reads the passages ziza found, without scores", () => {
    const event = parseZizaChatEvent("working", {
      kind: "passages",
      passages: [
        { number: 1, title: "handbook.pdf", locator: "p. 3", excerpt: "Cap" },
      ],
    });
    expect(event).toMatchObject({
      type: "working",
      passages: [{ number: 1, title: "handbook.pdf" }],
    });
  });

  it("reads suggestions as plain strings", () => {
    expect(parseZizaChatEvent("suggestions", { follow_ups: ["Why?"] })).toEqual(
      { type: "suggestions", follow_ups: ["Why?"] },
    );
  });

  it("reads a done event with no refusal", () => {
    expect(
      parseZizaChatEvent("done", {
        answered: true,
        small_talk: false,
        usage: {},
        refusal: null,
        pending_action: null,
      }),
    ).toMatchObject({ type: "done", refusal: null });
  });
});

describe("pending cards", () => {
  it("marks only the session clear as destructive", () => {
    const clear = toPendingApproval({
      action_id: "act_1",
      tool: "clear_session_knowledge",
      description: "Remove everything",
      expires_at: "2026-11-12T10:00:00Z",
    });
    expect(clear).toEqual({
      kind: "approval",
      id: "act_1",
      toolName: "clear_session_knowledge",
      description: "Remove everything",
      isDestructive: true,
    });
    expect(
      toPendingApproval({ action_id: "act_2", tool: "send_email" })
        .isDestructive,
    ).toBe(false);
  });

  // The page leads ziza's list, but it is not a choice: taking the offer
  // always indexes it.
  it("keeps the page out of the link choices", () => {
    const offer = toPendingLinkOffer({
      offer_id: "off_1",
      page_url: "https://example.com/",
      links: [
        { url: "https://example.com/", title: "Home" },
        { url: "https://example.com/pricing", title: "Pricing" },
      ],
      expires_at: null,
    });
    expect(offer.links).toEqual([
      { url: "https://example.com/pricing", title: "Pricing" },
    ]);
    expect(offer.pageTitle).toBe("Home");
  });
});

describe("errors", () => {
  it("reads the code from details", () => {
    const body = ZizaErrorBodySchema.parse({
      error: "rate_limited",
      message: "Slow down",
      status_code: 429,
      details: {
        code: "rate_limited",
        message: "Slow down",
        retry_after_seconds: 30,
      },
    });
    expect(toZizaFailure(429, body)).toEqual({
      httpStatus: 429,
      code: "rate_limited",
      message: "Slow down",
      retryAfterSeconds: 30,
    });
  });

  it("survives a body that is not ziza's", () => {
    expect(toZizaFailure(502, null)).toEqual({
      httpStatus: 502,
      code: undefined,
      message: undefined,
      retryAfterSeconds: undefined,
    });
  });
});

describe("ingest jobs", () => {
  it("describes embedding progress", () => {
    const job = toSessionJob(
      ZizaJobViewSchema.parse({
        id: "job_1",
        kind: "ingest_file",
        status: "processing",
        attempts: 1,
        progress: { step: "embedding", done: 3, total: 10 },
        result: null,
        error: null,
        created_at: "2026-11-12T10:00:00Z",
        finished_at: null,
      }),
    );
    expect(job.progressLabel).toBe("embedding 3/10");
  });

  it("carries the source id once done", () => {
    const job = toSessionJob(
      ZizaJobViewSchema.parse({
        id: "job_1",
        status: "done",
        progress: { step: "storing", total: 10 },
        result: {
          source_id: "src_1",
          chunks: 10,
          embedded: 10,
          cached_embeddings: 0,
          images_found: 2,
          images_described: 1,
          images_from_cache: 0,
          images_skipped: 0,
          images_failed: 1,
          images_not_described: 1,
          summary_added: false,
          spend_cap_reached: false,
          notes: [],
          starters_job_id: "job_starters",
        },
      }),
    );
    expect(job.startersJobId).toBe("job_starters");
    expect(job.result).toEqual({
      sourceId: "src_1",
      chunks: 10,
      imagesDescribed: 1,
      imagesSkipped: 0,
      imagesFailed: 1,
    });
  });

  // A starters job's result names no source; the job must still parse so
  // its status can be followed.
  it("reads a starters job, which has no source", () => {
    const job = toSessionJob(
      ZizaJobViewSchema.parse({
        id: "job_starters",
        kind: "starters",
        status: "done",
        result: { starters: 3 },
      }),
    );
    expect(job.status).toBe("done");
    expect(job.result).toBeUndefined();
  });

  it("reads the questions a starters job wrote for its upload", () => {
    const job = toSessionJob(
      ZizaJobViewSchema.parse({
        id: "job_starters",
        kind: "starters",
        status: "done",
        result: { starters: 2, questions: ["Who covers leave?", "How long?"] },
      }),
    );
    expect(job.starterQuestions).toEqual(["Who covers leave?", "How long?"]);
  });

  it("has no questions when the starters job skipped", () => {
    const job = toSessionJob(
      ZizaJobViewSchema.parse({
        id: "job_starters",
        kind: "starters",
        status: "done",
        result: { starters: 0 },
      }),
    );
    expect(job.starterQuestions).toBeUndefined();
  });

  it("has no starters job when the product turns starters off", () => {
    const job = toSessionJob(
      ZizaJobViewSchema.parse({
        id: "job_1",
        status: "done",
        result: { source_id: "src_1", chunks: 1, starters_job_id: null },
      }),
    );
    expect(job.startersJobId).toBeUndefined();
  });

  it("carries the failure message", () => {
    const job = toSessionJob(
      ZizaJobViewSchema.parse({
        id: "job_1",
        status: "failed",
        error: { type: "extraction", message: "No text", retryable: false },
      }),
    );
    expect(job.errorMessage).toBe("No text");
  });
});

describe("the sources read", () => {
  it("restores rows in the order they were added, keyed by source id", () => {
    const sources = toSessionSources(
      ZizaSourcesPageSchema.parse({
        items: [
          {
            source_id: "src_2",
            title: "b.pdf",
            kind: "file",
            added_at: "2026-11-12T10:05:00Z",
            status: "active",
          },
          {
            source_id: "src_1",
            title: "https://example.com/",
            kind: "url",
            added_at: "2026-11-12T10:00:00Z",
            status: "pending",
          },
        ],
        total: 2,
        limit: 50,
        skip: 0,
      }),
    );
    expect(sources.map((source) => [source.sourceId, source.status])).toEqual([
      ["src_1", "processing"],
      ["src_2", "indexed"],
    ]);
    expect(sources[0].kind).toBe("url");
  });
});

describe("the history read", () => {
  const page = ZizaHistoryPageSchema.parse({
    turns: [
      {
        id: "t2",
        user_text: "Clear it",
        answer_text: "",
        citations: [],
        answered: false,
        cited: false,
        small_talk: false,
        unfinished_action: { description: "Clear all", reason: "expired" },
        created_at: "2026-11-12T10:05:00Z",
      },
      {
        id: "t1",
        user_text: "Who rotates?",
        answer_text: "Weekly [1].",
        citations: [
          {
            number: 1,
            record_id: "r1",
            source_id: "src_1",
            source_ref: "handbook.pdf",
            locator: "p. 3",
            score: 0.8,
            removed: true,
          },
        ],
        answered: true,
        cited: true,
        small_talk: false,
        unfinished_action: null,
        created_at: "2026-11-12T10:00:00Z",
      },
    ],
    next_before: null,
  });

  it("expands each exchange into two messages, oldest first", () => {
    expect(toChatHistoryPage(page).turns.map((turn) => turn.id)).toEqual([
      "t1:user",
      "t1:assistant",
      "t2:user",
      "t2:assistant",
    ]);
  });

  it("marks a removed source on the citation", () => {
    expect(toChatHistoryPage(page).turns[1].citations).toEqual([
      {
        number: 1,
        sourceId: "src_1",
        sourceRef: "handbook.pdf",
        locator: "p. 3",
        isRemoved: true,
      },
    ]);
  });

  it("carries an unfinished action onto the answer", () => {
    expect(toChatHistoryPage(page).turns[3].unfinishedAction).toEqual({
      description: "Clear all",
      reason: "expired",
    });
  });

  it("ends the history at a null cursor", () => {
    expect(toChatHistoryPage(page).nextBefore).toBeNull();
  });
});

describe("a resumed turn", () => {
  it("can ask for another approval", () => {
    const turn = toResumedTurn(
      ZizaResumedTurnSchema.parse({
        text: "Done.",
        citations: [],
        approval_required: {
          type: "approval_required",
          action_id: "act_2",
          tool: "clear_session_knowledge",
        },
        suggestions: { follow_ups: ["What next?"] },
        refusal: null,
        failure: null,
      }),
    );
    expect(turn.approvalRequired?.id).toBe("act_2");
    expect(turn.followUps).toEqual(["What next?"]);
  });
});
