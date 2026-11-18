# Ziza API notes for the chat demo

Written from the backend side. This replaces the earlier version of this file,
which was a to-do list — everything on it has since been built, and leaving it
would have sent someone to fix bugs that are fixed.

**Newest first.** Sections 1–3 are the recent changes, most recent first;
a section tagged `LANDED` is built on both sides and kept for its reasoning,
one tagged `NEW` still has work in it.
Sections 4–6 record what is already live and why, so it does not get
re-litigated or accidentally undone. Anything added later goes on top, tagged
`NEW`, and pushes the rest down.

---

## 1. LANDED — suggestions carry their own heading

Every `ask` suggestion now arrives with a `category`: two to four words naming
where following it would take the conversation, meant to sit above the chip
where the static kicker sits today.

```json
{
  "kind": "ask",
  "label": "Why did the invoice amount increase from $69.89 to $74.84?",
  "message": "Why did the invoice amount increase from $69.89 to $74.84?",
  "category": "Billing changes",
  "url": null
}
```

Sent for both surfaces that offer questions — the follow-up chip after an
answer, and the starter questions on the ingest response and its read-back.
`add_page` suggestions carry `"category": null`; there is no useful heading for
"here is another page you could index".

**The field already exists on this side.** `ZizaSuggestionSchema` declares
`category: z.string().nullish()` (`ziza.schema.ts:45`), the `Suggestion` type
has it (`ziza.types.ts:93`), and the schema is `.loose()`. Someone stubbed this
out and the backend never filled it until now, so there is no schema or type
change to make — only a decision about where to render it.

**Starter questions need nothing at all.** `starter-questions.tsx:32-36`
already renders `question.category` when present, in the treatment the chips
kicker uses. Those cards light up the moment the backend deploys.

The work was `suggestion-chips.tsx`, which showed a fixed per-kind kicker from
`KICKER_FOR_KIND` — `worth asking` above a follow-up, `try instead` above an
offered page. The follow-up half of that is what the category replaces, and it
is now built (`suggestion-chips.tsx:66-79`).

**Mind the shape mismatch.** The kicker is per _group_; the category is per
_suggestion_. For `ask` the two are the same thing, because the grader returns
at most one. For `add_page` they are not: up to four can come back, none of
them with a category. So the category renders per suggestion, and the group
kicker survives as the fallback for a group where nothing has one — rather than
the kicker being replaced outright.

A test comment at `chat-panel.test.tsx` used to read "Nothing sends `category`
yet, so the card must not leave a blank line." The first half stopped being
true when this shipped; the assertion behind it still holds, and still matters
for `add_page`. The comment has been corrected.

### Where the category comes from, and why it cannot drift

Both surfaces run the same three-stage pipeline: a writer proposes candidates,
retrieval drops the ones nothing in the index can answer, and a grader from a
different provider drops the rest.

The category is written by the writer, in the same pass that invents the
question — not by the grader. That is a deliberate constraint rather than a
convenience. The grader is shown questions and only questions, and answers with
the text of the ones it keeps; it never sees a heading and cannot name one. So
the heading that reaches the screen is always the one written for the question
it sits above, and no stage in between can move it onto a different question.

### What makes a category worth its space

A heading that restates the question is worse than `worth asking`, because it
adds weight and says nothing. The visitor reads it first and reads it instead
of the question if they are skimming, so it has to carry something the question
does not already carry.

For "Why did the invoice amount increase from $69.89 to $74.84?", the category
is not "Invoice amount" — that is the question's own noun handed back. It is
"Billing changes" or "Pricing history": the ground the answer would move onto.
The prompts say exactly that, with that example.

Starter questions get one extra rule, because they come in threes and are meant
to open different parts of a document: their categories have to differ from
each other. Three near-synonyms are worse than three bare cards, since they
imply distinctions the questions do not have. A schema cannot enforce
distinctness across list items, so that one is asked for rather than
guaranteed — worth a look on real uploads before trusting it.

**Render an absent category as no heading, never as a blank line or a
placeholder.** It is null for every `add_page` suggestion by design, and null
for starter questions stored before this existed: those documents live until
their session TTL expires, so `StoredQuestion.category` is optional on the
backend precisely so they still load.

---

## 2. LANDED — the stream changed shape

A bug fix on the backend altered what `/chat/stream` puts on the wire. The
frame contract is unchanged — `chat.chunk` deltas still concatenate in order
into the answer — but there are now many more of them, they can arrive in two
bursts separated by a silent gap, and a stream that dies now says so instead of
just stopping.

**Nothing here breaks the current frontend**, so the backend has already
shipped. `handleFrame` drops frames no schema matches
(`app/bff/ziza/stream/route.ts:124-127`), logging them server-side and passing
nothing to the client. The new frame lands there today. This section is about
what to do with it.

### 2a. `chat.error` — a failed stream now admits it

Previously a mid-stream failure — a provider 529, a usage limit, a bad
response — propagated out of the generator and killed the connection. The
browser saw the stream simply end, mid-sentence, indistinguishable from a short
answer. The route now catches it and closes out deliberately:

```
HTTP 200
event: chat.chunk
data: {"type": "chat.chunk", "chunk": "Let me search "}

event: chat.chunk
data: {"type": "chat.chunk", "chunk": "The assistant is unavailable right now. Please try again in a moment."}

event: chat.error
data: {"type": "chat.error"}
```

**It is still HTTP 200, and that is not negotiable.** The headers went out with
the first chunk, so by the time the failure happens there is no status code
left to set. `chat.error` is the only signal there is.

**The apology already renders**, with no frontend change. `ZizaTextFrameSchema`
matches on the presence of a `chunk` string alone (`ziza.schema.ts:133`) and is
tried before the event union (`route.ts:106-111`), so that second frame becomes
a text delta and appends to the assistant bubble like any other. A visitor
today sees the truncated answer followed by the apology — which is the point.
The work below is about the machinery knowing, not the visitor.

**`useChat`'s `error` will never fire for this.** The response is a clean 200
that ends normally, so the transport reports success and `error` stays
undefined. The banner at `chat-panel.tsx:292-296` — fed from `error?.message`
at `ai-chatbot-demo.tsx:760` — is dead for this path. Any visible failure state
beyond the apology text has to be driven from the frame.

**Do not reuse `ZizaErrorEventSchema`** (`ziza.schema.ts:155-158`). It is one of
the speculative placeholders the comment above it describes, and it fits
neither half of this frame: it is keyed on `type: "error"`, not `"chat.error"`,
and it requires a `message` string this frame does not carry. `format_sse`
serialises with `exclude_none`, so the payload is literally `{"type":
"chat.error"}` — no null `chunk`, no null `suggestions`. Anything destructuring
those fields gets `undefined`, not `null`.

**Both steps below are now built** (`ziza.schema.ts:176`,
`ai-chatbot-demo.tsx:299`), along with a retry affordance driven from the
frame. They are kept as a record of what the frame is for, not as a to-do.

**Step 1 — the schema.** Alongside the others in `ziza.schema.ts`:

```ts
export const ZizaChatErrorEventSchema = z.object({
  type: z.literal("chat.error"),
});
```

and add it to the `ZizaAgentEventSchema` union (`ziza.schema.ts:176-184`). That
alone stops the server-side "no schema matched" warning and starts delivering
the frame as a transient `data-ziza` part.

**Step 2 — handling it.** In the `handleData` switch
(`ai-chatbot-demo.tsx:186-303`), beside the existing `case "error"` at
`ai-chatbot-demo.tsx:296`:

```ts
case "chat.error":
  pushEntry("error", "stream.error", "The answer was cut short.");
  break;
```

`pushEntry` is the inspector log the whole switch already writes to, and an
`"error"` entry is how `deferral.malformed` and `suggestions.malformed` report
themselves (`ai-chatbot-demo.tsx:249-254`, `279-284`). Reuse it rather than
introducing a toast.

**It does more than log.** A `streamFailed` flag set by this case drives a
"Try again" row, which re-sends the last user message through the ordinary send
path. That is safe because nothing from a failed turn is persisted — see 2b.
The reasoning that made it a real option rather than a guess:
The frame is deliberately bare so the UI can decide. A retry affordance is the
obvious candidate — the visitor's message is already in `messages`, so
re-sending it is `sendMessage` with the same text — but nothing about the
contract requires one, and the apology plus an inspector entry is a defensible
place to stop.

### 2b. Deltas got smaller, and an answer can pause mid-sentence

The old implementation used pydantic-ai's `run_stream()`, which debounced at
100ms and handed back cumulative snapshots of the answer; the backend diffed
consecutive snapshots and sent the new suffix. It has been replaced with
`run_stream_events()`, which forwards the model's own text deltas untouched.
Two consequences.

**There are far more frames, and they are far smaller.** Roughly token-sized
and undebounced, where before they were ~10 per second. This is the same
append-only contract — concatenating in order still yields the answer — just
much finer-grained. Three places do per-delta work that was previously paid ten
times a second and is now paid on every token:

| Where                         | What happens per delta                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `chat-panel.tsx:249`          | `<ReactMarkdown>{turn.text}</ReactMarkdown>` re-parses the entire answer from scratch         |
| `chat-panel.tsx:89-121`       | a `useLayoutEffect` reads `scrollHeight` and writes `scrollTop`, forcing a synchronous reflow |
| `ai-chatbot-demo.tsx:388-405` | `turns` is a `useMemo` over `messages`, so every bubble re-renders, not just the growing one  |

**The bubble is now memoised** (`chat-panel.tsx:37`), which covers the third
row: completed turns no longer re-render while a later one streams. The scroll
effect is deliberately untouched — it has never been profiled against the new
cadence, and optimising it on suspicion is how a working layout effect becomes
a broken one.

**An answer can now arrive in two bursts.** This is the behaviour change worth
understanding, because it is the bug that was fixed. Text the model writes
_before_ calling a tool used to end the turn — `run_stream()` treats the first
text it sees as the final output — so a preamble like "Let me search your
documents." was delivered as the entire answer and the grounded one that
followed was never sent. Now both arrive, in one assistant message:

```
event: chat.chunk
data: {"type": "chat.chunk", "chunk": "Let me "}

event: chat.chunk
data: {"type": "chat.chunk", "chunk": "search "}

event: chat.chunk
data: {"type": "chat.chunk", "chunk": "your documents. "}
                    ← retrieval runs here: seconds of silence, no frames
event: chat.chunk
data: {"type": "chat.chunk", "chunk": "Sarah leads "}

event: chat.chunk
data: {"type": "chat.chunk", "chunk": "engineering."}
```

**The preamble and the answer are indistinguishable on the wire.** Both are
plain `chat.chunk`; only the gap separates them, and the gap is however long
retrieval takes. The backend cannot mark the boundary without inventing a frame
type, and it deliberately has not.

**The typing indicator used to go away before the gap started** — the dots
rendered only while an assistant turn's text was still empty, so the first
delta removed them and the visitor watched a half-finished sentence through the
whole retrieval pause. **Fixed**: `isAnswering` (`chat-panel.tsx:257`) now
tracks `isStreaming` on the last turn rather than empty text, so the indicator
stays through the gap.

Measured on the backend side, for anyone weighing this again: the retrieval
tool itself costs 5-20ms (the local embedding is 1.4-1.7ms warm). The gap is
almost entirely the second model round trip — the whole conversation plus the
retrieved passages going back to Sonnet for a fresh first token. Estimated at
1-3 seconds and not measured against a live key, so treat it as an order of
magnitude, not a number.

The pulsing pip in the panel header (`chat-panel.tsx:181-183`) is driven by
`isStreaming` and does keep going, so the state is not entirely unsignalled —
but it is across the panel from where the visitor is reading. If the pause
reads as a hang in practice, the fix is local: keep an activity indicator
attached to the streaming bubble while `isStreaming` is true, rather than only
while its text is empty.

### 2c. `POST /api/ziza/chat` — new error codes, and still not yours

For completeness, since it is the same backend change. Model failures on the
buffered route used to surface as `500 {"error": "internal_server_error"}`.
They are now `503 {"error": "model_unavailable"}`, or `429` when the provider
itself rate-limited us. Same `ErrorResponse` envelope.

**This frontend does not call that route** — the BFF fetches
`/api/ziza/chat/stream` and nothing else (`route.ts:46`), as section 6 already
records. Noted only so that if anyone does wire it, they branch on the `error`
field rather than the status code: a `429` from this path means the provider is
saturated and retrying later is reasonable, while the `429` from a full session
carries `{"error": "session_limit"}` and retrying is pointless until documents
are removed.

---

## 3. NEW — restore a reloaded session

Two endpoints, one job: a refresh currently empties the panel and the
conversation while the session still holds both. Call them together in the
session-restore effect in `ai-chatbot-demo.tsx`, beside the existing
`fetchStarterQuestions(id)` — all three answer the same question about a
reloaded session and can settle at once.

Neither should be polled. After the initial load the stream and the ingest
responses are authoritative; these are the cold read only. The history endpoint
is called again only when the visitor scrolls back for older turns.

### 3a. The conversation

```
GET /api/ziza/chat/{session_id}/history?limit=10&before=<iso-datetime>
```

```json
{
  "session_id": "769fec48-…",
  "turns": [
    {
      "id": "68c4…a1-0",
      "role": "user",
      "text": "who is Sarah?",
      "at": "2026-09-13T09:00:00Z"
    },
    {
      "id": "68c4…a1-1",
      "role": "assistant",
      "text": "Sarah leads the platform team.",
      "at": "2026-09-13T09:00:00Z"
    }
  ],
  "has_more": true,
  "next_before": "2026-09-13T09:00:00Z"
}
```

`{id, role, text}` matches the existing `ChatTurn` type, so turns map straight
into state. `at` is extra and can be ignored.

**The newest page comes back by default** — no cursor needed on first load.
Someone rejoining a conversation wants where they left off, so `turns` is the
_end_ of the conversation, ordered oldest-first within the page so it renders in
reading order.

**To scroll back**, send the previous response's `next_before` as `before`.
Repeat until `has_more` is false; `next_before` is null on the last page. Each
page is older than the one before it, so prepend it to what you already have.

**`limit` is exchanges, not messages.** One exchange is a question and its
answer, so it usually renders as two bubbles — the default of 10 is about 20
bubbles, a screenful to rejoin at. Paging by message would split an exchange
across a boundary and put an answer on a screen whose question is on the
previous one.

The client owns the page size; send whatever suits the viewport. **Omit `limit`
and it defaults to 10.** Valid range is 1–50, and anything outside it — `0`,
`100`, a non-integer — is a **422**, not silently clamped, so a wrong value
surfaces at the call site rather than as a page that is quietly the wrong
size.

**Ids are derived from the stored turn**, not from position in the page. That
matters here: positional ids would make the first turn of an older page and the
first turn of the page already rendered both `"0"`, and a keyed list would treat
them as the same row. They are stable across requests, so deduplicating on id
while scrolling back is safe.

#### Implementing the scroll-back

**Correction to the earlier draft: `turns` is not state — verify this before
touching anything.** `ChatPanel` is handed `turns` as a prop, but in
`ai-chatbot-demo.tsx` it is a `useMemo` derived from `messages`
(`ai-chatbot-demo.tsx:353-370`), and `messages` is owned by the Vercel AI SDK's
`useChat` hook (`ai-chatbot-demo.tsx:348`), which also exposes `setMessages`.
The codebase already prepends/appends to history this way — see
`applyDeferralOutcome` (`ai-chatbot-demo.tsx:426-433`), which calls
`setMessages` with a hand-built `{ id, role, parts: [{ type: "text", text }] }`
object, the shape `useChat` expects (`UIMessage` from the `ai` package). There
is no separate `turns` array to prepend into — **older history has to be
merged into `messages` via `setMessages`, in `ai-chatbot-demo.tsx`, using that
same shape**, not manipulated as local state in `chat-panel.tsx`. Everything
below is written against that fact.

**Step 1 — add the service call.** Nothing calls the history endpoint yet.
Follow the existing pattern in `lib/ziza/`: `fetchStarterQuestions` and
`fetchSessionSources` (`ziza.service.ts:161-181`) each add one Zod schema in
`ziza.schema.ts`, one mapper in `ziza.mapper.ts`, and one `async` function that
calls `request()` and returns `null` on failure. Add a
`ChatHistoryResponseSchema` (`session_id`, `turns: [{ id, role, text, at }]`,
`has_more`, `next_before`), a `toChatHistoryPage` mapper, and:

```ts
export const fetchChatHistory = async (
  sessionId: string,
  options: { limit?: number; before?: string } = {},
): Promise<ChatHistoryPage | null> => {
  const { data, ok } = await request(
    `/ziza/chat/${encodeURIComponent(sessionId)}/history`,
    ChatHistoryResponseSchema,
    { params: options },
  );
  return ok && data ? toChatHistoryPage(data) : null;
};
```

`request()` spreads its `options` straight into the axios config
(`lib/api/request.ts:16-31`), so `{ params: options }` is enough — no manual
query-string building. A page's `turns` map to `UIMessage`s the same way
`applyDeferralOutcome` already does: `{ id: turn.id, role: turn.role, parts:
[{ type: "text", text: turn.text }] }`. `at` is dropped here too.

**Step 2 — cold load, in the session-restore effect.** The intro to this
section already says the initial history read belongs beside
`fetchStarterQuestions(id)` in `ai-chatbot-demo.tsx`'s session-restore effect
(`ai-chatbot-demo.tsx:152-203`). Add a third `void fetch...(id).then(...)`
there, calling `fetchChatHistory(id)` with no `before`. On success, seed
`messages` with the mapped page and remember its `next_before`/`has_more` for
step 3. Guard it exactly like the sources restore already does at
`ai-chatbot-demo.tsx:170-174` — a functional update that only writes if nothing
has arrived yet:

```ts
setMessages((current) => (current.length > 0 ? current : mappedTurns));
```

That guard matters more here than for sources: the visitor can send a message
before this resolves, and `useChat` will already have appended it to
`messages` by then.

**Step 3 — own the pagination state and the loader, in `ai-chatbot-demo.tsx`.**
Add `nextBeforeRef` (or state; it is not rendered), `hasMoreHistoryRef`, and
`isLoadingOlderHistoryRef` beside the other session state, and one callback:

```ts
const loadOlderTurns = useCallback(() => {
  if (isLoadingOlderHistoryRef.current || !hasMoreHistoryRef.current) {
    return;
  }
  isLoadingOlderHistoryRef.current = true;
  void fetchChatHistory(sessionId, { before: nextBeforeRef.current }).then(
    (page) => {
      isLoadingOlderHistoryRef.current = false;
      if (!page) {
        return;
      }
      hasMoreHistoryRef.current = page.hasMore;
      nextBeforeRef.current = page.nextBefore;
      setMessages((current) => {
        const seenIds = new Set(current.map((message) => message.id));
        const fresh = page.turns
          .filter((turn) => !seenIds.has(turn.id))
          .map(toUIMessage);
        return [...fresh, ...current];
      });
    },
  );
}, [sessionId, setMessages]);
```

The in-flight/`has_more` guard and the id-dedup both live here, in the one
place that owns the cursor — `chat-panel.tsx` never needs to know about
`has_more` or `next_before` at all; it only ever calls `loadOlderTurns()` and
trusts it to no-op when there is nothing to do. Pass it down as
`onLoadOlderTurnsAction` alongside the other `...Action` props already wired at
`ai-chatbot-demo.tsx:688-703`.

**Step 4 — detect the top of the viewport, in `chat-panel.tsx`.** There is no
scroll listener in this file today — only the auto-scroll effect. Add one,
once, on mount:

```ts
useEffect(() => {
  const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  );
  if (!viewport) return;
  function handleScroll() {
    if (viewport.scrollTop < 200) {
      onLoadOlderTurnsAction();
    }
  }
  viewport.addEventListener("scroll", handleScroll, { passive: true });
  return () => viewport.removeEventListener("scroll", handleScroll);
}, [onLoadOlderTurnsAction]);
```

200px rather than 0 so the page arrives before the reader hits the physical
top. Calling `onLoadOlderTurnsAction()` on every qualifying scroll event is
fine precisely because step 3 makes it a safe no-op — the guard is the
parent's job, not this listener's.

**Step 5 — rewrite the auto-scroll effect to distinguish prepend from append,
and switch it to `useLayoutEffect`.** The existing effect
(`chat-panel.tsx:72-82`) unconditionally sets `viewport.scrollTop =
viewport.scrollHeight` in a plain `useEffect`, keyed on `[turns, isStreaming,
pendingCalls]`. Prepending changes `turns`, so today this would yank the view
back to the bottom on every history page. Fix both problems together — the
distinction belongs _here_, not in `ai-chatbot-demo.tsx`, since only this
component has the DOM ref, and only a layout effect (not a post-paint
`useEffect`) avoids a visible flash of the pinned-to-bottom position before the
correction lands:

```ts
const previousFirstTurnIdRef = useRef<string | undefined>(undefined);
const previousScrollHeightRef = useRef(0);

useLayoutEffect(() => {
  const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  );
  if (!viewport) return;

  const currentFirstId = turns[0]?.id;
  const previousFirstId = previousFirstTurnIdRef.current;
  const isPrepend =
    previousFirstId !== undefined &&
    currentFirstId !== previousFirstId &&
    turns.some((turn) => turn.id === previousFirstId);

  if (isPrepend) {
    viewport.scrollTop +=
      viewport.scrollHeight - previousScrollHeightRef.current;
  } else {
    viewport.scrollTop = viewport.scrollHeight;
  }

  previousFirstTurnIdRef.current = currentFirstId;
  previousScrollHeightRef.current = viewport.scrollHeight;
}, [turns, isStreaming, pendingCalls]);
```

The `turns.some(...)` check is what tells a real prepend (old first turn still
present, just no longer first) apart from a wholesale replacement of the list;
without it, any turns-identity change would be misread as a prepend. The first
time `turns` goes from empty to non-empty — the cold load from step 2 —
`previousFirstId` is `undefined`, so this correctly falls into the `else`
branch and pins to the bottom of the restored page, matching "someone
rejoining a conversation wants where they left off."

**Step 6 — suppress the live region for the duration of a prepend, entirely
inside `chat-panel.tsx`.** The message list is `role="log" aria-live="polite"`
(`chat-panel.tsx:130`); prepending would announce old turns as if they just
arrived. Rather than threading a loading flag down from the parent (whose
async timing does not line up with the paint that inserts the DOM nodes), keep
this local: add `const [suppressLiveRegion, setSuppressLiveRegion] =
useState(false)`, set it `true` inside the `isPrepend` branch above — React
flushes that state update before the browser paints, since it's set from a
layout effect — and flip it back in a plain `useEffect` keyed on
`suppressLiveRegion` (runs after paint). Render `aria-live={suppressLiveRegion
? "off" : "polite"}` instead of the hard-coded `"polite"` at line 130.

Ids are stable across requests, so the dedup in step 3 makes a double-fire of
step 4 harmless rather than a duplicated page.

**Should this use a library? No — hand-roll it, matching what's here.**
Two different problems get conflated under "infinite scroll," and only the
second one is hard: _triggering a load near the top_ (step 4, easy, ~10 lines)
and _keeping the reader's scroll position stable while content is inserted
above them_ (step 5, the real problem, ~25 lines). Neither needs a
virtualization library:

- `package.json` has no scrolling/virtualization dependency today (no
  `react-window`, `react-virtuoso`, `@tanstack/react-virtual` — just
  `radix-ui`/shadcn primitives). Adding one is a genuinely new dependency, not
  reuse of something already loaded.
- The list this renders is small by contract: `limit` caps a page at 50
  exchanges, the default is 10, and the messages themselves are heterogeneous
  — markdown bubbles, `DeferredCallCard`, `SuggestionChips`, `StarterQuestions`
  all interleave inside the one `role="log"` region
  (`chat-panel.tsx:151-225`). That rules out the one library actually built for
  this exact problem, `react-virtuoso`'s `VirtuosoMessageList` (its imperative
  `prepend` API keeps scroll position stable automatically) — adopting it
  means handing all that heterogeneous rendering to its item-renderer API, a
  rewrite for a list that never gets big enough to need virtualizing.
- Plain "infinite scroll" packages (`react-infinite-scroll-component` and
  similar) only solve the _trigger_ half, and only for scrolling toward the
  bottom — they do nothing for keeping position stable while content is
  inserted above the reader, which is the actual problem here.
- CSS `overflow-anchor` alone is not a real option either: as of September
  2026 it ships in Chrome, Firefox, and Edge but in no shipping Safari release
  (desktop or iOS) — only Safari Technology Preview has it. A public demo
  cannot rely on it as the only mechanism, and once the JS fix in step 5
  exists for Safari, `overflow-anchor` would be redundant with it everywhere
  else — it is not worth adding even as a supplement.

Net: no new dependency. The five steps above are the whole implementation.

**What it deliberately leaves out:** tool calls and the passages they returned.
Those are how an answer was reached rather than part of it, and the inspector
panel is fed from the live stream — so a restored conversation shows the
messages but an empty inspector. The rolling summary is excluded too; it is
written for the model and would otherwise read as things the visitor and the
assistant said.

**Refusals come back as ordinary assistant turns.** The scope gate's answers are
part of what the visitor saw, so they are recorded and replayed like any other.

### 3b. The sources panel

Everything the visitor added lived only in the response to the request that
added it, so a refresh emptied the panel while the session still held — and
still answered from — those documents.

```
GET /api/ziza/knowledge/{session_id}
```

```json
{
  "session_id": "769fec48-…",
  "documents_used": 2,
  "documents_allowed": 10,
  "sources": [
    {
      "document": "handbook.pdf",
      "kind": "file",
      "chunks": 9,
      "added_at": "2026-09-13T04:21:00Z"
    },
    {
      "document": "https://innovationisttech.com/",
      "kind": "url",
      "chunks": 4,
      "added_at": "2026-09-13T04:22:00Z"
    }
  ]
}
```

Same path as the existing `DELETE`, so there is one URL for "what is in this
session" and "throw it away". The `sources` state already exists in
`ai-chatbot-demo.tsx`; this fills it rather than introducing anything new.

**`kind` is `"file"` or `"url"`**, matching the existing `SourceKind` union. It
is derived from the document's name, because that name is the document's
identity either way — a URL for a page, a filename for an upload.

**`document` is the identity, not the display label.** For a file it is the
filename; for a page it is the URL as the visitor submitted it, not the one it
redirected to. `KnowledgeIngestResponse.source` is a friendlier label
(`"The Guide (https://…)"`). The two differ on purpose, and rows should be keyed
on `document`.

### What it deliberately does not return

The per-source extras the panel shows live — images described, images failed,
pages summarised — are not in it. They are only reconstructible by parsing
display strings like `"handbook.pdf (page 3, image)"`, which would tie the API
to a label format that exists for humans to read.

So a restored row shows the source, its kind, its size and when it was added,
but not those counts: `describeImages` will render nothing for restored rows.
That is a known gap rather than a bug. If the panel needs them after a reload,
say so and they get stored properly at ingest instead of inferred.

---

## 4. Already built — the suggestion chips

`suggestion-chips.tsx` handles both kinds correctly. **Superseded in part by
section 1**, which replaces the fixed kicker above an `ask` chip with the
category the backend now sends; the rest of this section still holds.

| `kind`     | Fires when                                                       | Kicker         |
| ---------- | ---------------------------------------------------------------- | -------------- |
| `add_page` | retrieval **failed** — gate refused, or search found nothing     | `try instead`  |
| `ask`      | retrieval **succeeded** and a grader judged a follow-up worth it | `worth asking` |

The `ask` kicker is now the fallback rather than the default — what renders
above the chip is the suggestion's own `category` whenever it has one.

The keyed lookup with a `FALLBACK_KICKER` is right: `kind` is an open string
server-side and more kinds may come. Grouping by kind is more defensive than the
contract requires — the two triggers are mutually exclusive, so a turn emits one
kind or neither — but it costs nothing and survives that invariant changing.

Same chip treatment for both kinds is also right. The success-or-failure framing
is already carried by the reply sitting directly above the chip, and giving
`add_page` a warmer treatment would borrow the destructive-approval colour
vocabulary from `deferred-call-card.tsx` (`border-destructive/40`), which should
stay reserved for actions with real stakes.

**Keep them distinct from deferred calls.** That is the distinction that
matters, and it is correct today: a deferred call is a bordered, filled
`role="group"` card with a button pair that sits at the foot of the conversation
until answered — a standing gate, where ignoring it means the action never
happens. A suggestion is borderless, lives inside the last turn, and vanishes on
the next send. Blocking versus optional, expressed as weight.

---

## 5. Already built — starter questions

Returned on the ingest response, and readable back at
`GET /api/ziza/knowledge/{session_id}/suggestions` for the reload case.
`fetchStarterQuestions` and the `StarterQuestions` component cover both — and
cover section 1's headings too, since the card already renders `category`.

Three backend properties worth knowing, because they explain behaviour that
otherwise looks like a bug:

**Zero is the normal outcome, not a failure.** They are only offered for
documents that answer things. A call script, an interview guide, a form or a
checklist is built out of _open_ questions — the document records them precisely
because nobody knows the answers yet — so a grader reads the document and drops
candidates it merely asks. A real call script yields none at all. Render an
empty array as "no chips", never as an error.

**Offered once per session, then retired permanently.** The moment the visitor
sends anything — a chip, a typed question, even a message the scope gate goes on
to refuse — they are gone for that session, and a later upload produces none.

That makes the mid-conversation render at `chat-panel.tsx:205` unreachable in
practice: `showStarterQuestions` can only be true while `turns.length === 0`,
because the array is empty by then. Harmless, and worth leaving rather than
deleting — it is the correct rendering if that policy is ever relaxed.

**There is no persistent event stream.** `/chat/stream` is a POST returning a
`StreamingResponse`, opened per message and closed when that answer finishes.
Before the first message — exactly when a fresh upload happens — no stream
exists at all. Anything that must reach the client outside a chat turn comes
back on its own request, which is why these ride the ingest response rather than
a frame.

One consequence: the upload response is ~1–2s slower than it used to be, because
it waits for the question-writing call and a retrieval check. That is
deliberate. The questions are most useful at the moment the upload completes,
and returning early would leave the panel holding a source with no questions and
no way to know whether any were coming.

---

## 6. Already built — documents are the only upload surface

`POST /api/ziza/knowledge` (raw text) and `POST /api/ziza/knowledge/url` are
gone, along with the upload-side link picker. URLs now arrive through chat: the
visitor types or pastes one — **bare domains like `xyz.com` work**, the
classifier extracts it — and the existing deferred-call flow fetches the page
and asks which linked pages to index, resolved through `POST /chat/links`.

The complete surface. Everything else 404s:

```
POST   /api/ziza/chat
POST   /api/ziza/chat/stream
POST   /api/ziza/chat/approval
POST   /api/ziza/chat/links
POST   /api/ziza/knowledge/file
GET    /api/ziza/chat/{session_id}/history           ← section 3a
GET    /api/ziza/knowledge/{session_id}              ← section 3b
GET    /api/ziza/knowledge/{session_id}/suggestions
DELETE /api/ziza/knowledge/{session_id}
```

`POST /api/ziza/chat` is not called by this frontend — the BFF uses
`/chat/stream` only. It still exists and is still tested; noted so nobody wires
it by mistake.
