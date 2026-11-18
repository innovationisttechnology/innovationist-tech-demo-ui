import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SourcesPanel } from "./sources-panel";

function renderPanel(
  overrides: Partial<Parameters<typeof SourcesPanel>[0]> = {},
) {
  const onAddFileAction = vi.fn();
  const onRemoveSourceAction = vi.fn();
  const onClearSessionAction = vi.fn();
  render(
    <SourcesPanel
      sources={[]}
      activeSourceIds={[]}
      isReady
      elapsedTick={0}
      onAddFileAction={onAddFileAction}
      onRemoveSourceAction={onRemoveSourceAction}
      onClearSessionAction={onClearSessionAction}
      {...overrides}
    />,
  );
  return { onAddFileAction, onRemoveSourceAction, onClearSessionAction };
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

  it("removes a single document from its own row", async () => {
    const handbook = {
      id: "1",
      sourceId: "src_1",
      label: "handbook.pdf",
      kind: "file" as const,
      chunkCount: 12,
      status: "indexed" as const,
    };
    const { onRemoveSourceAction } = renderPanel({ sources: [handbook] });
    await userEvent.click(
      screen.getByRole("button", { name: "Remove handbook.pdf" }),
    );
    expect(onRemoveSourceAction).toHaveBeenCalledWith(handbook);
  });

  // Until its job finishes there is no source id for ziza to remove.
  it("offers no removal while a document is still being ingested", () => {
    renderPanel({
      sources: [
        {
          id: "1",
          jobId: "job_1",
          label: "handbook.pdf",
          kind: "file",
          chunkCount: 0,
          status: "processing",
          progressLabel: "embedding 3/10",
        },
      ],
    });
    expect(
      screen.queryByRole("button", { name: "Remove handbook.pdf" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("embedding 3/10")).toBeInTheDocument();
  });

  it("says the bin clears the chat as well as the documents", async () => {
    const { onClearSessionAction } = renderPanel({
      sources: [
        {
          id: "1",
          sourceId: "src_1",
          label: "handbook.pdf",
          kind: "file",
          chunkCount: 12,
          status: "indexed",
        },
      ],
    });
    await userEvent.click(
      screen.getByRole("button", {
        name: "Clear the session: all sources and the chat",
      }),
    );
    expect(onClearSessionAction).toHaveBeenCalledTimes(1);
  });
});

type DropPayload = {
  files?: File[];
  folders?: string[];
  types?: string[];
};

// Stands in for a DataTransfer. jsdom has no drag machinery, so the shape the
// handlers actually read — `types`, `items`, `files` — is what gets faked.
function dataTransfer({ files = [], folders = [], types }: DropPayload) {
  const folderItems = folders.map((name) => ({
    webkitGetAsEntry: () => ({ isDirectory: true, isFile: false, name }),
  }));
  const fileItems = files.map(() => ({
    webkitGetAsEntry: () => ({ isDirectory: false, isFile: true, name: "" }),
  }));
  return {
    types: types ?? (files.length + folders.length > 0 ? ["Files"] : []),
    items: [...fileItems, ...folderItems],
    // A dropped folder shows up here too, which is why the handler filters it.
    files: [...files, ...folders.map((name) => new File([], name))],
    dropEffect: "none",
  };
}

function panelSection() {
  return screen.getByRole("region", { name: "Knowledge base sources" });
}

describe("dropping files on the panel", () => {
  it("accepts a drop anywhere in the section, not just on the picker", async () => {
    const { onAddFileAction } = renderPanel();

    fireEvent.drop(panelSection(), {
      dataTransfer: dataTransfer({
        files: [textFile("one.md"), textFile("two.md")],
      }),
    });

    expect(onAddFileAction).toHaveBeenCalledTimes(2);
    expect(onAddFileAction.mock.calls.map(([file]) => file.name)).toEqual([
      "one.md",
      "two.md",
    ]);
  });

  it("shows the drop overlay while files are dragged over it", () => {
    renderPanel();
    const section = panelSection();

    fireEvent.dragEnter(section, {
      dataTransfer: dataTransfer({ files: [textFile("a.md")] }),
    });
    expect(screen.getByText("Drop to add")).toBeInTheDocument();

    fireEvent.dragLeave(section, {
      dataTransfer: dataTransfer({ files: [textFile("a.md")] }),
    });
    expect(screen.queryByText("Drop to add")).not.toBeInTheDocument();
  });

  // dragenter fires again for every descendant, so a single dragleave from a
  // child must not tear the overlay down while the pointer is still inside.
  it("keeps the overlay up while the pointer crosses child elements", () => {
    renderPanel();
    const section = panelSection();
    const transfer = () => ({
      dataTransfer: dataTransfer({ files: [textFile("a.md")] }),
    });

    fireEvent.dragEnter(section, transfer());
    fireEvent.dragEnter(section, transfer());
    fireEvent.dragLeave(section, transfer());

    expect(screen.getByText("Drop to add")).toBeInTheDocument();
  });

  it("ignores a drag that carries no files", () => {
    renderPanel();
    fireEvent.dragEnter(panelSection(), {
      dataTransfer: dataTransfer({ types: ["text/plain"] }),
    });
    expect(screen.queryByText("Drop to add")).not.toBeInTheDocument();
  });

  it("clears the overlay once the drop lands", () => {
    renderPanel();
    const section = panelSection();

    fireEvent.dragEnter(section, {
      dataTransfer: dataTransfer({ files: [textFile("a.md")] }),
    });
    fireEvent.drop(section, {
      dataTransfer: dataTransfer({ files: [textFile("a.md")] }),
    });

    expect(screen.queryByText("Drop to add")).not.toBeInTheDocument();
  });

  // Unlike the picker, a drop bypasses the `accept` filter entirely, so
  // validateFile is the only thing standing between a .exe and an upload.
  it("rejects an unsupported file a drop let through", () => {
    const { onAddFileAction } = renderPanel();

    fireEvent.drop(panelSection(), {
      dataTransfer: dataTransfer({
        files: [textFile("fine.md"), textFile("installer.exe")],
      }),
    });

    expect(onAddFileAction).toHaveBeenCalledTimes(1);
    expect(onAddFileAction.mock.calls[0][0].name).toBe("fine.md");
    expect(screen.getByRole("status")).toHaveTextContent("installer.exe");
  });

  it("explains that a dropped folder is not a document", () => {
    const { onAddFileAction } = renderPanel();

    fireEvent.drop(panelSection(), {
      dataTransfer: dataTransfer({ folders: ["my-notes"] }),
    });

    expect(onAddFileAction).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "drop the files inside, not the folder",
    );
  });

  it("holds a drop until the session is ready", () => {
    const { onAddFileAction } = renderPanel({ isReady: false });

    fireEvent.drop(panelSection(), {
      dataTransfer: dataTransfer({ files: [textFile("one.md")] }),
    });

    expect(onAddFileAction).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("session");
  });
});
