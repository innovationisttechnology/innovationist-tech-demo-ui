import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  endZizaSessionIfPresent,
  readSessionToken,
  resolveZizaRequestContext,
  startZizaSession,
  storeSessionCookie,
} from "@/lib/ziza/ziza.upstream";

// Called once when the demo mounts, before anything reads the session, so the
// parallel cold reads that follow share one session instead of each starting
// their own. The cookie's expiry matches ziza's, so a present cookie is
// trusted; a session ziza ended early is replaced on first use.
export async function POST(incomingRequest: NextRequest) {
  if (readSessionToken(incomingRequest)) {
    return NextResponse.json({ is_new_session: false });
  }

  const context = resolveZizaRequestContext(incomingRequest);
  if (context instanceof NextResponse) {
    return context;
  }

  const started = await startZizaSession(
    context.config,
    context.visitorAddress,
    incomingRequest.signal,
  );
  if ("failureResponse" in started) {
    return started.failureResponse;
  }

  const response = NextResponse.json({ is_new_session: true }, { status: 201 });
  storeSessionCookie(response, started.session);
  return response;
}

// The clear button: ziza deletes the session's documents, conversation and
// images in one go, then a fresh session takes its place. A failed delete
// starts nothing, so the visitor is never told data is gone while it is not.
export async function DELETE(incomingRequest: NextRequest) {
  const context = resolveZizaRequestContext(incomingRequest);
  if (context instanceof NextResponse) {
    return context;
  }

  const endFailure = await endZizaSessionIfPresent(
    context.config,
    context.visitorAddress,
    readSessionToken(incomingRequest),
  );
  if (endFailure) {
    return endFailure;
  }

  const started = await startZizaSession(
    context.config,
    context.visitorAddress,
    incomingRequest.signal,
  );
  if ("failureResponse" in started) {
    // The old session is already gone, so its token must not linger.
    started.failureResponse.cookies.delete({
      name: SESSION_COOKIE_NAME,
      path: SESSION_COOKIE_PATH,
    });
    return started.failureResponse;
  }

  const response = NextResponse.json({ is_new_session: true }, { status: 201 });
  storeSessionCookie(response, started.session);
  return response;
}
