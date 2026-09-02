import { type z } from "zod";

import { type KnowledgeIngestResponseSchema } from "./ziza.schema";
import { type KnowledgeIngestResult } from "./ziza.types";

export const toKnowledgeIngestResult = (
  apiResult: z.infer<typeof KnowledgeIngestResponseSchema>,
): KnowledgeIngestResult => ({
  sessionId: apiResult.session_id,
  source: apiResult.source,
  chunksIngested: apiResult.chunks_ingested,
  searchable: apiResult.searchable,
  imagesDescribed: apiResult.images_described,
  imagesFailed: apiResult.images_failed,
  imagesTotal: apiResult.images_total,
  pagesSummarised: apiResult.pages_summarised,
});
