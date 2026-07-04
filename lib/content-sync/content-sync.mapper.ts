import { type z } from "zod";

import { type SyncFlagSchema } from "./content-sync.schema";
import { type SyncFlag } from "./content-sync.types";

export const toSyncFlag = (
  apiFlag: z.infer<typeof SyncFlagSchema>,
): SyncFlag => ({
  sessionId: apiFlag.session_id,
  key: apiFlag.key,
  value: apiFlag.value,
  enabled: apiFlag.enabled,
  createdAt: apiFlag.created_at,
  updatedAt: apiFlag.updated_at,
});
