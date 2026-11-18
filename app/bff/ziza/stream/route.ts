import { NextResponse, type NextRequest } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import {
  ZizaChatRequestSchema,
  parseZizaChatEvent,
} from "@/lib/ziza/ziza.schema";
import { toCitation } from "@/lib/ziza/ziza.mapper";
import { readServerSentEvents } from "@/lib/ziza/ziza.sse";
import {
  REQUEST_ID_HEADER,
  applySessionOutcome,
  bffErrorResponse,
  callZizaWithSession,
  passThroughUpstreamError,
  resolveZizaRequestContext,
} from "@/lib/ziza/ziza.upstream";

const TEXT_PART_ID = "text-0";
const LOG_PREFIX = "[ziza stream]";

/**
 * Protocol translator: ziza speaks its own SSE dialect, `useChat` speaks UI
 * message streams. This route is the only place that knows both.
 *
 * `text` becomes a text delta and `citations` a `data-citations` part that
 * stays on the message. Every other event is forwarded as a transient
 * `data-ziza` part, with the event name folded in as `type`.
 */
export async function POST(incomingRequest: NextRequest) {
  const parsedBody = ZizaChatRequestSchema.safeParse(
    await incomingRequest.json().catch(() => null),
  );
  if (!parsedBody.success) {
    return bffErrorResponse(400, "invalid_request", "Invalid request");
  }

  const context = resolveZizaRequestContext(incomingRequest);
  if (context instanceof NextResponse) {
    return context;
  }

  const requestBody = JSON.stringify({ message: parsedBody.data.message });
  const outcome = await callZizaWithSession(
    incomingRequest,
    context.config,
    context.visitorAddress,
    {
      label: "POST chat/stream",
      appRelativePath: "chat/stream",
      buildRequestInit: (zizaHeaders) => ({
        method: "POST",
        headers: {
          ...zizaHeaders,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: requestBody,
        signal: incomingRequest.signal,
      }),
    },
  );
  if ("failureResponse" in outcome) {
    return outcome.failureResponse;
  }

  const { upstream } = outcome;
  if (!upstream.ok || !upstream.body) {
    return upstream.ok
      ? bffErrorResponse(502, "upstream_unreadable", "ziza sent no stream.")
      : passThroughUpstreamError(upstream);
  }

  const upstreamBody = upstream.body;
  const upstreamRequestId = upstream.headers.get(REQUEST_ID_HEADER) ?? "none";

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({
        type: "data-ziza",
        data: { type: "stream_open", status: upstream.status },
        transient: true,
      });

      let hasOpenTextPart = false;
      let eventCount = 0;

      for await (const serverSentEvent of readServerSentEvents(upstreamBody)) {
        eventCount += 1;
        let payload: unknown;
        try {
          payload = JSON.parse(serverSentEvent.data);
        } catch {
          console.warn(
            `${LOG_PREFIX} event ${eventCount} (${serverSentEvent.event}) is not JSON; dropped`,
          );
          continue;
        }

        const chatEvent = parseZizaChatEvent(serverSentEvent.event, payload);
        if (!chatEvent) {
          console.warn(
            `${LOG_PREFIX} event ${eventCount} (${serverSentEvent.event}) matched no schema; dropped`,
          );
          continue;
        }

        if (chatEvent.type === "text") {
          if (!hasOpenTextPart) {
            writer.write({ type: "text-start", id: TEXT_PART_ID });
            hasOpenTextPart = true;
          }
          writer.write({
            type: "text-delta",
            delta: chatEvent.text,
            id: TEXT_PART_ID,
          });
          continue;
        }

        if (chatEvent.type === "citations") {
          writer.write({
            type: "data-citations",
            data: chatEvent.citations.map(toCitation),
          });
          continue;
        }

        writer.write({ type: "data-ziza", data: chatEvent, transient: true });
      }

      if (hasOpenTextPart) {
        writer.write({ type: "text-end", id: TEXT_PART_ID });
      }

      console.log(
        `${LOG_PREFIX} closed after ${eventCount} event(s) (request id ${upstreamRequestId})`,
      );

      writer.write({
        type: "data-ziza",
        data: { type: "stream_close" },
        transient: true,
      });
    },
    onError: () => "The chat stream failed.",
  });

  const response = createUIMessageStreamResponse({
    stream,
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });

  // `createUIMessageStreamResponse` returns a plain Response; wrapping it
  // gives access to `NextResponse.cookies` without copying the stream.
  return applySessionOutcome(
    new NextResponse(response.body, response),
    outcome,
  );
}
