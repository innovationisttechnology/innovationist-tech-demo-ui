import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  parseZizaChatEvent,
  type ZizaResumedTurnSchema,
} from "@/lib/ziza/ziza.schema";
import { readServerSentEvents } from "@/lib/ziza/ziza.sse";
import {
  applySessionOutcome,
  bffErrorResponse,
  callZizaWithSession,
  passThroughUpstreamError,
  resolveZizaRequestContext,
} from "@/lib/ziza/ziza.upstream";

const ApprovalDecisionSchema = z.object({
  decision: z.enum(["approve", "decline"]),
});

type ApprovalContext = { params: Promise<{ actionId: string }> };

type ResumedTurn = z.input<typeof ZizaResumedTurnSchema>;

// ziza answers a decision with the resumed turn as an SSE stream. The demo
// shows that turn as one finished message, so it is read to its end here and
// returned as a single JSON body.
export async function POST(
  incomingRequest: NextRequest,
  { params }: ApprovalContext,
) {
  const { actionId } = await params;
  const parsedBody = ApprovalDecisionSchema.safeParse(
    await incomingRequest.json().catch(() => null),
  );
  if (!parsedBody.success) {
    return bffErrorResponse(400, "invalid_request", "Invalid request");
  }

  const context = resolveZizaRequestContext(incomingRequest);
  if (context instanceof NextResponse) {
    return context;
  }

  const requestBody = JSON.stringify({ decision: parsedBody.data.decision });
  const appRelativePath = `chat/approvals/${encodeURIComponent(actionId)}`;
  const outcome = await callZizaWithSession(
    incomingRequest,
    context.config,
    context.visitorAddress,
    {
      label: `POST ${appRelativePath}`,
      appRelativePath,
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

  const resumedTurn: ResumedTurn = {
    text: "",
    citations: [],
    approval_required: null,
    suggestions: null,
    refusal: null,
    failure: null,
  };

  for await (const serverSentEvent of readServerSentEvents(upstream.body)) {
    let payload: unknown;
    try {
      payload = JSON.parse(serverSentEvent.data);
    } catch {
      continue;
    }
    const chatEvent = parseZizaChatEvent(serverSentEvent.event, payload);
    switch (chatEvent?.type) {
      case "text":
        resumedTurn.text += chatEvent.text;
        break;
      case "citations":
        resumedTurn.citations = chatEvent.citations;
        break;
      case "approval_required":
        resumedTurn.approval_required = chatEvent;
        break;
      case "suggestions":
        resumedTurn.suggestions = chatEvent;
        break;
      case "done":
        resumedTurn.refusal = chatEvent.refusal ?? null;
        break;
      case "limit":
      case "error":
        resumedTurn.failure = {
          code: chatEvent.code,
          message: chatEvent.message,
        };
        break;
      default:
        break;
    }
  }

  return applySessionOutcome(NextResponse.json(resumedTurn), outcome);
}
