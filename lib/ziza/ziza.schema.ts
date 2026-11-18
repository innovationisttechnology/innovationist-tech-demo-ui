import { z } from "zod";

// Raw shapes of ziza-ai-api's `/api/app` routes; the mapper converts to
// camelCase. Objects are `.loose()` so a field ziza adds later never fails a
// whole response.

export const ZizaChatRequestSchema = z.object({
  message: z.string().min(1),
});

// Every ziza error, and every error the BFF itself raises, has this shape.
// Branch on `details.code`, never on `message`.
export const ZizaErrorBodySchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
    status_code: z.number().optional(),
    details: z
      .object({
        code: z.string(),
        message: z.string().optional(),
        retry_after_seconds: z.number().optional(),
      })
      .loose(),
  })
  .loose();

export type ZizaErrorBody = z.infer<typeof ZizaErrorBodySchema>;

export const ZizaSessionCreatedSchema = z.object({
  session_id: z.string(),
  token: z.string(),
  expires_at: z.string(),
});

export const ZizaSessionEnsuredSchema = z.object({
  is_new_session: z.boolean(),
});

export const ZizaCitationSchema = z
  .object({
    number: z.number(),
    record_id: z.string().nullish(),
    source_id: z.string().nullish(),
    source_ref: z.string().nullish(),
    locator: z.string().nullish(),
    score: z.number().nullish(),
    // Only on history: the source was removed after the answer cited it.
    removed: z.boolean().optional(),
  })
  .loose();

export const ZizaRefusalSchema = z
  .object({
    kind: z.string(),
    redirect: z.string().nullish(),
    sources: z.array(z.unknown()).nullish(),
  })
  .loose();

// --- chat stream events (`event: <name>`, JSON data) -------------------------

export const ZizaSearchingEventSchema = z.object({}).loose();

export const ZizaPassageSchema = z
  .object({
    number: z.number(),
    title: z.string().nullish(),
    locator: z.string().nullish(),
    excerpt: z.string().nullish(),
  })
  .loose();

export const ZizaWorkingEventSchema = z
  .object({
    kind: z.string(),
    query: z.string().nullish(),
    passages: z.array(ZizaPassageSchema).nullish(),
    tool: z.string().nullish(),
    status: z.string().nullish(),
  })
  .loose();

export const ZizaTextEventSchema = z.object({ text: z.string() }).loose();

export const ZizaCitationsEventSchema = z
  .object({ citations: z.array(ZizaCitationSchema) })
  .loose();

export const ZizaApprovalRequiredEventSchema = z
  .object({
    action_id: z.string(),
    tool: z.string(),
    description: z.string().nullish(),
    expires_at: z.string().nullish(),
  })
  .loose();

export const ZizaDoneEventSchema = z
  .object({
    answered: z.boolean().optional(),
    small_talk: z.boolean().optional(),
    usage: z.unknown().optional(),
    refusal: ZizaRefusalSchema.nullish(),
    pending_action: z.unknown().optional(),
  })
  .loose();

export const ZizaSuggestionsEventSchema = z
  .object({
    follow_ups: z.array(z.string()).default([]),
  })
  .loose();

export const ZizaLinksOfferedEventSchema = z
  .object({
    offer_id: z.string(),
    page_url: z.string(),
    links: z
      .array(z.object({ url: z.string(), title: z.string().nullish() }).loose())
      .default([]),
    expires_at: z.string().nullish(),
  })
  .loose();

export const ZizaLimitEventSchema = z
  .object({
    code: z.string(),
    message: z.string().nullish(),
    retry_after_seconds: z.number().nullish(),
  })
  .loose();

export const ZizaStreamErrorEventSchema = z
  .object({
    code: z.string().nullish(),
    message: z.string().nullish(),
  })
  .loose();

export const ZIZA_CHAT_EVENT_SCHEMAS = {
  searching: ZizaSearchingEventSchema,
  working: ZizaWorkingEventSchema,
  text: ZizaTextEventSchema,
  citations: ZizaCitationsEventSchema,
  approval_required: ZizaApprovalRequiredEventSchema,
  done: ZizaDoneEventSchema,
  suggestions: ZizaSuggestionsEventSchema,
  links_offered: ZizaLinksOfferedEventSchema,
  limit: ZizaLimitEventSchema,
  error: ZizaStreamErrorEventSchema,
} as const;

export type ZizaChatEventName = keyof typeof ZIZA_CHAT_EVENT_SCHEMAS;

export type ZizaChatEvent = {
  [EventName in ZizaChatEventName]: {
    type: EventName;
  } & z.infer<(typeof ZIZA_CHAT_EVENT_SCHEMAS)[EventName]>;
}[ZizaChatEventName];

export function isZizaChatEventName(
  eventName: string,
): eventName is ZizaChatEventName {
  return Object.hasOwn(ZIZA_CHAT_EVENT_SCHEMAS, eventName);
}

// Validates one event as it arrives from ziza, and again in the browser after
// the BFF forwards it with the event name folded in as `type`.
export function parseZizaChatEvent(
  eventName: string,
  payload: unknown,
): ZizaChatEvent | null {
  if (!isZizaChatEventName(eventName)) {
    return null;
  }
  const parsed = ZIZA_CHAT_EVENT_SCHEMAS[eventName].safeParse(payload);
  return parsed.success
    ? ({ ...parsed.data, type: eventName } as ZizaChatEvent)
    : null;
}

// What the BFF returns for an approval once it has read the resumed turn to
// its end. Built by `app/bff/ziza/approvals`, not by ziza.
export const ZizaResumedTurnSchema = z.object({
  text: z.string(),
  citations: z.array(ZizaCitationSchema).default([]),
  approval_required: ZizaApprovalRequiredEventSchema.nullable().default(null),
  suggestions: ZizaSuggestionsEventSchema.nullable().default(null),
  refusal: ZizaRefusalSchema.nullable().default(null),
  failure: ZizaStreamErrorEventSchema.nullable().default(null),
});

// The camelCase `Citation` the BFF and the history mapper put on a message as
// its `data-citations` part. Checked again when the message is rendered.
export const CitationPartSchema = z.array(
  z.object({
    number: z.number(),
    sourceId: z.string().optional(),
    sourceRef: z.string().optional(),
    locator: z.string().optional(),
    isRemoved: z.boolean(),
  }),
);

export const UnfinishedActionPartSchema = z.object({
  description: z.string(),
  reason: z.string(),
});

// --- session documents --------------------------------------------------------

export const ZizaJobViewSchema = z
  .object({
    id: z.string(),
    kind: z.string().nullish(),
    status: z.enum(["queued", "processing", "done", "failed"]),
    attempts: z.number().nullish(),
    progress: z
      .object({
        step: z.string().nullish(),
        done: z.number().nullish(),
        total: z.number().nullish(),
      })
      .loose()
      .nullish(),
    // Shaped by the job's kind: an ingest job's names its source, a starters
    // job's does not.
    result: z
      .object({
        source_id: z.string().nullish(),
        // The starters job queued when this ingest finished; null when the
        // product has starters turned off.
        starters_job_id: z.string().nullish(),
        // A finished starters job's questions for that one upload; missing
        // when the job skipped (session ended, spend cap, starters off).
        questions: z.array(z.string()).nullish(),
        chunks: z.number().nullish(),
        images_described: z.number().nullish(),
        images_skipped: z.number().nullish(),
        images_failed: z.number().nullish(),
        summary_added: z.boolean().nullish(),
        spend_cap_reached: z.boolean().nullish(),
      })
      .loose()
      .nullish(),
    error: z
      .object({
        type: z.string().nullish(),
        message: z.string().nullish(),
        retryable: z.boolean().nullish(),
      })
      .loose()
      .nullish(),
    created_at: z.string().nullish(),
    finished_at: z.string().nullish(),
  })
  .loose();

export const ZizaSourcesPageSchema = z.object({
  items: z.array(
    z
      .object({
        source_id: z.string(),
        title: z.string().nullish(),
        kind: z.string(),
        added_at: z.string().nullish(),
        status: z.string(),
      })
      .loose(),
  ),
  total: z.number(),
  limit: z.number(),
  skip: z.number(),
});

export const ZizaSourceRemovedSchema = z.object({
  source_id: z.string(),
  removed: z.string(),
});

export const ZizaStartersSchema = z.object({
  starters: z.array(z.string()).default([]),
});

export const ZizaLinkOfferOutcomeSchema = z.object({
  added: z.array(z.object({ url: z.string(), job_id: z.string() }).loose()),
  refused: z.array(
    z
      .object({
        url: z.string(),
        code: z.string().nullish(),
        message: z.string().nullish(),
      })
      .loose(),
  ),
});

// --- history ------------------------------------------------------------------

export const ZizaHistoryPageSchema = z.object({
  turns: z.array(
    z
      .object({
        id: z.string(),
        user_text: z.string(),
        answer_text: z.string().nullish(),
        citations: z.array(ZizaCitationSchema).default([]),
        answered: z.boolean().nullish(),
        cited: z.boolean().nullish(),
        small_talk: z.boolean().nullish(),
        unfinished_action: z
          .object({
            description: z.string(),
            reason: z.string(),
          })
          .loose()
          .nullish(),
        created_at: z.string(),
      })
      .loose(),
  ),
  next_before: z.string().nullish(),
});
