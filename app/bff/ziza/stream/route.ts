import { NextResponse } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import {
  ZizaAgentEventSchema,
  ZizaChatRequestSchema,
  ZizaTextFrameSchema,
} from "@/lib/ziza/ziza.schema";

const API_ORIGIN =
  process.env.ZIZA_API_ORIGIN ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const TEXT_PART_ID = "text-0";

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
    upstream = await fetch(`${API_ORIGIN}/api/ziza/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(parsedBody.data),
      signal: incomingRequest.signal,
    });
  } catch (failure) {
    const reason = API_ORIGIN
      ? `Could not reach the demo API at ${API_ORIGIN}`
      : "ZIZA_API_ORIGIN is not set, so there is no API address to call";
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

      const writeTextDelta = (delta: string) => {
        if (!hasOpenTextPart) {
          writer.write({ type: "text-start", id: TEXT_PART_ID });
          hasOpenTextPart = true;
        }
        writer.write({ type: "text-delta", delta, id: TEXT_PART_ID });
      };

      const handleFrame = (payload: string) => {
        let frame: unknown;
        try {
          frame = JSON.parse(payload);
        } catch {
          return; // skip malformed frames rather than killing the stream
        }

        const textFrame = ZizaTextFrameSchema.safeParse(frame);
        if (textFrame.success) {
          writeTextDelta(textFrame.data.chunk);
          return;
        }

        const agentEvent = ZizaAgentEventSchema.safeParse(frame);
        if (agentEvent.success) {
          writer.write({
            type: "data-ziza",
            data: agentEvent.data,
            transient: true,
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const payload = line.startsWith("data:")
            ? line.slice(5).trim()
            : line.trim();

          if (!payload || payload === "[DONE]") {
            continue;
          }

          handleFrame(payload);
        }
      }

      if (hasOpenTextPart) {
        writer.write({ type: "text-end", id: TEXT_PART_ID });
      }

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
