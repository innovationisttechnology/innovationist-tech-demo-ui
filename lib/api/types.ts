import { type AxiosRequestConfig } from "axios";

export type ApiResponse<TData> = {
  data: TData;
  status: number;
  ok: boolean;
  errorData?: unknown;
};

// `sessionId` is lifted out and sent as the `X-Session-Id` header.
export type RequestOptions = Omit<AxiosRequestConfig, "url" | "headers"> & {
  sessionId?: string;
  headers?: Record<string, string>;
};
