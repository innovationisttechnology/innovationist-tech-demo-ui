import { NextResponse } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import {
  ZizaAgentEventSchema,
  ZizaChatRequestSchema,
  ZizaTextFrameSchema,
} from "@/lib/ziza/ziza.schema";

// One public API address, used by the browser and by this handler alike.
// Compiled in at build time rather than read at runtime, so it must be
// supplied as a Docker build arg — `docker run -e` happens too late.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const TEXT_PART_ID = "text-0";

// Server-side tracing of the raw backend SSE, so the HITL contract can be read
// off the terminal while it is still being built out. `event:` names and frames
// the schemas reject are the interesting ones — an approval frame the frontend
// has no variant for is otherwise dropped in silence.
const LOG_PREFIX = "[ziza stream]";
const MAX_LOGGED_PAYLOAD_CHARS = 500;

const truncate = (payload: string) =>
  payload.length <= MAX_LOGGED_PAYLOAD_CHARS
    ? payload
    : `${payload.slice(0, MAX_LOGGED_PAYLOAD_CHARS)}… (+${payload.length - MAX_LOGGED_PAYLOAD_CHARS} chars)`;

/**
 * Protocol translator: the demo API speaks its own SSE dialect, the AI SDK's
 * `useChat` speaks UI message streams. This route is the only place that knows
 * both.
 *
 * Two frame shapes are handled:
 *   `{"chunk": "..."}`  — today's backend output, becomes a text delta.
 *   `{"type": "...", …}` — the Phase 2 contract (intent / tool_call /
 *                          chunk_retrieved / error), forwarded as a transient
 *                          `data-ziza` part for the inspector panel.
 *
 * The second shape isn't emitted by the backend yet. Parsing it now is what
 * makes Phase 5 a backend-only change.
 */
export async function POST(incomingRequest: Request) {
  const body = await incomingRequest.json().catch(() => null);
  const parsedBody = ZizaChatRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      { message: "Invalid request", issues: parsedBody.error.issues },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/api/ziza/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(parsedBody.data),
      signal: incomingRequest.signal,
    });
  } catch (failure) {
    const reason = API_BASE_URL
      ? `Could not reach the demo API at ${API_BASE_URL}`
      : "NEXT_PUBLIC_API_BASE_URL was empty at build time, so there is no API address to call";
    console.error("ziza stream upstream failed:", reason, failure);
    return NextResponse.json({ message: reason }, { status: 503 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { message: "The demo API rejected the stream request" },
      { status: upstream.status === 200 ? 502 : upstream.status },
    );
  }

  const upstreamBody = upstream.body;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({
        type: "data-ziza",
        data: { type: "stream_open", status: upstream.status },
        transient: true,
      });

      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let hasOpenTextPart = false;
      let frameCount = 0;

      const writeTextDelta = (delta: string) => {
        if (!hasOpenTextPart) {
          writer.write({ type: "text-start", id: TEXT_PART_ID });
          hasOpenTextPart = true;
        }
        writer.write({ type: "text-delta", delta, id: TEXT_PART_ID });
      };

      const handleFrame = (payload: string, eventName?: string) => {
        frameCount += 1;
        const origin = `${LOG_PREFIX} frame ${frameCount}${eventName ? ` event=${eventName}` : ""}`;

        let frame: unknown;
        try {
          frame = JSON.parse(payload);
        } catch {
          console.warn(`${origin} unparseable:`, truncate(payload));
          return; // skip malformed frames rather than killing the stream
        }

        const textFrame = ZizaTextFrameSchema.safeParse(frame);
        if (textFrame.success) {
          console.log(`${origin} text:`, truncate(textFrame.data.chunk));
          writeTextDelta(textFrame.data.chunk);
          return;
        }

        const agentEvent = ZizaAgentEventSchema.safeParse(frame);
        if (agentEvent.success) {
          console.log(`${origin} agent event:`, truncate(payload));
          writer.write({
            type: "data-ziza",
            data: agentEvent.data,
            transient: true,
          });
          return;
        }

        console.warn(
          `${origin} no schema matched — dropped, nothing reaches the client:`,
          truncate(payload),
        );
      };

      // An SSE frame is an `event:` line followed by its `data:` line, so the
      // name is carried forward to the frame it labels.
      let pendingEventName: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith("event:")) {
            pendingEventName = trimmed.slice(6).trim();
            continue;
          }

          const payload = trimmed.startsWith("data:")
            ? trimmed.slice(5).trim()
            : trimmed;

          if (!payload || payload === "[DONE]") {
            continue;
          }

          handleFrame(payload, pendingEventName);
          pendingEventName = undefined;
        }
      }

      if (hasOpenTextPart) {
        writer.write({ type: "text-end", id: TEXT_PART_ID });
      }

      console.log(`${LOG_PREFIX} closed after ${frameCount} frame(s)`);

      writer.write({
        type: "data-ziza",
        data: { type: "stream_close" },
        transient: true,
      });
    },
    onError: () => "The chat stream failed.",
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
