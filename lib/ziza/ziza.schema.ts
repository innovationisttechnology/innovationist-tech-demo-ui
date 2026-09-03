import { z } from "zod";

// Raw backend shapes (`app/ziza_chat/schemas.py`); the mapper converts to camelCase.

export const ZizaChatRequestSchema = z.object({
  session_id: z.string().min(1),
  message: z.string().min(1).max(4000),
});

export const ZizaChatResponseSchema = z.object({
  session_id: z.string(),
  response: z.string(),
  intent: z.string(),
});

export const KnowledgeIngestResponseSchema = z.object({
  session_id: z.string(),
  source: z.string(),
  chunks_ingested: z.number(),
  // False only when the vector index hadn't caught up within the ingest
  // timeout — the chunks are stored and become searchable shortly after.
  searchable: z.boolean(),
  // Image fields only appear on file uploads. Defaulted so the JSON
  // paste-text endpoint, which omits them entirely, still validates.
  images_described: z.number().default(0),
  images_failed: z.number().default(0),
  // Total images found before `max_images_per_document` truncation. Anything
  // over that limit is dropped server-side with only a log line, so
  // `images_total - images_described - images_failed` is the silently
  // discarded count. Defaulted because the backend field is still landing.
  images_total: z.number().default(0),
  // 0 or 1 — a URL ingest adds one page-level overview section alongside the
  // page's own chunked text. Defaulted for the file and paste-text endpoints.
  pages_summarised: z.number().default(0),
});

export const KnowledgeClearResponseSchema = z.object({
  session_id: z.string(),
  chunks_deleted: z.number(),
});

// --- SSE stream envelope -----------------------------------------------------
//
// The backend currently emits only `{"chunk": "..."}` frames (see
// `app/ziza_chat/utils.py::format_sse`). The `type`-tagged variants below are the
// contract agreed in AI_CHATBOT_DEMO_PLAN.md Phase 2. Parsing both shapes now
// means Phase 5 is a backend-only change — no frontend rewrite.

export const ZizaTextFrameSchema = z.object({ chunk: z.string() });

export const ZizaIntentEventSchema = z.object({
  type: z.literal("intent"),
  intents: z.array(z.string()),
  needs_rag: z.boolean(),
  rag_query: z.string().nullable().optional(),
  rag_ambiguous: z.boolean().optional(),
});

export const ZizaToolCallEventSchema = z.object({
  type: z.literal("tool_call"),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});

export const ZizaChunkRetrievedEventSchema = z.object({
  type: z.literal("chunk_retrieved"),
  source: z.string(),
  score: z.number(),
  text: z.string(),
});

export const ZizaErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const ZizaAgentEventSchema = z.discriminatedUnion("type", [
  ZizaIntentEventSchema,
  ZizaToolCallEventSchema,
  ZizaChunkRetrievedEventSchema,
  ZizaErrorEventSchema,
]);

export type ZizaAgentEvent = z.infer<typeof ZizaAgentEventSchema>;
