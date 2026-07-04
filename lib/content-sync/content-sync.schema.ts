import { z } from "zod";

import { ApiDateTime } from "@/lib/zod/primitives";

// Raw backend shape (`SyncFlagRead`); the mapper converts it to camelCase.
export const SyncFlagSchema = z.object({
  session_id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  created_at: ApiDateTime,
  updated_at: ApiDateTime,
});

export const SyncFlagListSchema = z.array(SyncFlagSchema);

// Sent once on connect: the full current state.
export const SyncSnapshotEventSchema = z.object({
  type: z.literal("flag.snapshot"),
  flags: z.array(SyncFlagSchema),
});

// Sent on each mutation; `flag` is absent for deletions.
export const SyncMutationEventSchema = z.object({
  type: z.enum(["flag.created", "flag.updated", "flag.deleted"]),
  key: z.string(),
  flag: SyncFlagSchema.optional(),
});

export const SyncEventSchema = z.discriminatedUnion("type", [
  SyncSnapshotEventSchema,
  SyncMutationEventSchema,
]);

export type SyncEvent = z.infer<typeof SyncEventSchema>;
