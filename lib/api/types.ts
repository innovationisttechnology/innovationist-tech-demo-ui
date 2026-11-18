import { type AxiosRequestConfig } from "axios";

export type ApiResponse<TData> = {
  data: TData;
  status: number;
  ok: boolean;
  errorData?: unknown;
  // Lower-cased names; absent when the request never got a response.
  headers?: Record<string, string>;
};

// `sessionId` is lifted out and sent as the `X-Session-Id` header.
// `baseUrl` defaults to the demo API; ziza calls point it at the BFF instead.
export type RequestOptions = Omit<
  AxiosRequestConfig,
  "url" | "headers" | "baseURL"
> & {
  sessionId?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
};
