// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readServerSentEvents } from "./ziza.sse";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const serverSentEvent of readServerSentEvents(body)) {
    events.push(serverSentEvent);
  }
  return events;
}

describe("reading ziza's event stream", () => {
  it("pairs each event name with its data", async () => {
    const events = await collect(
      streamOf('event: text\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}\n\n'),
    );
    expect(events).toEqual([
      { event: "text", data: '{"text":"Hi"}' },
      { event: "done", data: "{}" },
    ]);
  });

  // ziza sends `: keepalive` every 15 s of silence. The old parser handed it
  // to JSON.parse.
  it("skips keepalive comments", async () => {
    const events = await collect(
      streamOf(": keepalive\n\nevent: searching\ndata: {}\n\n: keepalive\n\n"),
    );
    expect(events).toEqual([{ event: "searching", data: "{}" }]);
  });

  it("joins an event cut across chunks", async () => {
    const events = await collect(
      streamOf("event: te", 'xt\ndata: {"te', 'xt":"Hi"}\r', "\n\r\n"),
    );
    expect(events).toEqual([{ event: "text", data: '{"text":"Hi"}' }]);
  });

  it("joins multi-line data with newlines", async () => {
    const events = await collect(streamOf("data: one\ndata: two\n\n"));
    expect(events).toEqual([{ event: "message", data: "one\ntwo" }]);
  });

  it("keeps a last event whose blank line never came", async () => {
    const events = await collect(streamOf('event: suggestions\ndata: {"a":1}'));
    expect(events).toEqual([{ event: "suggestions", data: '{"a":1}' }]);
  });

  it("does not carry an event name over to the next event", async () => {
    const events = await collect(
      streamOf("event: done\ndata: {}\n\ndata: plain\n\n"),
    );
    expect(events[1]).toEqual({ event: "message", data: "plain" });
  });
});
