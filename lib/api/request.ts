import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { type z } from "zod";

import { type ApiResponse, type RequestOptions } from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// Single choke-point for API calls: owns base URL, headers, the session
// header, and zod validation. Never throws — on network/non-2xx/schema failure
// it returns `ok: false` with `data` undefined, so callers branch on `ok`.
export async function request<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  options: RequestOptions = {},
): Promise<ApiResponse<z.infer<TSchema>>> {
  const { sessionId, headers, ...axiosOptions } = options;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  const config: AxiosRequestConfig = {
    method: "GET",
    ...axiosOptions,
    url: `${API_BASE_URL}/api${normalizedPath}`,
    headers: {
      "Content-Type": "application/json",
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

  if (!ok || response.data == null) {
    return {
      data: undefined as z.infer<TSchema>,
      errorData: response.data,
      status: response.status,
      ok,
    };
  }

  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    return {
      data: undefined as z.infer<TSchema>,
      errorData: parsed.error,
      status: response.status,
      ok: false,
    };
  }

  return { data: parsed.data, status: response.status, ok };
}
