import { z } from "zod";

// Raw backend shapes (`app/ziza_chat/schemas.py`); the mapper converts to camelCase.

export const ZizaChatRequestSchema = z.object({
  session_id: z.string().min(1),
  message: z.string().min(1).max(4000),
});

export const ZizaOfferedLinkSchema = z.object({
  url: z.string(),
  text: z.string(),
});

export const ZizaPendingCallSchema = z.object({
  tool_call_id: z.string(),
  tool_name: z.string(),
  kind: z.enum(["approval", "call"]),
  details: z
    .object({
      action: z.string().optional(),
      summary: z.string().optional(),
      severity: z.enum(["destructive", "warning", "info"]).optional(),
      // `clear_knowledge_base`
      documents: z.array(z.string()).optional(),
      // `add_url_to_knowledge_base`
      url: z.string().optional(),
      page_title: z.string().nullable().optional(),
      links: z.array(ZizaOfferedLinkSchema).optional(),
      slots_left: z.number().optional(),
    })
    .loose()
    .default({}),
});

export const ZizaSuggestionSchema = z
  .object({
    kind: z.string(),
    label: z.string(),
    message: z.string(),
    // Nullish, not optional: the backend sends an explicit `"url": null`, and
    // `.optional()` rejects null — which failed the whole response, not just
    // this field.
    url: z.string().nullish(),
    category: z.string().nullish(),
  })
  .loose();

export const ZizaChatResponseSchema = z.object({
  session_id: z.string(),
  response: z.string(),
  intent: z.string(),
  pending_calls: z.array(ZizaPendingCallSchema).default([]),
  suggestions: z.array(ZizaSuggestionSchema).default([]),
});

export const KnowledgeIngestResponseSchema = z.object({
  session_id: z.string(),
  source: z.string(),
  chunks_ingested: z.number(),
  // False only when the vector index hadn't caught up within the ingest
  // timeout — the chunks are stored and become searchable shortly after.
  searchable: z.boolean(),
  images_described: z.number().default(0),
  images_failed: z.number().default(0),
  documents_used: z.number().default(0),
  documents_allowed: z.number().default(0),
  pages_summarised: z.number().default(0),
  // This response arriving IS the signal that they are ready — no second async
  // step, which is why it is a second or two slower. Often empty.
  suggestions: z.array(ZizaSuggestionSchema).default([]),
});

// Recovery read, for the two cases the ingest response cannot cover: a reload
// before the visitor asked anything, or an upload whose request died after the
// work completed. Only ever the most recently added document.
export const KnowledgeSuggestionsResponseSchema = z.object({
  session_id: z.string(),
  document: z.string().nullable(),
  suggestions: z.array(ZizaSuggestionSchema).default([]),
});

export const KnowledgeClearResponseSchema = z.object({
  session_id: z.string(),
  chunks_deleted: z.number(),
});

// --- SSE stream envelope -----------------------------------------------------
//
// The `chat.*` names are live. The bare ones (`intent`, `tool_call`,
// `chunk_retrieved`, `error`) have never been emitted — kept so the inspector
// works the day they are, with no frontend change.

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

export const ZizaApprovalRequiredEventSchema = z.object({
  type: z.literal("chat.approval_required"),
  pending_call: ZizaPendingCallSchema,
});

export const ZizaInputRequiredEventSchema = z.object({
  type: z.literal("chat.input_required"),
  pending_call: ZizaPendingCallSchema,
});

export const ZizaSuggestionsEventSchema = z.object({
  type: z.literal("chat.suggestions"),
  suggestions: z.array(ZizaSuggestionSchema),
});

export const ZizaAgentEventSchema = z.discriminatedUnion("type", [
  ZizaIntentEventSchema,
  ZizaToolCallEventSchema,
  ZizaChunkRetrievedEventSchema,
  ZizaErrorEventSchema,
  ZizaApprovalRequiredEventSchema,
  ZizaInputRequiredEventSchema,
  ZizaSuggestionsEventSchema,
]);

export type ZizaAgentEvent = z.infer<typeof ZizaAgentEventSchema>;
