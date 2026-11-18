import { NextResponse, type NextRequest } from "next/server";

import {
  REQUEST_ID_HEADER,
  applySessionOutcome,
  bffErrorResponse,
  callZizaWithSession,
  resolveZizaRequestContext,
} from "@/lib/ziza/ziza.upstream";

// Pass-through for every session-scoped ziza call that is not a chat turn
// (those have their own handlers in `../stream` and `../approvals`). The path
// after `/bff/ziza/` is the path after ziza's `/api/app/`, and bodies and
// status codes go through untouched.
//
// An allowlist rather than a blind catch-all: this handler holds the server
// secret, so it must not expose the rest of the app API.
const PROXIED_ROUTES: Record<string, readonly RegExp[]> = {
  GET: [
    /^chat\/history$/,
    /^sessions\/sources$/,
    /^sessions\/suggestions$/,
    /^sessions\/jobs\/[^/]+$/,
    /^sessions\/jobs\/[^/]+\/events$/,
  ],
  POST: [/^sessions\/files$/, /^sessions\/link-offers\/[^/]+$/],
  DELETE: [/^sessions\/sources\/[^/]+$/],
};

const FORWARDED_REQUEST_HEADERS = ["content-type", "accept"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", REQUEST_ID_HEADER];

type ZizaProxyContext = { params: Promise<{ path: string[] }> };

async function proxyToZiza(
  incomingRequest: NextRequest,
  { params }: ZizaProxyContext,
): Promise<Response> {
  const { path } = await params;
  const appRelativePath = path.map(encodeURIComponent).join("/");
  const method = incomingRequest.method;

  const isAllowed = (PROXIED_ROUTES[method] ?? []).some((route) =>
    route.test(appRelativePath),
  );
  if (!isAllowed) {
    return bffErrorResponse(404, "not_found", "Not found");
  }

  const context = resolveZizaRequestContext(incomingRequest);
  if (context instanceof NextResponse) {
    return context;
  }

  const forwardedHeaders: Record<string, string> = {};
  for (const headerName of FORWARDED_REQUEST_HEADERS) {
    const headerValue = incomingRequest.headers.get(headerName);
    if (headerValue) {
      forwardedHeaders[headerName] = headerValue;
    }
  }

  // Buffered, not streamed through: a session that expired mid-visit is
  // retried once with a new token, and a consumed stream cannot be resent.
  // Uploads are capped at 25 MiB, so this fits in memory.
  const requestBody =
    method === "POST" ? await incomingRequest.arrayBuffer() : undefined;

  const outcome = await callZizaWithSession(
    incomingRequest,
    context.config,
    context.visitorAddress,
    {
      label: `${method} ${appRelativePath}`,
      appRelativePath: `${appRelativePath}${incomingRequest.nextUrl.search}`,
      buildRequestInit: (zizaHeaders) => ({
        method,
        headers: { ...forwardedHeaders, ...zizaHeaders },
        body: requestBody,
        signal: incomingRequest.signal,
      }),
    },
  );
  if ("failureResponse" in outcome) {
    return outcome.failureResponse;
  }

  const responseHeaders = new Headers();
  for (const headerName of FORWARDED_RESPONSE_HEADERS) {
    const headerValue = outcome.upstream.headers.get(headerName);
    if (headerValue) {
      responseHeaders.set(headerName, headerValue);
    }
  }
  // Job progress is an SSE stream; any buffering proxy on the way would hold
  // every update until the job finished.
  if (responseHeaders.get("content-type")?.startsWith("text/event-stream")) {
    responseHeaders.set("Cache-Control", "no-cache, no-transform");
    responseHeaders.set("X-Accel-Buffering", "no");
  }

  return applySessionOutcome(
    new NextResponse(outcome.upstream.body, {
      status: outcome.upstream.status,
      headers: responseHeaders,
    }),
    outcome,
  );
}

export const GET = proxyToZiza;
export const POST = proxyToZiza;
export const DELETE = proxyToZiza;
