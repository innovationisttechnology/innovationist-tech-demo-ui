"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  createFlag,
  deleteFlag,
  fetchFlags,
  flagsStreamUrl,
  updateFlag,
} from "@/lib/content-sync/content-sync.service";
import { toSyncFlag } from "@/lib/content-sync/content-sync.mapper";
import {
  SyncEventSchema,
  type SyncEvent,
} from "@/lib/content-sync/content-sync.schema";
import { type SyncFlag } from "@/lib/content-sync/content-sync.types";
import { getSessionId } from "@/lib/content-sync/session";
import { SignalChart, type SignalFlag, type SignalStyle } from "./signal-chart";
import { EventTerminal, type StreamEvent } from "./event-terminal";

type Flag = {
  key: string;
  text: string;
  enabled: boolean;
  color: string;
  zeta: number;
  amplitude: number;
  style: SignalStyle;
};

// The first colour uses the theme primary so the green matches the buttons.
const PALETTE = [
  "var(--primary)",
  "#0284c7",
  "#6366f1",
  "#d97706",
  "#db2777",
  "#0891b2",
];

const CURVE_PRESETS: readonly {
  zeta: number;
  amplitude: number;
  style: SignalStyle;
}[] = [
  { zeta: 0, amplitude: 0.45, style: "dotted" },
  { zeta: 0.1, amplitude: 0.45, style: "solid" },
  { zeta: 1, amplitude: 0.7, style: "circles" },
  { zeta: 0.05, amplitude: 0.6, style: "solid" },
  { zeta: 0.3, amplitude: 0.5, style: "dotted" },
  { zeta: 0.6, amplitude: 0.6, style: "circles" },
];

const STREAM_EVENT_NAMES = [
  "flag.snapshot",
  "flag.created",
  "flag.updated",
  "flag.deleted",
] as const;

// Seeded once for a brand-new session so the chart isn't empty on first visit.
const DEFAULT_FLAG = "welcome";

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function parseStreamEvent(raw: string): SyncEvent | null {
  try {
    const parsed = SyncEventSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function ContentSyncDemo() {
  const [flags, setFlags] = useState<readonly Flag[]>([]);
  const [events, setEvents] = useState<readonly StreamEvent[]>([]);
  const [draft, setDraft] = useState("");
  const sessionIdRef = useRef("");
  const nextEventId = useRef(0);
  // Assign each flag key a stable visual style on first sight, so colours and
  // curves stay put across snapshots and reconnects.
  const vizIndexByKey = useRef(new Map<string, number>());
  const nextVizIndex = useRef(0);

  function vizFor(key: string) {
    let index = vizIndexByKey.current.get(key);
    if (index === undefined) {
      index = nextVizIndex.current++;
      vizIndexByKey.current.set(key, index);
    }
    const preset = CURVE_PRESETS[index % CURVE_PRESETS.length];
    return { color: PALETTE[index % PALETTE.length], ...preset };
  }

  function toLocalFlag(syncFlag: SyncFlag): Flag {
    return {
      key: syncFlag.key,
      text: syncFlag.key,
      enabled: syncFlag.enabled,
      ...vizFor(syncFlag.key),
    };
  }

  function pushEvent(
    tone: StreamEvent["tone"],
    channel: string,
    data?: Record<string, unknown>,
  ) {
    setEvents((current) =>
      [
        ...current,
        {
          id: nextEventId.current++,
          time: formatTime(),
          channel,
          tone,
          data: data ? JSON.stringify(data) : undefined,
        },
      ].slice(-60),
    );
  }

  function applyStreamEvent(event: SyncEvent) {
    switch (event.type) {
      case "flag.snapshot":
        setFlags(
          event.flags.map((apiFlag) => toLocalFlag(toSyncFlag(apiFlag))),
        );
        pushEvent("open", "flag.snapshot", { count: event.flags.length });
        break;
      case "flag.created":
        if (event.flag) {
          const created = toSyncFlag(event.flag);
          setFlags((current) =>
            current.some((flag) => flag.key === created.key)
              ? current
              : [...current, toLocalFlag(created)],
          );
        }
        pushEvent("create", "flag.created", { key: event.key });
        break;
      case "flag.updated":
        if (event.flag) {
          const updated = toSyncFlag(event.flag);
          setFlags((current) =>
            current.map((flag) =>
              flag.key === updated.key ? toLocalFlag(updated) : flag,
            ),
          );
          pushEvent(updated.enabled ? "enable" : "disable", "flag.updated", {
            key: event.key,
            enabled: updated.enabled,
          });
        }
        break;
      case "flag.deleted":
        setFlags((current) => current.filter((flag) => flag.key !== event.key));
        pushEvent("delete", "flag.deleted", { key: event.key });
        break;
    }
  }

  useEffect(() => {
    let active = true;
    let source: EventSource | undefined;

    async function connect() {
      const sessionId = await getSessionId();
      if (!active || !sessionId) {
        return;
      }
      sessionIdRef.current = sessionId;

      const initial = await fetchFlags(sessionId);
      if (!active) {
        return;
      }
      if (initial.length) {
        setFlags(initial.map(toLocalFlag));
      } else {
        // New session: seed a default flag. The stream's snapshot on connect
        // then reflects it (a duplicate create just 409s and is ignored).
        await createFlag(sessionId, {
          key: DEFAULT_FLAG,
          value: DEFAULT_FLAG,
          enabled: true,
        });
        if (!active) {
          return;
        }
      }

      source = new EventSource(flagsStreamUrl(sessionId));
      source.onopen = () =>
        pushEvent("open", "stream.open", { url: "/api/flags/stream" });
      for (const name of STREAM_EVENT_NAMES) {
        source.addEventListener(name, (message) => {
          const parsed = parseStreamEvent(message.data);
          if (parsed) {
            applyStreamEvent(parsed);
          }
        });
      }
    }

    connect();
    return () => {
      active = false;
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = draft.trim();
    if (!word || !sessionIdRef.current) {
      return;
    }
    setDraft("");
    await createFlag(sessionIdRef.current, {
      key: word,
      value: word,
      enabled: true,
    });
  }

  async function handleToggle(targetKey: string) {
    const flag = flags.find((candidate) => candidate.key === targetKey);
    if (!flag || !sessionIdRef.current) {
      return;
    }
    await updateFlag(sessionIdRef.current, targetKey, {
      enabled: !flag.enabled,
    });
  }

  async function handleRemove(targetKey: string) {
    if (!sessionIdRef.current) {
      return;
    }
    await deleteFlag(sessionIdRef.current, targetKey);
  }

  const activeSignals: SignalFlag[] = flags
    .filter((flag) => flag.enabled)
    .map((flag) => ({
      key: flag.key,
      text: flag.text,
      color: flag.color,
      zeta: flag.zeta,
      amplitude: flag.amplitude,
      style: flag.style,
    }));

  return (
    <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr] lg:items-stretch">
      <div className="flex flex-col gap-4">
        <SignalChart flags={activeSignals} />

        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a word and press Enter…"
            aria-label="New flag word"
            className="border-border bg-background focus-visible:ring-ring/50 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
          />
          <Button type="submit">
            <PlusIcon weight="bold" data-icon="inline-start" />
            Add flag
          </Button>
        </form>

        <div className="flex flex-wrap gap-2">
          {flags.map((flag) => (
            <div
              key={flag.key}
              className="border-border bg-card flex items-center gap-2 rounded-md border py-1 pr-1 pl-2"
            >
              <button
                type="button"
                role="switch"
                aria-checked={flag.enabled}
                aria-label={`Toggle ${flag.text}`}
                onClick={() => handleToggle(flag.key)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  flag.enabled ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`bg-background absolute top-0.5 left-0.5 size-4 rounded-full shadow transition-transform ${
                    flag.enabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <span
                className={`font-sans text-sm ${
                  flag.enabled
                    ? "text-foreground"
                    : "text-muted-foreground line-through"
                }`}
              >
                {flag.text}
              </span>
              <button
                type="button"
                aria-label={`Remove ${flag.text}`}
                onClick={() => handleRemove(flag.key)}
                className="text-muted-foreground hover:text-destructive hover:bg-muted flex size-6 items-center justify-center rounded transition-colors"
              >
                <TrashIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <EventTerminal events={events} onClear={() => setEvents([])} />
    </div>
  );
}
