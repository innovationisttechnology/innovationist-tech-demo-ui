import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SourcesPanel } from "./sources-panel";

function renderPanel(
  overrides: Partial<Parameters<typeof SourcesPanel>[0]> = {},
) {
  const onAddFileAction = vi.fn();
  render(
    <SourcesPanel
      sources={[]}
      activeSourceLabels={[]}
      isReady
      elapsedTick={0}
      onAddFileAction={onAddFileAction}
      onClearAllAction={vi.fn()}
      {...overrides}
    />,
  );
  return { onAddFileAction };
}

function textFile(name: string, contents = "hello") {
  return new File([contents], name, { type: "text/plain" });
}

describe("the sources panel", () => {
  it("offers documents as the only way in", () => {
    renderPanel();
    expect(screen.getByText("Add documents")).toBeInTheDocument();
    expect(screen.queryByLabelText("Source text")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Website URL")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Source type")).not.toBeInTheDocument();
  });

  // One POST per file — there is no batch endpoint — so the panel has to fan
  // the selection out rather than hand over an array.
  it("sends each selected file separately", async () => {
    const { onAddFileAction } = renderPanel();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    await userEvent.upload(input!, [textFile("one.md"), textFile("two.md")]);

    expect(onAddFileAction).toHaveBeenCalledTimes(2);
    expect(onAddFileAction.mock.calls.map(([file]) => file.name)).toEqual([
      "one.md",
      "two.md",
    ]);
  });

  // A rejected file must not take the valid ones down with it. The empty file
  // is the case worth testing: a wrong extension is already filtered by the
  // picker's `accept`, but an empty `.md` gets through and only `validateFile`
  // catches it.
  it("uploads the good files and explains the rejected one", async () => {
    const { onAddFileAction } = renderPanel();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');

    await userEvent.upload(input!, [
      textFile("fine.md"),
      textFile("empty.md", ""),
    ]);

    expect(onAddFileAction).toHaveBeenCalledTimes(1);
    expect(onAddFileAction.mock.calls[0][0].name).toBe("fine.md");
    expect(screen.getByRole("status")).toHaveTextContent("empty.md");
  });

  it("holds uploads until the session is ready", async () => {
    const { onAddFileAction } = renderPanel({ isReady: false });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');

    await userEvent.upload(input!, textFile("one.md"));

    expect(onAddFileAction).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("session");
  });

  it("explains how the system works while there is nothing to show", () => {
    renderPanel();
    expect(screen.getByText("No sources")).toBeInTheDocument();
    expect(
      screen.getByText(/Upload a document to get started/),
    ).toBeInTheDocument();
  });

  it("lists what the session holds once there is something", () => {
    renderPanel({
      sources: [
        {
          id: "1",
          label: "handbook.pdf",
          kind: "file",
          chunkCount: 12,
          status: "indexed",
        },
      ],
    });
    expect(screen.getByText("handbook.pdf")).toBeInTheDocument();
    expect(screen.getByText(/12 chunks/)).toBeInTheDocument();
  });
});
