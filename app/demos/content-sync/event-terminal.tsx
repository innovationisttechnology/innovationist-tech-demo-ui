"use client";

import { useEffect, useRef } from "react";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr";

export type StreamEvent = {
  id: number;
  time: string;
  channel: string;
  data?: string;
  tone: "open" | "create" | "enable" | "disable" | "delete" | "ping";
};

const TONE_CLASS: Record<StreamEvent["tone"], string> = {
  open: "text-sky-600 dark:text-sky-300",
  create: "text-teal-600 dark:text-teal-300",
  enable: "text-emerald-600 dark:text-emerald-300",
  disable: "text-amber-600 dark:text-amber-300",
  delete: "text-rose-600 dark:text-rose-300",
  ping: "text-muted-foreground",
};

export function EventTerminal({
  events,
  onClear,
}: {
  events: readonly StreamEvent[];
  onClear?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [events]);

  return (
    <div className="border-border bg-card flex h-full min-h-72 flex-col overflow-hidden rounded-lg border">
      <header className="border-border text-muted-foreground flex items-center justify-between border-b px-4 py-2.5 font-mono text-[0.625rem] tracking-widest uppercase">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-rose-400/70" />
          <span className="size-2 rounded-full bg-amber-400/70" />
          <span className="size-2 rounded-full bg-emerald-400/70" />
          <span className="ml-2">EventSource</span>
        </span>
        <div className="flex items-center gap-3">
          <span className="text-primary/70">/api/flags/stream</span>
          <button
            type="button"
            onClick={() => onClear?.()}
            className="hover:text-foreground flex items-center gap-1 tracking-widest uppercase transition-colors"
          >
            <TrashIcon className="size-3" />
            clear
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
      >
        {events.map((event) =>
          event.tone === "ping" ? (
            <p key={event.id} className="text-muted-foreground/60">
              <span className="text-muted-foreground/50">{event.time}</span> :
              keep-alive
            </p>
          ) : (
            <div key={event.id}>
              <p>
                <span className="text-muted-foreground/70">{event.time} </span>
                <span className={TONE_CLASS[event.tone]}>
                  event: {event.channel}
                </span>
              </p>
              {event.data ? (
                <p className="text-muted-foreground pl-[5.5ch]">
                  data: <span className="text-foreground/80">{event.data}</span>
                </p>
              ) : null}
            </div>
          ),
        )}
        <p className="text-primary">
          <span className="inline-block animate-pulse">▍</span>
        </p>
      </div>
    </div>
  );
}
