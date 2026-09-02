"use client";

import { PulseIcon, StackIcon, TrashIcon } from "@phosphor-icons/react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type InspectorEntry,
  type RetrievedChunk,
} from "@/lib/ziza/ziza.types";

const LEVEL_CLASS: Record<InspectorEntry["level"], string> = {
  open: "text-sky-600 dark:text-sky-300",
  info: "text-teal-600 dark:text-teal-300",
  tool: "text-violet-600 dark:text-violet-300",
  error: "text-rose-600 dark:text-rose-300",
  done: "text-muted-foreground",
};

type InspectorPanelProps = {
  entries: readonly InspectorEntry[];
  chunks: readonly RetrievedChunk[];
  onClearAction: () => void;
};

export function InspectorPanel({
  entries,
  chunks,
  onClearAction,
}: InspectorPanelProps) {
  return (
    <section
      className="flex h-full flex-col overflow-hidden"
      aria-label="Agent inspector"
    >
      <Tabs
        defaultValue="stream"
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <header className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
          {/*
            Stock shadcn tabs, `line` variant — transparent track with an
            underline on the active trigger. No style overrides; TabsTrigger
            already ships uppercase + tracking.
          */}
          <TabsList variant="line">
            <TabsTrigger value="stream">Stream</TabsTrigger>
            <TabsTrigger value="chunks">Chunks</TabsTrigger>
          </TabsList>
          <button
            type="button"
            onClick={onClearAction}
            aria-label="Clear inspector"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <TrashIcon className="size-3" />
          </button>
        </header>

        <TabsContent value="stream" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-1.5 p-3 font-mono text-[0.6875rem] leading-relaxed">
              {entries.length === 0 ? (
                <Empty className="p-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PulseIcon weight="duotone" />
                    </EmptyMedia>
                    <EmptyTitle className="font-mono text-xs tracking-widest uppercase">
                      Idle
                    </EmptyTitle>
                    <EmptyDescription className="font-mono text-[0.6875rem]">
                      Events show up here as they come in.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                entries.map((entry) => (
                  <div key={entry.id}>
                    <p>
                      <span className="text-muted-foreground/70">
                        {entry.time}{" "}
                      </span>
                      <span className={LEVEL_CLASS[entry.level]}>
                        {entry.label}
                      </span>
                    </p>
                    {entry.detail ? (
                      <p className="text-muted-foreground pl-[5.5ch] break-all">
                        {entry.detail}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="chunks" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              {chunks.length === 0 ? (
                <Empty className="p-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <StackIcon weight="duotone" />
                    </EmptyMedia>
                    <EmptyTitle className="font-mono text-xs tracking-widest uppercase">
                      No passages yet
                    </EmptyTitle>
                    <EmptyDescription className="font-mono text-[0.6875rem]">
                      Once it searches, the passages it found land here with
                      their source and score.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                chunks.map((chunk) => (
                  <article
                    key={chunk.id}
                    className="border-border bg-card rounded-md border p-2.5"
                  >
                    <header className="text-muted-foreground mb-1.5 flex items-center justify-between font-mono text-[0.625rem] tracking-wide uppercase">
                      <span className="truncate">{chunk.source}</span>
                      <span className="text-primary shrink-0">
                        {chunk.score.toFixed(2)}
                      </span>
                    </header>
                    <p className="font-sans text-xs leading-relaxed">
                      {chunk.text}
                    </p>
                  </article>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </section>
  );
}
