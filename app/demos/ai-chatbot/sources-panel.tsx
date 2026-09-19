"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  FileArrowUpIcon,
  FileTextIcon,
  ImageIcon,
  LinkIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  MAX_UPLOAD_BYTES,
  SUPPORTED_UPLOAD_EXTENSIONS,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "@/lib/ziza/ziza.service";
import { type KnowledgeSource } from "@/lib/ziza/ziza.types";

const STATUS_LABEL: Record<KnowledgeSource["status"], string> = {
  uploading: "uploading…",
  processing: "extracting…",
  indexed: "indexed",
  "pending-index": "indexing…",
  failed: "failed",
};

const STATUS_CLASS: Record<KnowledgeSource["status"], string> = {
  uploading: "text-sky-600 dark:text-sky-300",
  processing: "text-amber-600 dark:text-amber-300",
  indexed: "text-emerald-600 dark:text-emerald-300",
  "pending-index": "text-sky-600 dark:text-sky-300",
  failed: "text-rose-600 dark:text-rose-300",
};

// Rotating, because everything this demo can do beyond uploading happens in
// the chat, and a panel with one file button has no way to say so.
const EMPTY_HINTS = [
  "Upload a document to get started — text, Markdown, CSV, JSON, PDF, DOCX, or an image.",
  "Drag files straight onto this panel, as many at once as you like.",
  "Paste a link in the chat instead, and Ziza offers to index that page along with the pages it links to.",
  "Answers come only from what is in here. Nothing added means nothing to answer from.",
  "Ask it to clear the knowledge base and it will ask you to confirm before anything is deleted.",
];

const HINT_ROTATION_MS = 7000;

function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Deliberately permissive on extension: the server decides by sniffing the
// file's bytes, so a valid PDF named `.dat` must reach it.
function validateFile(file: File): string | undefined {
  if (file.size === 0) {
    return "There is nothing in that file.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${formatMegabytes(file.size)}. The cap is ${formatMegabytes(MAX_UPLOAD_BYTES)}.`;
  }
  const extension = extensionOf(file.name);
  const isKnownExtension = (
    SUPPORTED_UPLOAD_EXTENSIONS as readonly string[]
  ).includes(extension);
  if (extension && !isKnownExtension) {
    return `We can't read ${extension} files. Try text, Markdown, CSV, JSON, YAML, PDF, DOCX, or an image.`;
  }
  return undefined;
}

function describeExtras(source: KnowledgeSource): string | undefined {
  if (source.kind === "url") {
    return source.pagesSummarised ? "page summary" : undefined;
  }
  return describeImages(source);
}

function describeImages(source: KnowledgeSource): string | undefined {
  const described = source.imagesDescribed ?? 0;
  const skipped = source.imagesSkipped ?? 0;
  const failed = source.imagesFailed ?? 0;
  if (described + skipped + failed === 0) {
    return undefined;
  }
  const parts = [`${described} images`];
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }
  return parts.join(", ");
}

function SourceIcon({
  source,
  isActive,
  hasImages,
}: {
  source: KnowledgeSource;
  isActive: boolean;
  hasImages: boolean;
}) {
  const tone = isActive ? "text-primary" : "text-muted-foreground";
  if (source.status === "failed") {
    return (
      <WarningIcon
        weight="duotone"
        className="text-destructive size-4 shrink-0"
      />
    );
  }
  if (source.kind === "url") {
    return <LinkIcon weight="duotone" className={`size-4 shrink-0 ${tone}`} />;
  }
  if (hasImages) {
    return <ImageIcon weight="duotone" className={`size-4 shrink-0 ${tone}`} />;
  }
  return (
    <FileTextIcon weight="duotone" className={`size-4 shrink-0 ${tone}`} />
  );
}

function carriesFiles(transfer: DataTransfer | null): boolean {
  return transfer !== null && Array.from(transfer.types).includes("Files");
}

// `webkitGetAsEntry` is only valid synchronously inside the drop handler — the
// items are neutered the moment it returns — so this cannot be deferred.
function droppedFolderNames(transfer: DataTransfer): string[] {
  return Array.from(transfer.items)
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter(
      (entry): entry is FileSystemEntry => entry !== null && entry.isDirectory,
    )
    .map((entry) => entry.name);
}

type SourcesPanelProps = {
  sources: readonly KnowledgeSource[];
  activeSourceLabels: readonly string[];
  isReady: boolean;
  elapsedTick: number;
  capacity?: { used: number; allowed: number };
  onAddFileAction: (file: File) => void;
  onClearAllAction: () => void;
};

export function SourcesPanel({
  sources,
  activeSourceLabels,
  isReady,
  elapsedTick,
  capacity,
  onAddFileAction,
  onClearAllAction,
}: SourcesPanelProps) {
  const [notice, setNotice] = useState("");
  const [hintIndex, setHintIndex] = useState(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // dragenter/dragleave re-fire for every descendant the pointer crosses, so a
  // boolean would strobe the overlay. Depth does not.
  const dragDepth = useRef(0);

  const isEmpty = sources.length === 0;

  useEffect(() => {
    if (!isEmpty) {
      return;
    }
    const rotation = setInterval(
      () => setHintIndex((current) => (current + 1) % EMPTY_HINTS.length),
      HINT_ROTATION_MS,
    );
    return () => clearInterval(rotation);
  }, [isEmpty]);

  // A file dropped anywhere else on the page navigates the tab to it, ending
  // the session. Nothing else here accepts a drop, so refuse it document-wide.
  useEffect(() => {
    const swallowDrop = (event: Event) => event.preventDefault();
    window.addEventListener("dragover", swallowDrop);
    window.addEventListener("drop", swallowDrop);
    return () => {
      window.removeEventListener("dragover", swallowDrop);
      window.removeEventListener("drop", swallowDrop);
    };
  }, []);

  function addFiles(files: readonly File[], folders: readonly string[] = []) {
    if (files.length === 0 && folders.length === 0) {
      return;
    }
    if (!isReady) {
      setNotice("Still setting up your session. Give it a second.");
      return;
    }

    const rejected = folders.map(
      (folder) => `${folder}: drop the files inside, not the folder.`,
    );
    for (const file of files) {
      const problem = validateFile(file);
      if (problem) {
        rejected.push(`${file.name}: ${problem}`);
        continue;
      }
      onAddFileAction(file);
    }
    setNotice(rejected.join(" "));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    // Clearing the input lets the same filename be re-picked after removal;
    // without it the browser sees no change and never fires again.
    event.target.value = "";
    addFiles(selected);
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepth.current += 1;
    setIsDraggingOver(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event.dataTransfer)) {
      return;
    }
    // Without this the drop never fires and the browser opens the file.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event.dataTransfer)) {
      return;
    }
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDraggingOver(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepth.current = 0;
    setIsDraggingOver(false);

    const folders = droppedFolderNames(event.dataTransfer);
    const files = Array.from(event.dataTransfer.files).filter(
      (file) => !folders.includes(file.name),
    );
    addFiles(files, folders);
  }

  return (
    // The whole panel is the target, not just the picker: aiming at a small
    // control is the part of dragging people get wrong.
    <section
      className="relative flex h-full min-w-0 flex-col overflow-hidden"
      aria-label="Knowledge base sources"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/*
        pointer-events-none is load-bearing: an overlay that takes pointer
        events fires dragleave the instant it renders, and the highlight
        strobes under the cursor.
      */}
      {isDraggingOver ? (
        <div className="border-primary bg-background/85 pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed">
          <FileArrowUpIcon weight="duotone" className="text-primary size-6" />
          <span className="text-primary font-mono text-[0.625rem] tracking-widest uppercase">
            Drop to add
          </span>
        </div>
      ) : null}

      <header className="border-border text-muted-foreground flex shrink-0 items-center justify-between border-b px-3 py-2.5 font-mono text-[0.625rem] tracking-widest uppercase">
        <span>Sources</span>
        <span className="flex items-center gap-2">
          {capacity ? (
            <span
              className={
                capacity.used >= capacity.allowed
                  ? "text-destructive"
                  : undefined
              }
            >
              {capacity.used}/{capacity.allowed}
            </span>
          ) : sources.length > 0 ? (
            <span>{sources.length}</span>
          ) : null}
          {sources.length > 0 ? (
            <button
              type="button"
              onClick={onClearAllAction}
              aria-label="Clear all sources"
              className="hover:text-destructive transition-colors"
            >
              <TrashIcon className="size-3" />
            </button>
          ) : null}
        </span>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        {sources.length === 0 ? (
          <Empty className="px-3 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon weight="duotone" />
              </EmptyMedia>
              <EmptyTitle className="font-mono text-xs tracking-widest uppercase">
                No sources
              </EmptyTitle>
              {/*
                Keyed so React swaps the node and replays the fade; no
                aria-live, since text rotating under a screen reader is worse
                than text that simply sits there when they reach it.
              */}
              <EmptyDescription
                key={hintIndex}
                className="animate-in fade-in-0 text-xs duration-500"
              >
                {EMPTY_HINTS[hintIndex]}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="p-2">
            {sources.map((source) => {
              const isActive = activeSourceLabels.includes(source.label);
              const isBusy =
                source.status === "uploading" || source.status === "processing";
              const imageSummary = describeExtras(source);
              // elapsedTick is a prop only to force the per-second re-render.
              const elapsedSeconds =
                isBusy && source.startedAt
                  ? Math.max(
                      0,
                      Math.floor((elapsedTick - source.startedAt) / 1000),
                    )
                  : undefined;
              return (
                <li key={source.id}>
                  <Item
                    size="sm"
                    className={isActive ? "bg-primary/10" : undefined}
                  >
                    <ItemMedia>
                      {isBusy ? (
                        <Spinner className="text-muted-foreground size-4" />
                      ) : (
                        <SourceIcon
                          source={source}
                          isActive={isActive}
                          hasImages={Boolean(source.imagesDescribed)}
                        />
                      )}
                    </ItemMedia>
                    <ItemContent className="min-w-0 gap-0.5">
                      <span className="truncate font-sans text-sm">
                        {source.label}
                      </span>
                      <span className="text-muted-foreground font-mono text-[0.625rem] leading-relaxed">
                        {source.chunkCount > 0
                          ? `${source.chunkCount} chunks · `
                          : ""}
                        {imageSummary ? `${imageSummary} · ` : ""}
                        <span className={STATUS_CLASS[source.status]}>
                          {STATUS_LABEL[source.status]}
                          {elapsedSeconds !== undefined
                            ? ` ${elapsedSeconds}s`
                            : ""}
                        </span>
                      </span>
                      {source.errorDetail ? (
                        <span className="text-destructive font-mono text-[0.625rem] leading-snug break-words">
                          {source.errorDetail}
                        </span>
                      ) : null}
                    </ItemContent>
                  </Item>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      <div className="border-border shrink-0 space-y-2 border-t p-3">
        {/*
          The label wraps the input so there's a single control in the a11y
          tree — a separate button beside a hidden input is announced twice.
        */}
        <label className="border-border hover:border-primary/50 hover:bg-muted/40 has-[:focus-visible]:ring-ring/50 flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-2 py-5 transition-colors has-[:focus-visible]:ring-2">
          <input
            type="file"
            multiple
            onChange={handleFileChange}
            accept={UPLOAD_ACCEPT_ATTRIBUTE}
            className="sr-only"
          />
          <FileArrowUpIcon
            weight="duotone"
            className="text-muted-foreground size-5"
          />
          <span className="text-muted-foreground max-w-full truncate font-sans text-xs">
            Add documents
          </span>
          <span className="text-muted-foreground/70 font-sans text-[0.6875rem]">
            or drag them anywhere in this panel
          </span>
          <span className="text-muted-foreground/70 font-mono text-[0.625rem]">
            {`text · pdf · docx · images · ≤${formatMegabytes(MAX_UPLOAD_BYTES)}`}
          </span>
        </label>

        {notice ? (
          <p
            role="status"
            aria-live="polite"
            className="text-muted-foreground border-border bg-muted/40 rounded-md border px-2 py-1.5 font-mono text-[0.6875rem] leading-snug"
          >
            {notice}
          </p>
        ) : null}
      </div>
    </section>
  );
}
