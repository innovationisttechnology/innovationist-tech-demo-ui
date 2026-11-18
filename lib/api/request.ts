import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { type z } from "zod";

import { type ApiResponse, type RequestOptions } from "./types";

const DEMO_API_BASE_URL = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/api`;

// Single choke-point for API calls: owns base URL, headers, the session
// header, and zod validation. Never throws — on network/non-2xx/schema failure
// it returns `ok: false` with `data` undefined, so callers branch on `ok`.
export async function request<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  options: RequestOptions = {},
): Promise<ApiResponse<z.infer<TSchema>>> {
  const {
    sessionId,
    headers,
    baseUrl = DEMO_API_BASE_URL,
    ...axiosOptions
  } = options;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  // Multipart uploads must not carry a caller-set Content-Type: the browser
  // has to write it itself so the boundary token matches the body it encodes.
  const isMultipart =
    typeof FormData !== "undefined" && axiosOptions.data instanceof FormData;

  const config: AxiosRequestConfig = {
    method: "GET",
    ...axiosOptions,
    url: `${baseUrl}${normalizedPath}`,
    headers: {
      ...(isMultipart ? {} : { "Content-Type": "application/json" }),
      ...(sessionId ? { "X-Session-Id": sessionId } : {}),
      ...headers,
    },
    validateStatus: () => true,
  };

  let response: AxiosResponse;
  try {
    response = await axios(config);
  } catch {
    return { data: undefined as z.infer<TSchema>, status: 503, ok: false };
  }

  const ok = response.status >= 200 && response.status < 300;
  const responseHeaders = Object.fromEntries(
    Object.entries(response.headers ?? {}).map(([headerName, headerValue]) => [
      headerName.toLowerCase(),
      String(headerValue),
    ]),
  );

  if (!ok || response.data == null) {
    return {
      data: undefined as z.infer<TSchema>,
      errorData: response.data,
      status: response.status,
      headers: responseHeaders,
      ok,
    };
  }

  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    return {
      data: undefined as z.infer<TSchema>,
      errorData: parsed.error,
      status: response.status,
      headers: responseHeaders,
      ok: false,
    };
  }

  return {
    data: parsed.data,
    status: response.status,
    headers: responseHeaders,
    ok,
  };
}
