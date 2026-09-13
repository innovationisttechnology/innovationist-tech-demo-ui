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

// One tool call the run stopped on. `kind` says what it is waiting for:
// `approval` is a yes/no gate that re-runs the tool body, `call` is deferred
// for external execution — the result supplied from outside becomes the tool's
// return value, so there is nothing to approve.
//
// `details` is whatever the tool passed to `ApprovalRequired`/`CallDeferred`
// in `app/ziza_chat/tools/knowledge.py`, so it stays loose: the typed keys are
// what today's two tools supply, and the next one must still validate.
export const ZizaPendingCallSchema = z.object({
  tool_call_id: z.string(),
  tool_name: z.string(),
  kind: z.enum(["approval", "call"]),
  details: z
    .object({
      action: z.string().optional(),
      summary: z.string().optional(),
      // Not sent yet. Honoured when it is, so the backend can decide how loud
      // a gate should be instead of the UI guessing from the tool name.
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

// An offer to try something else, sent when retrieval came back empty — the
// scope gate refused, or the agent searched and found nothing. `label` is the
// chip text; `message` is what gets sent as an ordinary chat message.
//
// `kind` is a backend enum with one member today but more are coming, so it is
// an open string rather than a literal union: an unrecognised kind must still
// parse, and falls back to sending `message`.
export const ZizaSuggestionSchema = z
  .object({
    kind: z.string(),
    label: z.string(),
    message: z.string(),
    // Nullish, not optional: the backend sends an explicit `"url": null` on
    // kinds that have no page behind them, and a bare `.optional()` rejects
    // null — which failed the whole response, not just this field.
    url: z.string().nullish(),
    // A short topic ("Scope", "Stack"), rendered as the card's coloured label.
    // Not sent yet; the card simply omits the line without it.
    category: z.string().nullish(),
  })
  .loose();

export const ZizaChatResponseSchema = z.object({
  session_id: z.string(),
  response: z.string(),
  intent: z.string(),
  // Everything still unanswered. A run resumes only once this is empty, so
  // resolving one call can come back with the others still listed.
  pending_calls: z.array(ZizaPendingCallSchema).default([]),
  // Only ever populated on `/chat` and `/chat/stream`; the resolution
  // endpoints carry the field but never fill it.
  suggestions: z.array(ZizaSuggestionSchema).default([]),
});

export const KnowledgeIngestResponseSchema = z.object({
  session_id: z.string(),
  source: z.string(),
  chunks_ingested: z.number(),
  // False only when the vector index hadn't caught up within the ingest
  // timeout — the chunks are stored and become searchable shortly after.
  searchable: z.boolean(),
  // Defaulted rather than required: a document with no images omits them.
  images_described: z.number().default(0),
  images_failed: z.number().default(0),
  // Session capacity: documents held against the per-session cap.
  documents_used: z.number().default(0),
  documents_allowed: z.number().default(0),
  // 0 or 1 — set when a page-level overview is indexed alongside a page's own
  // chunked text. File uploads leave it at 0.
  pages_summarised: z.number().default(0),
  // Starter questions answerable from the document just ingested. The response
  // arriving IS the signal that they are ready — there is no second async step
  // to wait on, which is also why this response is now a second or two slower.
  //
  // Often empty, and that is a real answer: a login wall or an error page holds
  // nothing specific enough to ask about. Defaulted so an older backend still
  // parses.
  suggestions: z.array(ZizaSuggestionSchema).default([]),
});

// The recovery read for starter questions, covering the two cases the ingest
// response cannot: the visitor reloads before asking anything, or the upload
// request dies after the work completed. Only ever the most recently added
// document — three uploads give three questions, not nine.
export const KnowledgeSuggestionsResponseSchema = z.object({
  session_id: z.string(),
  // Null when the session holds nothing yet.
  document: z.string().nullable(),
  suggestions: z.array(ZizaSuggestionSchema).default([]),
});

export const KnowledgeClearResponseSchema = z.object({
  session_id: z.string(),
  chunks_deleted: z.number(),
});

// --- SSE stream envelope -----------------------------------------------------
//
// Two shapes arrive on the wire. `{"chunk": "..."}` is a text delta (the
// backend tags it `chat.chunk`, but the route matches on the key). The
// `type`-tagged variants are everything else.
//
// `chat.*` names below are live. The bare names (`intent`, `tool_call`,
// `chunk_retrieved`, `error`) are the older agreed contract and have never
// been emitted — they are kept so the inspector lights up the day they are,
// without a frontend change.

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

// The two tagged frames the backend actually emits, one per unanswered call:
// `chat.approval_required` for a gate, `chat.input_required` for a deferred
// call needing a result. Note the naming split — stream event types are
// namespaced `chat.*` server-side (`ChatStreamEvent.type` in
// `app/ziza_chat/schemas.py`) while the Phase 2 variants above use bare names.
// Both are accepted until the backend settles on one.
export const ZizaApprovalRequiredEventSchema = z.object({
  type: z.literal("chat.approval_required"),
  pending_call: ZizaPendingCallSchema,
});

export const ZizaInputRequiredEventSchema = z.object({
  type: z.literal("chat.input_required"),
  pending_call: ZizaPendingCallSchema,
});

// Sent instead of an answer when there was nothing to answer from.
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
