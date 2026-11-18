// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_COOKIE_NAME,
  SESSION_RENEWED_HEADER,
  applySessionOutcome,
  callZizaWithSession,
  readVisitorAddress,
  type ZizaUpstreamConfig,
} from "./ziza.upstream";

const CONFIG: ZizaUpstreamConfig = {
  baseUrl: "http://ziza.test",
  serverSecret: "zps_test_secret",
  clientIpHeader: "x-real-ip",
};

const SESSION_CREATED = {
  session_id: "ses_new",
  token: "tok_new",
  expires_at: "2026-11-13T10:00:00Z",
};

const SESSION_NOT_FOUND = {
  error: "session_not_found",
  message: "Unknown session",
  status_code: 404,
  details: { code: "session_not_found", message: "Unknown session" },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function incomingRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://demo.test/bff/ziza/sessions/sources", {
    headers,
  });
}

const SOURCES_CALL = {
  label: "GET sessions/sources",
  appRelativePath: "sessions/sources",
  buildRequestInit: (headers: Record<string, string>) => ({
    method: "GET",
    headers,
  }),
};

type RecordedCall = { url: string; headers: Record<string, string> };

let recordedCalls: RecordedCall[];

function stubZiza(...responses: Response[]) {
  recordedCalls = [];
  const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
    recordedCalls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const next = responses.shift();
    if (!next) {
      throw new Error(`unexpected call to ${url}`);
    }
    return next;
  });
  vi.stubGlobal("fetch", fetchStub);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("calling ziza for a session", () => {
  it("sends the secret, the visitor and the token from the cookie", async () => {
    stubZiza(jsonResponse({ items: [], total: 0, limit: 50, skip: 0 }));
    const outcome = await callZizaWithSession(
      incomingRequest({ cookie: `${SESSION_COOKIE_NAME}=tok_old` }),
      CONFIG,
      "203.0.113.7",
      SOURCES_CALL,
    );
    expect("upstream" in outcome && outcome.upstream.status).toBe(200);
    expect(recordedCalls).toEqual([
      {
        url: "http://ziza.test/api/app/sessions/sources",
        headers: {
          Authorization: "Bearer zps_test_secret",
          "X-Client-IP": "203.0.113.7",
          "X-Session-Token": "tok_old",
        },
      },
    ]);
  });

  it("starts a session first when the visitor has none", async () => {
    stubZiza(
      jsonResponse(SESSION_CREATED, 201),
      jsonResponse({ items: [], total: 0, limit: 50, skip: 0 }),
    );
    const outcome = await callZizaWithSession(
      incomingRequest(),
      CONFIG,
      "203.0.113.7",
      SOURCES_CALL,
    );
    expect(recordedCalls[0].url).toBe("http://ziza.test/api/app/sessions");
    expect(recordedCalls[0].headers["X-Session-Token"]).toBeUndefined();
    expect(recordedCalls[1].headers["X-Session-Token"]).toBe("tok_new");
    expect(outcome).toMatchObject({ isSessionRenewed: false });
    expect("startedSession" in outcome && outcome.startedSession).toEqual({
      token: "tok_new",
      expiresAt: "2026-11-13T10:00:00Z",
    });
  });

  it("replaces a session ziza no longer knows and retries once", async () => {
    stubZiza(
      jsonResponse(SESSION_NOT_FOUND, 404),
      jsonResponse(SESSION_CREATED, 201),
      jsonResponse({ items: [], total: 0, limit: 50, skip: 0 }),
    );
    const outcome = await callZizaWithSession(
      incomingRequest({ cookie: `${SESSION_COOKIE_NAME}=tok_old` }),
      CONFIG,
      "203.0.113.7",
      SOURCES_CALL,
    );
    expect(
      recordedCalls.map((call) => call.headers["X-Session-Token"]),
    ).toEqual(["tok_old", undefined, "tok_new"]);
    expect(outcome).toMatchObject({ isSessionRenewed: true });
  });

  it("does not retry a second time", async () => {
    stubZiza(
      jsonResponse(SESSION_NOT_FOUND, 404),
      jsonResponse(SESSION_CREATED, 201),
      jsonResponse(SESSION_NOT_FOUND, 404),
    );
    const outcome = await callZizaWithSession(
      incomingRequest({ cookie: `${SESSION_COOKIE_NAME}=tok_old` }),
      CONFIG,
      "203.0.113.7",
      SOURCES_CALL,
    );
    expect(recordedCalls).toHaveLength(3);
    expect("upstream" in outcome && outcome.upstream.status).toBe(404);
  });

  // Any other 404 (an unknown job, say) is the answer, not a lost session.
  it("leaves other 404s alone", async () => {
    stubZiza(
      jsonResponse(
        { details: { code: "job_not_found", message: "No such job" } },
        404,
      ),
    );
    await callZizaWithSession(
      incomingRequest({ cookie: `${SESSION_COOKIE_NAME}=tok_old` }),
      CONFIG,
      "203.0.113.7",
      SOURCES_CALL,
    );
    expect(recordedCalls).toHaveLength(1);
  });

  it("hands a session-start refusal straight back", async () => {
    stubZiza(
      jsonResponse(
        {
          error: "rate_limited",
          message: "Too many sessions",
          status_code: 429,
          details: { code: "rate_limited", retry_after_seconds: 60 },
        },
        429,
      ),
    );
    const outcome = await callZizaWithSession(
      incomingRequest(),
      CONFIG,
      "203.0.113.7",
      SOURCES_CALL,
    );
    expect("failureResponse" in outcome && outcome.failureResponse.status).toBe(
      429,
    );
  });

  it("answers 503 when ziza cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const outcome = await callZizaWithSession(
      incomingRequest({ cookie: `${SESSION_COOKIE_NAME}=tok_old` }),
      CONFIG,
      "203.0.113.7",
      SOURCES_CALL,
    );
    expect("failureResponse" in outcome && outcome.failureResponse.status).toBe(
      503,
    );
  });
});

describe("the session cookie", () => {
  it("is httpOnly, Secure, Lax, scoped to the BFF and expires with ziza's session", () => {
    const response = applySessionOutcome(NextResponse.json({}), {
      startedSession: { token: "tok_new", expiresAt: "2026-11-13T10:00:00Z" },
      isSessionRenewed: true,
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=tok_new`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toContain("Path=/bff/ziza");
    expect(setCookie).toContain("Expires=Fri, 13 Nov 2026 10:00:00 GMT");
    expect(response.headers.get(SESSION_RENEWED_HEADER)).toBe("1");
  });

  it("is left alone when no session was started", () => {
    const response = applySessionOutcome(NextResponse.json({}), {
      isSessionRenewed: false,
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("the visitor's address", () => {
  it("comes from the header the proxy writes", () => {
    expect(
      readVisitorAddress(
        incomingRequest({ "x-real-ip": "198.51.100.4" }),
        CONFIG,
      ),
    ).toBe("198.51.100.4");
  });

  // Everything left of the last hop is whatever the browser sent.
  it("takes only the hop the proxy appended from x-forwarded-for", () => {
    expect(
      readVisitorAddress(
        incomingRequest({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }),
        { ...CONFIG, clientIpHeader: "x-forwarded-for" },
      ),
    ).toBe("198.51.100.4");
  });

  it("ignores a header other than the configured one", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      readVisitorAddress(
        incomingRequest({ "x-forwarded-for": "6.6.6.6" }),
        CONFIG,
      ),
    ).toBeNull();
    vi.unstubAllEnvs();
  });

  it("falls back to loopback only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(readVisitorAddress(incomingRequest(), CONFIG)).toBe("127.0.0.1");
    vi.unstubAllEnvs();
  });
});
