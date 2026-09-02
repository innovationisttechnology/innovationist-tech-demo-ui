# AI Chatbot Demo — Implementation Plan

**Status:** In progress — frontend complete, backend half done.
**Goal:** Ship the `/demos/ai-chatbot` demo, backed by the pydantic-ai demo API.
**Why first:** The homepage advertised this demo with a "View live demo" CTA that
led to a blank page. That dead end is now closed — the page is built and streaming
against the real API.

| Phase                               | Owner    | Status                                                                   |
| ----------------------------------- | -------- | ------------------------------------------------------------------------ |
| 1 — Conversation memory             | Backend  | ⬜ Not started                                                           |
| 2 — SSE event contract              | Backend  | 🟡 Contract defined + parsed client-side; API still emits only `{chunk}` |
| 3 — `lib/ziza/` service layer       | Frontend | ✅ Done                                                                  |
| 4 — Chat page + layout              | Frontend | ✅ Done                                                                  |
| 5 — Agent events in the inspector   | Both     | ⬜ Blocked on Phase 2's backend half                                     |
| — System prompt + tool descriptions | Backend  | ✅ Done (added after the original plan)                                  |

**Next up:** Phase 1, then the backend half of Phase 2. Both are in
`innovationist-tech-demo-api`; the frontend needs no further work to consume them.

---

## Repos involved

| Repo                          | Path                                                   | Role                                                               |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `innovationist-tech-demo-ui`  | `~/innovationisttechdemos/innovationist-tech-demo-ui`  | This repo. Next.js 16 portfolio demo site.                         |
| `innovationist-tech-demo-api` | `~/innovationisttechdemos/innovationist-tech-demo-api` | FastAPI + pydantic-ai 2.5.0 backend.                               |
| `innovationist-tech-ui`       | `~/innovationisttech/innovationist-tech-ui`            | Company site. Source of reusable patterns only — **not** in scope. |

---

## Current state

### Demo UI (this repo) — built

```
app/demos/ai-chatbot/
├── page.tsx                 # server: metadata + the h1/eyebrow line
├── ai-chatbot-demo.tsx      # client shell: useChat, resizable panes, mobile sheet
├── sources-panel.tsx        # source-type dropdown + per-type body + list
├── chat-panel.tsx           # message list, markdown, in-textarea send icon
└── inspector-panel.tsx      # Stream / Chunks tabs

app/api/ziza/stream/route.ts # SSE → AI SDK protocol translator
lib/ziza/{schema,types,mapper,service}.ts
lib/use-media-query.ts       # useSyncExternalStore, not effect+setState
```

- Session id is **shared with content-sync** via `getSessionId()` — one IndexedDB
  id per browser, as planned.
- Added deps: `@ai-sdk/react`, `react-markdown`. shadcn: `resizable`, `tabs`,
  `scroll-area`, `tooltip`, `select`.
- shadcn components in this repo swap `lucide-react` imports for phosphor —
  `select.tsx` needed the same treatment as `navigation-menu.tsx` / `sheet.tsx`.
- **Patterns reused from content-sync** (all still the reference for future work):
  - `lib/api/request.ts` — axios + zod choke-point, never throws, returns `{data, status, ok}`.
  - `lib/content-sync/` — `schema` → `mapper` → `types` → `service` layering.
  - `lib/content-sync/session.ts` — `getSessionId()`, per-browser UUID in IndexedDB
    on a sliding 7-day TTL.
  - `app/demos/content-sync/event-terminal.tsx` — the visual language the Stream
    tab follows (it has its own implementation rather than importing it).

### Demo API

`app/ziza_chat/` — router / service / agents / tools / vector_store.

| Method   | Path                           | Notes                                                                     |
| -------- | ------------------------------ | ------------------------------------------------------------------------- |
| `POST`   | `/ziza/chat`                   | Non-streaming. Returns `{session_id, response, intent}`.                  |
| `POST`   | `/ziza/chat/stream`            | SSE. Emits `data: {"chunk": "..."}` lines.                                |
| `POST`   | `/ziza/knowledge`              | 201. Body `{session_id, text, source}` → `{chunks_ingested, searchable}`. |
| `DELETE` | `/ziza/knowledge/{session_id}` | Returns `{chunks_deleted}`.                                               |

✅ **Verified:** `main.py` mounts `api_router` at `/api`, so these resolve as
`/api/ziza/...`. `ChatRequest` requires `session_id` (min 1) and caps `message` at
4000 chars.

Architecture: a Haiku classifier (`ClassifyResult` → intents + `needs_rag` +
`rag_query`) routes into a Sonnet chat agent with two tools —
`search_knowledge_base` and `current_datetime`. Vector store is Mongo + local
fastembed (`BAAI/bge-small-en-v1.5`).

`web_search` was **removed from the agent's tool list** — it was a Tavily stub
returning a placeholder string, and with the inspector panel showing tool calls
on screen, a visible call that returns nothing is a bad demo moment. The module
still exists; re-add `web_search` to `tools=[...]` once Tavily is wired, plus a
line in the prompt about when to reach for it.

**Known gap:** `ChatDeps` carries only `intent`. The classifier also produces
`needs_rag`, `rag_query`, and `rag_ambiguous`, and none of those reach the chat
agent. Widening `ChatDeps` to carry the full `ClassifyResult` is cheap and would
let the agent skip retrieval when the classifier already decided it isn't needed.

---

## Ingestion scope — resolved, with one loose end

**Decided:** keep all three source types. The composer ships a dropdown; only
paste-text is wired. See [Source-type support](#source-type-support--sequencing)
for the mechanics and the publish blocker.

### ⬜ Still open: the card copy is wrong

`constants/demos.ts` is **unchanged** and still promises:

> "Upload your documents and ask questions in natural language. Retrieval-augmented
> generation grounds answers in your content, with a fine-tuned model for tone."
> Badges: `RAG` · `LLM` · `Fine-tuning`

Two claims the demo doesn't deliver:

- **Upload** — the dropdown offers it, but it isn't wired (see the publish blocker).
- **Fine-tuning** — nothing in this system fine-tunes anything. That pipeline lives
  in the company site's training console, a different codebase entirely.

Suggested badges for what was actually built: `RAG` · `Vector Search` · `Agent Tools`.
Also worth adding here: **2–3 preloaded sample corpora**, each with a suggested
question. Nobody arrives at a portfolio site with a document to paste, and the
empty state is the first thing every visitor sees.

---

## Plan

| Phase | Owner        | Summary                                 | Status |
| ----- | ------------ | --------------------------------------- | ------ |
| 1     | **Backend**  | Conversation memory (`message_history`) | ⬜     |
| 2     | **Backend**  | Define + emit the SSE event contract    | 🟡     |
| 3     | **Frontend** | `lib/ziza/` service layer               | ✅     |
| 4     | **Frontend** | Chat page + SSE → AI SDK translation    | ✅     |
| 5     | **Both**     | Agent events in the event terminal      | ⬜     |

Guardrails, observability, and file upload are deliberately **deferred** — see
[Deferred](#deferred) below. Phases 1–5 get a working, demoable feature; the
deferred list makes it production-safe.

### ⬜ Phase 1 — Backend: conversation memory

`app/ziza_chat/service.py` — both `chat()` and `stream_chat()` call the agent with
no `message_history`, so **every turn is a fresh conversation**. Ask "who is Sarah?"
then "what else about her?" and the second turn has no idea who "her" is.

- Persist `result.all_messages()` (or `.new_messages()`) keyed by `session_id`.
  `ModelMessagesTypeAdapter` handles JSON serialization for Mongo.
- Pass it back as `message_history=` on the next run. `Agent.run()` in 2.5 also
  accepts `conversation_id` — worth evaluating against the manual approach.
- ✅ **Already done:** the chat agent moved from `system_prompt=` /
  `@agent.system_prompt` to `instructions=` / `@agent.instructions`.
  `system_prompt` is replayed inside message history; `instructions` are not, so
  a stale prompt can't leak into a later turn once history exists.

Still the next thing to do — Phase 5 assumes multi-turn works.

### 🟡 Phase 2 — Backend: define the SSE event contract

**Frontend half is done. Backend half is not.** `app/api/ziza/stream/route.ts`
already parses both shapes and forwards typed events to the client as transient
`data-ziza` parts; `lib/ziza/ziza.schema.ts` holds the zod union. The inspector
handles `intent`, `tool_call`, `chunk_retrieved`, and `error` today — they simply
never arrive, because `format_sse()` still only wraps a text chunk.

**So this is now a backend-only task, and nothing on the client changes when it
lands.** That was the point of settling the contract before Phase 4.

Today the wire carries one undifferentiated shape:

```
data: {"chunk": "..."}
```

Phase 5 needs classification results, tool calls, and retrieved chunks on that
same stream. If Phase 4 ships a parser that assumes the single-shape payload, it
gets rewritten in Phase 5. Settle the contract once, up front — then Phase 4
parses the final shape from day one even while the API only emits `text` events.

Proposed envelope (every event is `{type, ...}`):

| `type`            | Payload                                          | Emitted when                    |
| ----------------- | ------------------------------------------------ | ------------------------------- |
| `intent`          | `{intents, needs_rag, rag_query, rag_ambiguous}` | Classifier returns              |
| `tool_call`       | `{tool, args}`                                   | Agent invokes a tool            |
| `chunk_retrieved` | `{source, score, text}`                          | `search_knowledge_base` returns |
| `text`            | `{delta}`                                        | Model text delta                |
| `error`           | `{message}`                                      | Run fails                       |

Remaining work (all in `innovationist-tech-demo-api`):

- Extend `app/ziza_chat/utils.py:format_sse` — it currently has the signature
  `format_sse(chunk: str)` and hardcodes `{"chunk": ...}`. It needs to take an
  event payload instead.
- Emit `intent` from the existing classifier call in `service.stream_chat()` —
  it already runs before the agent, so this is nearly free and proves the contract
  end to end. Emitting it also fixes a mismatch: the system prompt tells Ziza a
  classifier routes retrieval, and right now nothing surfaces that.
- Leave `tool_call` / `chunk_retrieved` to Phase 5. The contract exists and the
  client already handles them; the emitters come later.

### ✅ Phase 3 — Frontend: `lib/ziza/` — done

Mirrors `lib/content-sync/`:

```
lib/ziza/
├── ziza.schema.ts    # zod: ChatResponse, KnowledgeIngestResponse, SSE event shapes
├── ziza.mapper.ts    # snake_case → camelCase
├── ziza.types.ts     # domain types
└── ziza.service.ts   # ingestKnowledge / clearKnowledge / chatStreamUrl
```

- Build on `request()` from `lib/api/request.ts`. Components never touch axios.
- Import `getSessionId()` from `lib/content-sync/session.ts`. If that import
  reads wrong across demo boundaries, promote it to `lib/session/` and update the
  content-sync import — but keep it **one** session id per browser.

### ✅ Phase 4 — Frontend: the chat page — done

Shipped:

- `useChat` + `DefaultChatTransport` against `/api/ziza/stream`, with
  `prepareSendMessagesRequest` collapsing the message array to
  `{message, session_id}` (the backend owns history).
- The route handler ports the company site's reader/decoder/line-buffer loop, with
  the fixes noted: `upstream.body` null-checked instead of `!`-asserted, both frame
  shapes parsed, and markdown rendered in assistant bubbles via `react-markdown`.
- The `<h1>` is the green eyebrow line carrying the description — same pattern as
  content-sync, kept as a heading so the page has a document outline.

Bugs found and fixed while verifying in-browser:

- `scrollIntoView` on a sentinel div scrolled the **window**, yanking the page down
  on mount. Now scrolls the ScrollArea viewport directly, guarded on
  `turns.length > 0`.
- `react-resizable-panels` v4 takes `orientation`, not `direction`, and **numeric
  sizes are pixels** — `defaultSize={20}` was a 20px panel. Needs `"20%"`.
- The `sr-only` file input plus a separate trigger button were two controls in the
  a11y tree. The input is now wrapped in its `<label>`.
- Chat empty state said "add sources on the left" — wrong on mobile.

#### Layout — decided: workbench with tabbed inspector

Three resizable panes. Not a file _tree_ — sources are a flat list, so this is an
"Open Editors" panel, not an explorer.

```
┌────────┬───────────────────────────┬─────────────────┐
│SOURCES │ CHAT                      │ INSPECTOR       │
│        │                           │ [Stream][Chunks]│
│▸handbk │ ● How does onboarding     │ ─────────────── │
│   47   │   work?                   │ intent          │
│▸pricing│                           │   question      │
│   12   │ ○ Based on the handbook,  │   needs_rag ✓   │
│▸blog   │   new hires… [1][2]       │   query:        │
│    8   │                           │   "onboarding"  │
│        │ ┌───────────────────────┐ │                 │
│+ Add   │ │ Ask something…   [↵] │ │ tool ▸ search   │
└────────┴─┴───────────────────────┴─┴─────────────────┘
```

**Why tabs in the inspector:** the Phase 2 envelope emits three different shapes.
`intent` is structured data, `tool_call` is a log line, `chunk_retrieved` is prose
with a score. One terminal makes all three worse — chunks in particular get
truncated, and they're the payload that proves retrieval works.

| Tab        | Content                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| **Stream** | Raw event log, terminal-styled — reuse `EventTerminal` near-unchanged    |
| **Chunks** | Retrieved passages for the current turn, with `source` + relevance score |
| **Trace**  | _(later)_ per-turn timing + token usage, once instrumentation lands      |

The inspector uses stock shadcn `Tabs` with `variant="line"` — no style
overrides. Earlier attempts passed `bg-transparent p-0` on `TabsList` and forced
10px mono on the triggers, which stripped the track and stopped it reading as a
toggle. `TabsTrigger` already ships `uppercase` + `tracking-wider`.

**Interactions that carry the demo** — these matter more than the layout itself:

- ✅ **Source-type dropdown.** Superseded the original "one auto-detecting input"
  idea — you can't detect your way to a file picker, so an explicit selector is
  cleaner. See [Source-type support](#source-type-support--sequencing).
- 🟡 **Retrieval lights up the rail.** Client side is built: `chunk_retrieved`
  adds the source to `activeSourceLabels` and the row highlights. Waiting on the
  backend to emit the event.
- ⬜ **Citation chips under answers.** `[1] handbook · 0.87`, clicking scrolls the
  Chunks tab to that passage. Not built — needs `chunk_retrieved` first.
- ✅ **Per-source pipeline state.** `handbook.md · 47 chunks · indexed`, with
  `embedding… → indexing… → indexed` driven off `chunks_ingested` + `searchable`.
- ⬜ **Empty state = starter files.** 2–3 sample corpora pre-seeded, each with a
  suggested question. Still the single highest-value UX gap.

**Mobile** — ✅ built. Chat goes full-height; sources and inspector live in a
bottom `sheet` opened by a pill reading `N sources · N events`. Desktop/mobile
split is driven by `useMediaQuery` (via `useSyncExternalStore`, so it doesn't
trip the `react-hooks/set-state-in-effect` lint rule).

**Components added:**

```bash
npx shadcn@latest add resizable tabs scroll-area tooltip select
```

`resizable` sells the IDE metaphor cheaply — draggable dividers make it feel like
a tool rather than a page. All three panes are client components.

#### Source-type support — sequencing

The layout exposes three source types; the backend supports one.

| Source      | Backend today                                        | Work needed                                                                      |
| ----------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Paste text  | ✅ `POST /ziza/knowledge {session_id, text, source}` | none                                                                             |
| File upload | ❌                                                   | multipart + text extraction (PDF / docx / md)                                    |
| Website URL | ❌                                                   | server-side fetch + HTML→text extraction (can't be done from the browser — CORS) |

**Decided:** a source-type dropdown at the top of the composer (Paste text /
Document upload / Website URL), with the body swapping per type — textarea, drop
zone, URL field. Built and shipped in the UI.

No control is disabled. Selecting an unwired type shows an inline notice naming
the missing piece:

> _"Document upload isn't wired up yet — the API needs multipart support on
> `/ziza/knowledge`. Paste text for now."_

That keeps the UI complete and reviewable, and doubles as a visible TODO while
the backend catches up. When multipart and URL fetch land, the frontend needs no
rework — only `onAddSourceAction` grows a `kind` argument.

> ⚠️ **PUBLISH BLOCKER.** This is a development-mode answer. Before the demo is
> public, Document upload and Website URL must either work or come out of the
> dropdown — a visitor picking a type and getting "not implemented" is the same
> dead end as the current homepage CTA. Decide at publish time; do not ship the
> notices to production.

### ⬜ Phase 5 — show the agent thinking

This is where the design effort belongs. Every RAG demo is a chat box; this one
doesn't have to be.

**Backend — the only remaining work.** Swap `service.stream_chat()` from
`result.stream_text(delta=True)` to `agent.run_stream_events()` /
`event_stream_handler`, and map pydantic-ai's events (`FunctionToolCallEvent`,
`FunctionToolResultEvent`, `PartStartEvent`) onto the Phase 2 envelope.

**Frontend — already built.** The inspector renders every event type in the
contract: `intent` (intents, `needs_rag`, `rag_query`), `tool_call` with args,
`chunk_retrieved` into the Chunks tab with source + score, and `error`. Nothing to
add on this side; the panels fill in as soon as the events arrive.

Payoff: the demo becomes "here is how a RAG agent decides what to retrieve" rather
than "here is a chatbot," and it makes both demos read as one system — the event
terminal is the visual signature of the content-sync demo.

---

## ✅ System prompt + tool descriptions — done

Not in the original plan; added after reviewing the pydantic-ai setup.

**The bug that prompted it:** both the system prompt and the
`search_knowledge_base` docstring described the knowledge base as _"internal
knowledge"_ / _"internal, company, or session-specific topics."_ But
`MongoVectorStore` scopes by `session_id` and the UI lets each visitor paste their
own documents — so the KB holds whatever a stranger just pasted. Ziza would have
presented a visitor's own text as authoritative company knowledge.

Changed in `innovationist-tech-demo-api`:

- `agents/chat.py` — rewrote `SYSTEM_PROMPT`. Leads with the situation (public
  demo, evaluating audience, tool calls visible on screen), states what the KB
  actually is, makes grounding-and-citing the one behavioral rule, covers the
  empty-KB case, and gives a concrete architectural answer for the `identity`
  intent the classifier already emits. Net effect: more context, fewer
  instructions — the tool docstrings carry the "when to call" guidance.
- `agents/chat.py` — `add_intent` now frames the classifier label as a hint that
  can be overridden, not a fact. A classifier that's wrong 5% of the time
  compounds if the prompt treats its output as ground truth.
- `tools/common.py` — `search_knowledge_base` docstring rewritten: correct
  framing, a negative trigger ("don't reach for it on general questions"), query
  shape ("pass the topic, not the whole message"), and that empty results are a
  terminal answer rather than a reason to retry.

**Also worth doing:** `ziza_chat_model` is `anthropic:claude-sonnet-4-5`, a
generation behind. `anthropic:claude-sonnet-5` is the current Sonnet tier — a
config-string swap, since the model name was deliberately kept configurable.

---

## Deferred

Not needed for a working demo; needed before this is public and trafficked.
Revisit once Phases 1–5 land.

**Guardrails** — `/ziza/chat/stream` is public and unauthenticated with no token
cap, no rate limit, and no `.max_length()` on the incoming message
(`ZizaChatRequestSchema` is `min(1)` only). That is an open, uncapped path to
model spend. Add `UsageLimits` on the agent run, a length cap on the request
schema, and rate limiting at the route.

**Observability** — `Agent.instrument_all()` + Logfire. No tracing on the agent
today; this is the highest-value single line currently missing, and it makes
Phase 5 far easier to build because you can see the real event stream.

**File upload + URL fetch** — ⚠️ **no longer optional.** The composer now offers
both in its dropdown, so these moved from "deferred" onto the publish path. File
upload needs multipart + text extraction on `/ziza/knowledge`; URL needs a
server-side fetch and HTML→text extraction. The UI picker is already built for
both — only `onAddSourceAction` grows a `kind` argument. See the
[publish blocker](#source-type-support--sequencing).

**Evals** — `pydantic-evals` is already a dependency, `evals/classifier_evals.py`
exists, and `tests/test_ziza_classifier.py` has 7 spot-check tests. A nine-intent
classifier with RAG routing wants a fuller `Dataset`/`Case` suite, and that matters
more once Phase 2 makes the intent user-visible in the inspector.

---

## Backlog — portfolio polish (after the demo ships)

Small, all in this repo, all worth doing before sharing the link publicly.
None of these have been touched yet.

- [ ] `constants/demos.ts` — card copy promises document upload and a "fine-tuned
      model for tone"; badges say `Fine-tuning`. Neither is true. Suggested:
      `RAG` · `Vector Search` · `Agent Tools`.
- [ ] No `GET /ziza/knowledge` on the API, so the Sources panel shows only what you
      added this session — the chunks persist server-side but the list resets on
      reload. Needs a list endpoint.
- [ ] `app/layout.tsx:31` — `description` is still `"Generated by create next app"`.
- [ ] No `openGraph` / `twitter` / `metadataBase` — sharing the link renders a bare URL.
- [ ] Homepage has **no headings at all**. `DemoShowcase` renders "Live Demos" as a
      `<p>`, and shadcn's `CardTitle` (`components/ui/card.tsx:36`) is a `<div>`.
- [ ] `app/demos/content-sync/signal-chart.tsx:241` — X-axis ticks use `fill-white/35`,
      invisible against the white card in light mode. Every other tick uses
      `fill-muted-foreground`.
- [ ] Content-sync fails silently when the API is down: `fetchFlags` returns `[]`
      on error (indistinguishable from "new session"), `getSessionId()` rejects
      unhandled if IndexedDB is blocked, and there is no `EventSource` `onerror`.
- [ ] CI lints and builds but never runs `npm run test:run`.
- [ ] Tests cover layout chrome only — nothing in `lib/`.
- [ ] Dead weight: `Geist_Mono` is loaded but nothing reads `--font-geist-mono`;
      `@radix-ui/themes` and `@radix-ui/react-icons` are unused.
- [ ] `components/layout/site-footer/site-footer.tsx:61` — LinkedIn `TODO`
      still points at `https://linkedin.com`.
- [ ] Add `coverage/**` to `globalIgnores` in `eslint.config.mjs`; `**/*.md` is
      listed twice.

---

## Explicitly out of scope

Company-site cleanup (`innovationist-tech-ui`). Real work, but it doesn't block
the portfolio and it's a different repo with a different risk profile. Separate
track, after this demo ships. Recorded so it isn't lost:

- `app/api/ziza-chat-training/**` (10 route files) is entirely dead — reachable
  only via `zizaChatStreamUrl`, which is never imported. Same for
  `useFloatingChatStore`, `sendZizaChatMessage`, both `ingest` routes, and the
  non-streaming chat routes.
- `ziza` vs `ziza-chat` is a real design (the `ZIZA_ONLINE_MODEL_ENABLED` flag
  switches local vs online model) with names that communicate none of it.
- `app/lib/request-post.ts:9` takes a `bodySchema` and never uses it — every
  caller believes its request body is validated. It isn't.
- `use-training-session.ts` casts API responses (`as ApproveResponse`) instead of
  using the zod schemas imported in the same file, and four handlers fail silently.
- No document upload for the chatbot — the "Ingest Document" page is a textarea,
  and the "Train from Files" button has no handler.
