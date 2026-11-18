import { describe, expect, it, vi } from "vitest";

import { readUploadStartersOnceJobFinishes } from "./ziza.service";
import { type SessionJob } from "./ziza.types";

function fakeFollowJob() {
  let reportJobUpdate: (job: SessionJob) => void = () => {};
  const stop = vi.fn();
  const followJob = vi.fn(
    (_jobId: string, onUpdate: (job: SessionJob) => void) => {
      reportJobUpdate = onUpdate;
      return stop;
    },
  );
  return {
    followJob,
    reportJobUpdate: (job: SessionJob) => reportJobUpdate(job),
    stop,
  };
}

describe("reading an upload's starters", () => {
  // ziza writes them in a separate job queued once the ingest commits.
  it("waits for the starters job, then offers its questions", () => {
    const { followJob, reportJobUpdate } = fakeFollowJob();
    const onStarters = vi.fn();

    readUploadStartersOnceJobFinishes("job_starters", onStarters, followJob);
    expect(followJob).toHaveBeenCalledWith(
      "job_starters",
      expect.any(Function),
      expect.any(Function),
    );

    reportJobUpdate({ id: "job_starters", status: "queued" });
    reportJobUpdate({ id: "job_starters", status: "processing" });
    expect(onStarters).not.toHaveBeenCalled();

    reportJobUpdate({
      id: "job_starters",
      status: "done",
      starterQuestions: ["Who covers leave?"],
    });
    expect(onStarters).toHaveBeenCalledWith(["Who covers leave?"]);
  });

  it("offers at most four", () => {
    const { followJob, reportJobUpdate } = fakeFollowJob();
    const onStarters = vi.fn();

    readUploadStartersOnceJobFinishes("job_starters", onStarters, followJob);
    reportJobUpdate({
      id: "job_starters",
      status: "done",
      starterQuestions: ["one", "two", "three", "four", "five"],
    });
    expect(onStarters).toHaveBeenCalledWith(["one", "two", "three", "four"]);
  });

  it("changes nothing when the starters job fails", () => {
    const { followJob, reportJobUpdate } = fakeFollowJob();
    const onStarters = vi.fn();

    readUploadStartersOnceJobFinishes("job_starters", onStarters, followJob);
    reportJobUpdate({
      id: "job_starters",
      status: "failed",
      errorMessage: "model down",
    });
    expect(onStarters).not.toHaveBeenCalled();
  });

  // ziza leaves `questions` out when the job skipped: the session ended, the
  // spend cap was hit, or starters are off.
  it("changes nothing when the job has no questions", () => {
    const { followJob, reportJobUpdate } = fakeFollowJob();
    const onStarters = vi.fn();

    readUploadStartersOnceJobFinishes("job_starters", onStarters, followJob);
    reportJobUpdate({ id: "job_starters", status: "done" });
    reportJobUpdate({
      id: "job_starters",
      status: "done",
      starterQuestions: [],
    });
    expect(onStarters).not.toHaveBeenCalled();
  });

  it("hands back a way to stop waiting", () => {
    const { followJob, stop } = fakeFollowJob();
    const stopWaiting = readUploadStartersOnceJobFinishes(
      "job_starters",
      vi.fn(),
      followJob,
    );
    stopWaiting();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
