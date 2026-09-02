"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  FileArrowUpIcon,
  FileTextIcon,
  ImageIcon,
  LinkIcon,
  PlusIcon,
  TextAlignLeftIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_UPLOAD_BYTES,
  MAX_URL_LENGTH,
  SUPPORTED_UPLOAD_EXTENSIONS,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "@/lib/ziza/ziza.service";
import { type KnowledgeSource, type SourceKind } from "@/lib/ziza/ziza.types";

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

const SUBMIT_LABEL: Record<SourceKind, string> = {
  text: "Add source",
  file: "Upload",
  url: "Fetch & add",
};

/**
 * Fast-fail checks mirroring the server's. It rejects private hosts by
 * resolving them, which the browser cannot do — so this only catches the
 * malformed cases and leaves the security decision where it belongs.
 */
function validateUrl(candidate: string): string | undefined {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return "Paste a link first.";
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return `That link is too long. Keep it under ${MAX_URL_LENGTH} characters.`;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That does not look like a link. Start it with https://";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `We can only fetch http and https links, not ${parsed.protocol.replace(":", "")}.`;
  }
  return undefined;
}

function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Client-side pre-checks mirroring the server's guards, so an obviously bad
 * file fails instantly instead of after a 25MB upload.
 *
 * The extension check is deliberately permissive: the server decides for real
 * by sniffing the file's bytes and never trusts a filename, so a valid PDF
 * named `.dat` must reach it rather than being blocked here. Only a recognised
 * wrong extension is rejected.
 */
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

type SourcesPanelProps = {
  sources: readonly KnowledgeSource[];
  activeSourceLabels: readonly string[];
  isReady: boolean;
  elapsedTick: number;
  onAddTextAction: (label: string, text: string) => void;
  onAddFileAction: (file: File) => void;
  onAddUrlAction: (url: string) => void;
  onClearAllAction: () => void;
};

export function SourcesPanel({
  sources,
  activeSourceLabels,
  isReady,
  elapsedTick,
  onAddTextAction,
  onAddFileAction,
  onAddUrlAction,
  onClearAllAction,
}: SourcesPanelProps) {
  const [kind, setKind] = useState<SourceKind>("text");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");

  function handleKindChange(nextKind: string) {
    setKind(nextKind as SourceKind);
    setNotice("");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }
    setFile(selectedFile);
    setNotice(validateFile(selectedFile) ?? "");
  }

  function handleUrlChange(event: ChangeEvent<HTMLInputElement>) {
    setUrl(event.target.value);
    setNotice("");
  }

  // Controls stay enabled — submitting with invalid or unsupported input
  // explains what's wrong rather than silently doing nothing.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isReady) {
      setNotice("Still setting up your session. Give it a second.");
      return;
    }

    if (kind === "url") {
      const problem = validateUrl(url);
      if (problem) {
        setNotice(problem);
        return;
      }
      setNotice("");
      onAddUrlAction(url.trim());
      setUrl("");
      return;
    }

    if (kind === "file") {
      if (!file) {
        setNotice("Pick a file first.");
        return;
      }
      const problem = validateFile(file);
      if (problem) {
        setNotice(problem);
        return;
      }
      setNotice("");
      onAddFileAction(file);
      setFile(null);
      return;
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      setNotice("Paste some text first.");
      return;
    }

    setNotice("");
    onAddTextAction(label.trim() || "untitled", trimmedText);
    setLabel("");
    setText("");
  }

  return (
    <section
      className="flex h-full flex-col overflow-hidden"
      aria-label="Knowledge base sources"
    >
      <header className="border-border text-muted-foreground flex shrink-0 items-center justify-between border-b px-3 py-2.5 font-mono text-[0.625rem] tracking-widest uppercase">
        <span>Sources</span>
        <span className="flex items-center gap-2">
          {sources.length > 0 ? <span>{sources.length}</span> : null}
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
              <EmptyDescription className="text-xs">
                Paste some text, upload a file, or drop in a link. Then ask
                about it.
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
              // elapsedTick is a prop only so this re-renders each second while
              // a long extraction runs — a minute of silence reads as hung.
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
                    <ItemContent className="gap-0.5">
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
                        <span className="text-destructive font-mono text-[0.625rem] leading-snug">
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

      {/* noValidate: `type="url"` would otherwise fire the browser's own
          validation bubble and skip handleSubmit entirely, so the malformed-URL
          case never reached our inline notice — two error UIs for one field. */}
      <form
        noValidate
        onSubmit={handleSubmit}
        className="border-border shrink-0 space-y-2 border-t p-3"
      >
        <Select value={kind} onValueChange={handleKindChange}>
          <SelectTrigger
            size="sm"
            aria-label="Source type"
            className="w-full text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">
              <TextAlignLeftIcon className="size-3.5" />
              Paste text
            </SelectItem>
            <SelectItem value="file">
              <FileArrowUpIcon className="size-3.5" />
              Document upload
            </SelectItem>
            <SelectItem value="url">
              <LinkIcon className="size-3.5" />
              Website URL
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Label only applies to pasted text. /knowledge/file uses the filename
            and /knowledge/url uses the page title, so an editable box on those
            would imply a control that doesn't exist. */}
        {kind === "text" ? (
          <input
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Label (optional)"
            aria-label="Source label"
            className="border-border bg-background focus-visible:ring-ring/50 w-full rounded-md border px-2 py-1.5 font-sans text-xs outline-none focus-visible:ring-2"
          />
        ) : null}

        {kind === "text" ? (
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setNotice("");
            }}
            placeholder="Paste document text…"
            aria-label="Source text"
            rows={4}
            className="border-border bg-background focus-visible:ring-ring/50 w-full resize-none rounded-md border px-2 py-1.5 font-sans text-xs outline-none focus-visible:ring-2"
          />
        ) : null}

        {kind === "file" ? (
          // The label wraps the input so there's a single control in the a11y
          // tree — a visually-hidden input beside a separate button would be
          // announced twice.
          <label className="border-border hover:border-primary/50 hover:bg-muted/40 has-[:focus-visible]:ring-ring/50 flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-2 py-5 transition-colors has-[:focus-visible]:ring-2">
            <input
              type="file"
              onChange={handleFileChange}
              accept={UPLOAD_ACCEPT_ATTRIBUTE}
              className="sr-only"
            />
            <FileArrowUpIcon
              weight="duotone"
              className="text-muted-foreground size-5"
            />
            <span className="text-muted-foreground max-w-full truncate font-sans text-xs">
              {file ? file.name : "Choose a file"}
            </span>
            <span className="text-muted-foreground/70 font-mono text-[0.625rem]">
              {file
                ? formatMegabytes(file.size)
                : `text · pdf · docx · images · ≤${formatMegabytes(MAX_UPLOAD_BYTES)}`}
            </span>
          </label>
        ) : null}

        {kind === "url" ? (
          <input
            type="url"
            value={url}
            onChange={handleUrlChange}
            placeholder="https://example.com/page"
            aria-label="Website URL"
            className="border-border bg-background focus-visible:ring-ring/50 w-full rounded-md border px-2 py-1.5 font-sans text-xs outline-none focus-visible:ring-2"
          />
        ) : null}

        {notice ? (
          <p
            role="status"
            aria-live="polite"
            className="text-muted-foreground border-border bg-muted/40 rounded-md border px-2 py-1.5 font-mono text-[0.6875rem] leading-snug"
          >
            {notice}
          </p>
        ) : null}

        <Button type="submit" size="sm" className="w-full">
          <PlusIcon weight="bold" data-icon="inline-start" />
          {SUBMIT_LABEL[kind]}
        </Button>
      </form>
    </section>
  );
}
