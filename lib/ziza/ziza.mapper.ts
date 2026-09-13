import { type z } from "zod";

import {
  type KnowledgeIngestResponseSchema,
  type KnowledgeSuggestionsResponseSchema,
  type ZizaPendingCallSchema,
} from "./ziza.schema";
import {
  type KnowledgeIngestResult,
  type PendingCall,
  type StarterQuestions,
} from "./ziza.types";

export const toKnowledgeIngestResult = (
  apiResult: z.infer<typeof KnowledgeIngestResponseSchema>,
): KnowledgeIngestResult => ({
  sessionId: apiResult.session_id,
  source: apiResult.source,
  chunksIngested: apiResult.chunks_ingested,
  searchable: apiResult.searchable,
  imagesDescribed: apiResult.images_described,
  imagesFailed: apiResult.images_failed,
  documentsUsed: apiResult.documents_used,
  documentsAllowed: apiResult.documents_allowed,
  pagesSummarised: apiResult.pages_summarised,
  suggestions: apiResult.suggestions,
});

// Whose call this is belongs to the backend — the tool knows what it does —
// but nothing on the wire says so yet. `details.severity` wins when present;
// until then the only destructive tool is the delete, and anything new is
// treated as ordinary rather than assumed dangerous.
const DESTRUCTIVE_TOOL_NAMES = new Set(["clear_knowledge_base"]);

export const toPendingCall = (
  apiCall: z.infer<typeof ZizaPendingCallSchema>,
): PendingCall => {
  const { details } = apiCall;
  const shared = {
    toolCallId: apiCall.tool_call_id,
    toolName: apiCall.tool_name,
    summary: details.summary,
  };

  if (apiCall.kind === "approval") {
    return {
      ...shared,
      kind: "approval",
      documents: details.documents ?? [],
      isDestructive: details.severity
        ? details.severity === "destructive"
        : DESTRUCTIVE_TOOL_NAMES.has(apiCall.tool_name),
    };
  }

  return {
    ...shared,
    kind: "call",
    pageUrl: details.url,
    pageTitle: details.page_title ?? undefined,
    links: details.links ?? [],
    slotsLeft: details.slots_left,
  };
};

export const toStarterQuestions = (
  apiResult: z.infer<typeof KnowledgeSuggestionsResponseSchema>,
): StarterQuestions => ({
  document: apiResult.document,
  suggestions: apiResult.suggestions,
});
