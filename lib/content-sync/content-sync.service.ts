import { request } from "@/lib/api/request";

import { toSyncFlag } from "./content-sync.mapper";
import { SyncFlagListSchema, SyncFlagSchema } from "./content-sync.schema";
import {
  type CreateFlagInput,
  type SyncFlag,
  type UpdateFlagInput,
} from "./content-sync.types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// Resource module for `/api/flags`: every function calls `request()` with a
// schema and hands back domain (`SyncFlag`) objects.

export const fetchFlags = async (sessionId: string): Promise<SyncFlag[]> => {
  const { data, ok } = await request("/flags", SyncFlagListSchema, {
    sessionId,
  });
  if (!ok || !data) {
    return [];
  }
  return data.map(toSyncFlag);
};

// Returns null on conflict (409) or failure.
export const createFlag = async (
  sessionId: string,
  input: CreateFlagInput,
): Promise<SyncFlag | null> => {
  const { data, ok } = await request("/flags", SyncFlagSchema, {
    sessionId,
    method: "POST",
    data: input,
  });
  return ok && data ? toSyncFlag(data) : null;
};

export const updateFlag = async (
  sessionId: string,
  key: string,
  input: UpdateFlagInput,
): Promise<SyncFlag | null> => {
  const { data, ok } = await request(
    `/flags/${encodeURIComponent(key)}`,
    SyncFlagSchema,
    {
      sessionId,
      method: "PUT",
      data: input,
    },
  );
  return ok && data ? toSyncFlag(data) : null;
};

export const deleteFlag = async (
  sessionId: string,
  key: string,
): Promise<boolean> => {
  const { ok } = await request(
    `/flags/${encodeURIComponent(key)}`,
    SyncFlagSchema,
    {
      sessionId,
      method: "DELETE",
    },
  );
  return ok;
};

// SSE stream URL. `EventSource` can't set headers, so the session goes as a
// query param here rather than the `X-Session-Id` header used elsewhere.
export const flagsStreamUrl = (sessionId: string): string =>
  `${API_BASE_URL}/api/flags/stream?session_id=${encodeURIComponent(sessionId)}`;
