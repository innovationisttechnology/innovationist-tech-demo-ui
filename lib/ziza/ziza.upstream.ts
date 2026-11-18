import { NextResponse, type NextRequest } from "next/server";

import { ZizaErrorBodySchema, ZizaSessionCreatedSchema } from "./ziza.schema";

// Server-only. The server secret and the session token never reach the
// browser and are never logged: the token lives in an httpOnly cookie that
// only the BFF reads, and is sent upstream as `X-Session-Token`. Config is
// read at request time, so none of it is NEXT_PUBLIC_.

const ZIZA_APP_API_PATH = "/api/app";
const DEFAULT_CLIENT_IP_HEADER = "x-real-ip";
const DEVELOPMENT_CLIENT_IP = "127.0.0.1";
const SESSION_NOT_FOUND_CODE = "session_not_found";

export const REQUEST_ID_HEADER = "x-request-id";
export const SESSION_COOKIE_NAME = "ziza_session";
export const SESSION_COOKIE_PATH = "/bff/ziza";
// Tells the browser its documents and conversation are gone: the BFF had to
// start a new session part-way through.
export const SESSION_RENEWED_HEADER = "x-ziza-session-renewed";

const LOG_PREFIX = "[ziza bff]";

export type ZizaUpstreamConfig = {
  baseUrl: string;
  serverSecret: string;
  clientIpHeader: string;
};

export type ZizaSession = {
  token: string;
  expiresAt: string;
};

export function readZizaUpstreamConfig(): ZizaUpstreamConfig | null {
  const baseUrl = process.env.ZIZA_API_URL;
  const serverSecret = process.env.ZIZA_DEMO_SERVER_SECRET;
  if (!baseUrl || !serverSecret) {
    return null;
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    serverSecret,
    clientIpHeader: (
      process.env.ZIZA_CLIENT_IP_HEADER ?? DEFAULT_CLIENT_IP_HEADER
    ).toLowerCase(),
  };
}

// Same shape as ziza's own errors, so the browser has one shape to read.
export function bffErrorResponse(
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    {
      error: code,
      message,
      status_code: status,
      details: { code, message },
    },
    { status },
  );
}

export function missingZizaConfigResponse(): NextResponse {
  console.error(
    LOG_PREFIX,
    "ZIZA_API_URL and ZIZA_DEMO_SERVER_SECRET must both be set on the UI server",
  );
  return bffErrorResponse(
    503,
    "bff_not_configured",
    "The demo server is not configured to reach ziza.",
  );
}

// The address must come from the header the trusted proxy writes, never one
// the browser controls. For `x-forwarded-for` that is the rightmost entry: the
// one the proxy appended. Everything to its left is whatever the client sent.
export function readVisitorAddress(
  incomingRequest: NextRequest,
  config: ZizaUpstreamConfig,
): string | null {
  const headerValue = incomingRequest.headers.get(config.clientIpHeader);
  const visitorAddress =
    config.clientIpHeader === "x-forwarded-for"
      ? headerValue?.split(",").at(-1)?.trim()
      : headerValue?.trim();
  if (visitorAddress) {
    return visitorAddress;
  }
  return process.env.NODE_ENV === "development" ? DEVELOPMENT_CLIENT_IP : null;
}

export function missingVisitorAddressResponse(
  config: ZizaUpstreamConfig,
): NextResponse {
  console.error(
    `${LOG_PREFIX} no visitor address in the ${config.clientIpHeader} header; set ZIZA_CLIENT_IP_HEADER to the header the proxy writes`,
  );
  return bffErrorResponse(
    500,
    "missing_client_ip",
    "The demo server could not tell who is asking.",
  );
}

export const zizaAppUrl = (
  config: ZizaUpstreamConfig,
  appRelativePath: string,
): string => `${config.baseUrl}${ZIZA_APP_API_PATH}/${appRelativePath}`;

function zizaRequestHeaders(
  config: ZizaUpstreamConfig,
  visitorAddress: string,
  sessionToken?: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${config.serverSecret}`,
    "X-Client-IP": visitorAddress,
    ...(sessionToken ? { "X-Session-Token": sessionToken } : {}),
  };
}

export async function readZizaErrorCode(
  upstream: Response,
): Promise<string | undefined> {
  const body = await upstream
    .clone()
    .json()
    .catch(() => null);
  const parsed = ZizaErrorBodySchema.safeParse(body);
  return parsed.success ? parsed.data.details.code : undefined;
}

function logUpstreamFailure(label: string, upstream: Response, code?: string) {
  console.warn(
    `${LOG_PREFIX} ${label} -> ${upstream.status}${code ? ` ${code}` : ""} (request id ${upstream.headers.get(REQUEST_ID_HEADER) ?? "none"})`,
  );
}

function unreachableResponse(
  config: ZizaUpstreamConfig,
  label: string,
  failure: unknown,
): NextResponse {
  console.error(
    `${LOG_PREFIX} ${label}: could not reach ziza at ${config.baseUrl}`,
    failure,
  );
  return bffErrorResponse(
    503,
    "upstream_unreachable",
    "Could not reach the ziza API.",
  );
}

// An upstream error is handed to the browser as it came: ziza's error body is
// already the shape the browser reads.
export async function passThroughUpstreamError(
  upstream: Response,
): Promise<NextResponse> {
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

type SessionStartOutcome =
  { session: ZizaSession } | { failureResponse: NextResponse };

export async function startZizaSession(
  config: ZizaUpstreamConfig,
  visitorAddress: string,
  signal?: AbortSignal,
): Promise<SessionStartOutcome> {
  let upstream: Response;
  try {
    upstream = await fetch(zizaAppUrl(config, "sessions"), {
      method: "POST",
      headers: zizaRequestHeaders(config, visitorAddress),
      signal,
    });
  } catch (failure) {
    return {
      failureResponse: unreachableResponse(config, "POST sessions", failure),
    };
  }

  if (!upstream.ok) {
    logUpstreamFailure(
      "POST sessions",
      upstream,
      await readZizaErrorCode(upstream),
    );
    return { failureResponse: await passThroughUpstreamError(upstream) };
  }

  const parsed = ZizaSessionCreatedSchema.safeParse(
    await upstream.json().catch(() => null),
  );
  if (!parsed.success) {
    console.error(`${LOG_PREFIX} POST sessions answered an unreadable body`);
    return {
      failureResponse: bffErrorResponse(
        502,
        "upstream_unreadable",
        "ziza started a session but its reply could not be read.",
      ),
    };
  }
  return {
    session: { token: parsed.data.token, expiresAt: parsed.data.expires_at },
  };
}

export async function endZizaSessionIfPresent(
  config: ZizaUpstreamConfig,
  visitorAddress: string,
  sessionToken: string | undefined,
): Promise<NextResponse | null> {
  if (!sessionToken) {
    return null;
  }
  let upstream: Response;
  try {
    upstream = await fetch(zizaAppUrl(config, "sessions/current"), {
      method: "DELETE",
      headers: zizaRequestHeaders(config, visitorAddress, sessionToken),
    });
  } catch (failure) {
    return unreachableResponse(config, "DELETE sessions/current", failure);
  }
  if (upstream.ok) {
    return null;
  }
  const code = await readZizaErrorCode(upstream);
  // Already ended or expired: that is the outcome being asked for.
  if (upstream.status === 404 && code === SESSION_NOT_FOUND_CODE) {
    return null;
  }
  logUpstreamFailure("DELETE sessions/current", upstream, code);
  return passThroughUpstreamError(upstream);
}

export function readSessionToken(
  incomingRequest: NextRequest,
): string | undefined {
  return incomingRequest.cookies.get(SESSION_COOKIE_NAME)?.value;
}

export function storeSessionCookie(
  response: NextResponse,
  session: ZizaSession,
): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: SESSION_COOKIE_PATH,
    expires: new Date(session.expiresAt),
  });
}

export type ZizaSessionCall = {
  label: string;
  appRelativePath: string;
  // Called once per attempt, so the body must be one that can be sent twice
  // (a string or buffer, not the incoming stream).
  buildRequestInit: (headers: Record<string, string>) => RequestInit;
};

export type ZizaSessionCallOutcome =
  | {
      upstream: Response;
      // Set when this call started a session; the caller must store it.
      startedSession?: ZizaSession;
      // Set when an existing session had gone and was replaced.
      isSessionRenewed: boolean;
    }
  | { failureResponse: NextResponse };

// Starts a session when the visitor has none. When ziza no longer knows the
// token (ended or expired), starts a new one and retries exactly once.
export async function callZizaWithSession(
  incomingRequest: NextRequest,
  config: ZizaUpstreamConfig,
  visitorAddress: string,
  call: ZizaSessionCall,
): Promise<ZizaSessionCallOutcome> {
  let startedSession: ZizaSession | undefined;
  let sessionToken = readSessionToken(incomingRequest);

  if (!sessionToken) {
    const started = await startZizaSession(
      config,
      visitorAddress,
      incomingRequest.signal,
    );
    if ("failureResponse" in started) {
      return started;
    }
    startedSession = started.session;
    sessionToken = started.session.token;
  }

  const send = (token: string) =>
    fetch(
      zizaAppUrl(config, call.appRelativePath),
      call.buildRequestInit(zizaRequestHeaders(config, visitorAddress, token)),
    );

  let upstream: Response;
  try {
    upstream = await send(sessionToken);
  } catch (failure) {
    return {
      failureResponse: unreachableResponse(config, call.label, failure),
    };
  }

  const isUnknownSession =
    upstream.status === 404 &&
    (await readZizaErrorCode(upstream)) === SESSION_NOT_FOUND_CODE;

  if (!isUnknownSession || startedSession) {
    if (!upstream.ok) {
      logUpstreamFailure(
        call.label,
        upstream,
        await readZizaErrorCode(upstream),
      );
    }
    return { upstream, startedSession, isSessionRenewed: false };
  }

  console.info(`${LOG_PREFIX} ${call.label}: session gone, starting a new one`);
  const restarted = await startZizaSession(
    config,
    visitorAddress,
    incomingRequest.signal,
  );
  if ("failureResponse" in restarted) {
    return restarted;
  }

  try {
    upstream = await send(restarted.session.token);
  } catch (failure) {
    return {
      failureResponse: unreachableResponse(config, call.label, failure),
    };
  }
  if (!upstream.ok) {
    logUpstreamFailure(call.label, upstream, await readZizaErrorCode(upstream));
  }
  return {
    upstream,
    startedSession: restarted.session,
    isSessionRenewed: true,
  };
}

export function applySessionOutcome(
  response: NextResponse,
  outcome: { startedSession?: ZizaSession; isSessionRenewed: boolean },
): NextResponse {
  if (outcome.startedSession) {
    storeSessionCookie(response, outcome.startedSession);
  }
  if (outcome.isSessionRenewed) {
    response.headers.set(SESSION_RENEWED_HEADER, "1");
  }
  return response;
}

export type ZizaRequestContext = {
  config: ZizaUpstreamConfig;
  visitorAddress: string;
};

export function resolveZizaRequestContext(
  incomingRequest: NextRequest,
): ZizaRequestContext | NextResponse {
  const config = readZizaUpstreamConfig();
  if (!config) {
    return missingZizaConfigResponse();
  }
  const visitorAddress = readVisitorAddress(incomingRequest, config);
  if (!visitorAddress) {
    return missingVisitorAddressResponse(config);
  }
  return { config, visitorAddress };
}
