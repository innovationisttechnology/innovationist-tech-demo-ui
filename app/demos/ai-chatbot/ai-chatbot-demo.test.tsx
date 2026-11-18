import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";

import {
  ensureZizaSession,
  fetchChatHistory,
  fetchSessionSources,
  fetchStarterQuestions,
  ingestFile,
} from "@/lib/ziza/ziza.service";
import type { ChatHistoryPage, SessionJob } from "@/lib/ziza/ziza.types";

import { AiChatbotDemo } from "./ai-chatbot-demo";

// Every job the page follows, by id, so a test can report any of them.
const sessionJobs = vi.hoisted(() => {
  const reporters = new Map<string, (job: SessionJob) => void>();
  return {
    reporters,
    follow: (jobId: string, onUpdate: (job: SessionJob) => void) => {
      reporters.set(jobId, onUpdate);
      return () => {};
    },
  };
});

vi.mock("@/lib/ziza/ziza.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ziza/ziza.service")>();
  return {
    ...actual,
    ensureZizaSession: vi.fn(),
    fetchChatHistory: vi.fn(),
    fetchSessionSources: vi.fn(),
    fetchStarterQuestions: vi.fn(),
    followSessionJob: sessionJobs.follow,
    ingestFile: vi.fn(),
    // The real reader, fed by the fake job stream instead of an EventSource.
    readUploadStartersOnceJobFinishes: (
      startersJobId: string,
      onStarters: (starters: readonly string[]) => void,
    ) =>
      actual.readUploadStartersOnceJobFinishes(
        startersJobId,
        onStarters,
        sessionJobs.follow,
      ),
  };
});

type StreamDataPart = { type: string; data?: unknown };

// The stream itself is not under test: the fake keeps `useChat`'s message
// state and hands the test its `onData`, so ziza events arrive as they would.
const chatStream = vi.hoisted(() => ({
  deliverDataPart: (() => {}) as (dataPart: StreamDataPart) => void,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: ({ onData }: { onData: (dataPart: StreamDataPart) => void }) => {
    chatStream.deliverDataPart = onData;
    const [messages, setMessages] = useState<UIMessage[]>([]);
    return {
      messages,
      setMessages,
      sendMessage: ({ text }: { text: string }) =>
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text }],
          },
        ]),
      status: "ready",
      error: undefined,
      clearError: () => {},
    };
  },
}));

const STARTER = "What happens if the release captain is on leave?";
const HANDBOOK_STARTER = "Who approves time off?";
const ROTA_STARTER = "How often does the rota change?";

const HISTORY_WITH_TURNS: ChatHistoryPage = {
  turns: [
    { id: "u1", role: "user", text: "Who is captain?", citations: [] },
    { id: "a1", role: "assistant", text: "Dana is.", citations: [] },
  ],
  nextBefore: null,
};

const EMPTY_HISTORY: ChatHistoryPage = { turns: [], nextBefore: null };

function resumeSessionWith(history: ChatHistoryPage) {
  vi.mocked(ensureZizaSession).mockResolvedValue({ isNewSession: false });
  vi.mocked(fetchChatHistory).mockResolvedValue(history);
  vi.mocked(fetchSessionSources).mockResolvedValue([]);
  vi.mocked(fetchStarterQuestions).mockResolvedValue([STARTER]);
}

function reportJob(job: SessionJob) {
  const reportUpdate = sessionJobs.reporters.get(job.id);
  expect(reportUpdate, `nothing follows ${job.id}`).toBeDefined();
  act(() => reportUpdate!(job));
}

async function uploadFileAndGetStartersJobId(fileName: string) {
  const ingestJobId = `job_ingest_${fileName}`;
  const startersJobId = `job_starters_${fileName}`;
  vi.mocked(ingestFile).mockResolvedValueOnce({
    id: ingestJobId,
    status: "queued",
  });

  const fileInput =
    document.querySelector<HTMLInputElement>('input[type="file"]');
  await userEvent.upload(fileInput!, [
    new File(["hello"], fileName, { type: "text/plain" }),
  ]);
  await waitFor(() =>
    expect(sessionJobs.reporters.has(ingestJobId)).toBe(true),
  );
  reportJob({
    id: ingestJobId,
    status: "done",
    startersJobId,
    result: {
      sourceId: `src_${fileName}`,
      chunks: 3,
      imagesDescribed: 0,
      imagesSkipped: 0,
      imagesFailed: 0,
    },
  });
  return startersJobId;
}

// `starterQuestions` undefined is a starters job that skipped.
async function uploadFileWithStarters(
  fileName: string,
  starterQuestions: readonly string[] | undefined,
) {
  const startersJobId = await uploadFileAndGetStartersJobId(fileName);
  reportJob({ id: startersJobId, status: "done", starterQuestions });
}

async function resumeConversationWithHistory() {
  resumeSessionWith(HISTORY_WITH_TURNS);
  render(<AiChatbotDemo />);
  await screen.findByText("Dana is.");
  await waitForSessionToSettle();
}

async function waitForSessionToSettle() {
  await waitFor(() => expect(fetchStarterQuestions).toHaveBeenCalled());
  await act(async () => {});
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sessionJobs.reporters.clear();
});

describe("recovered starter questions belong to an empty conversation", () => {
  it("shows none after a reload that restores history", async () => {
    resumeSessionWith(HISTORY_WITH_TURNS);
    render(<AiChatbotDemo />);
    await screen.findByText("Dana is.");
    await waitForSessionToSettle();
    expect(
      screen.queryByRole("button", { name: STARTER }),
    ).not.toBeInTheDocument();
  });

  it("shows them after a reload with no history", async () => {
    resumeSessionWith(EMPTY_HISTORY);
    render(<AiChatbotDemo />);
    expect(await screen.findByRole("button", { name: STARTER })).toBeVisible();
  });

  it("shows none when the history could not be read", async () => {
    resumeSessionWith(EMPTY_HISTORY);
    vi.mocked(fetchChatHistory).mockResolvedValue(null);
    render(<AiChatbotDemo />);
    await waitForSessionToSettle();
    expect(
      screen.queryByRole("button", { name: STARTER }),
    ).not.toBeInTheDocument();
  });

  it("shows none after a refusal", async () => {
    resumeSessionWith(EMPTY_HISTORY);
    render(<AiChatbotDemo />);
    await userEvent.click(await screen.findByRole("button", { name: STARTER }));

    act(() =>
      chatStream.deliverDataPart({
        type: "data-ziza",
        data: {
          type: "done",
          answered: false,
          refusal: { kind: "no_relevant_sources", redirect: null, sources: [] },
        },
      }),
    );
    expect(
      screen.queryByRole("button", { name: STARTER }),
    ).not.toBeInTheDocument();
  });
});

describe("an upload's own starter questions", () => {
  it("shows them mid-conversation, read from its starters job", async () => {
    await resumeConversationWithHistory();

    await uploadFileWithStarters("handbook.md", [HANDBOOK_STARTER]);
    expect(
      screen.getByRole("button", { name: HANDBOOK_STARTER }),
    ).toBeVisible();
    // The session's starters mix in earlier documents.
    expect(fetchStarterQuestions).toHaveBeenCalledTimes(1);
  });

  it("shows each upload's own questions, not a mix", async () => {
    await resumeConversationWithHistory();

    await uploadFileWithStarters("handbook.md", [HANDBOOK_STARTER]);
    await uploadFileWithStarters("rota.md", [ROTA_STARTER]);
    expect(screen.getByRole("button", { name: ROTA_STARTER })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: HANDBOOK_STARTER }),
    ).not.toBeInTheDocument();
  });

  it("hides them once the visitor sends a message", async () => {
    await resumeConversationWithHistory();
    await uploadFileWithStarters("handbook.md", [HANDBOOK_STARTER, STARTER]);

    await userEvent.click(
      screen.getByRole("button", { name: HANDBOOK_STARTER }),
    );
    expect(
      screen.queryByRole("button", { name: STARTER }),
    ).not.toBeInTheDocument();
  });

  it("changes nothing when the starters job has no questions", async () => {
    resumeSessionWith(EMPTY_HISTORY);
    render(<AiChatbotDemo />);
    await screen.findByRole("button", { name: STARTER });

    await uploadFileWithStarters("handbook.md", undefined);
    expect(screen.getByRole("button", { name: STARTER })).toBeVisible();
  });

  it("shows nothing when the starters job fails", async () => {
    await resumeConversationWithHistory();

    const startersJobId = await uploadFileAndGetStartersJobId("handbook.md");
    reportJob({
      id: startersJobId,
      status: "failed",
      errorMessage: "model down",
    });
    expect(screen.queryByText("starter_questions.offered")).toBeNull();
  });
});
