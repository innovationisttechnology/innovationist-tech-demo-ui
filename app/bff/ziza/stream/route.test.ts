// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const ZIZA_STREAM = [
  "event: searching\ndata: {}\n\n",
  ": keepalive\n\n",
  'event: working\ndata: {"kind":"passages","passages":[{"number":1,"title":"handbook.pdf","locator":"p. 3","excerpt":"Captains"}]}\n\n',
  'event: text\ndata: {"text":"Weekly "}\n\n',
  'event: text\ndata: {"text":"[1]."}\n\n',
  'event: citations\ndata: {"citations":[{"number":1,"record_id":"r1","source_id":"src_1","source_ref":"handbook.pdf","locator":"p. 3","score":0.8}]}\n\n',
  'event: done\ndata: {"answered":true,"small_talk":false,"usage":{},"refusal":null,"pending_action":null}\n\n',
  'event: suggestions\ndata: {"follow_ups":["Who covers leave?"]}\n\n',
].join("");

function streamRequest(body: unknown, cookie = "ziza_session=tok_old") {
  return new NextRequest("http://demo.test/bff/ziza/stream", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie },
  });
}

async function readUiStream(response: Response) {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
}

beforeEach(() => {
  vi.stubEnv("ZIZA_API_URL", "http://ziza.test");
  vi.stubEnv("ZIZA_DEMO_SERVER_SECRET", "zps_test_secret");
  vi.stubEnv("NODE_ENV", "development");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the chat stream translator", () => {
  it("turns ziza's events into the UI message stream", async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(ZIZA_STREAM, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const response = await POST(streamRequest({ message: "Who rotates?" }));
    const parts = await readUiStream(response);

    const deltas = parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("");
    expect(deltas).toBe("Weekly [1].");

    expect(parts).toContainEqual({
      type: "data-citations",
      data: [
        {
          number: 1,
          sourceId: "src_1",
          sourceRef: "handbook.pdf",
          locator: "p. 3",
          isRemoved: false,
        },
      ],
    });

    const forwardedTypes = parts
      .filter((part) => part.type === "data-ziza")
      .map((part) => part.data.type);
    expect(forwardedTypes).toEqual([
      "stream_open",
      "searching",
      "working",
      "done",
      "suggestions",
      "stream_close",
    ]);

    expect(fetchStub).toHaveBeenCalledWith(
      "http://ziza.test/api/app/chat/stream",
      expect.objectContaining({
        body: JSON.stringify({ message: "Who rotates?" }),
      }),
    );
  });

  it("never lets the secret or the token reach the browser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(ZIZA_STREAM, {
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );
    const response = await POST(streamRequest({ message: "Who rotates?" }));
    const visibleToBrowser = [
      await response.text(),
      ...Array.from(response.headers.entries()).flat(),
    ].join("\n");
    expect(visibleToBrowser).not.toContain("zps_test_secret");
    expect(visibleToBrowser).not.toContain("tok_old");
  });

  // Rejections before the stream starts keep ziza's body, so the browser can
  // read `details.code` (`turn_in_progress`, `message_too_long`, ...).
  it("hands a refused turn back with ziza's error body", async () => {
    const refusal = {
      error: "turn_in_progress",
      message: "A turn is already running",
      status_code: 409,
      details: {
        code: "turn_in_progress",
        message: "A turn is already running",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(refusal), { status: 409 })),
    );
    const response = await POST(streamRequest({ message: "again" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(refusal);
  });

  it("refuses an empty message without calling ziza", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    const response = await POST(streamRequest({ message: "" }));
    expect(response.status).toBe(400);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
