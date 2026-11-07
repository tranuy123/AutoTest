import { describe, expect, it } from "vitest";

import { InMemoryRunRepository, RunService } from "./run-store.js";

function makeService() {
  return new RunService(new InMemoryRunRepository());
}

describe("RunService + InMemoryRunRepository (S1.3 AC-1, AC-2, AC-4)", () => {
  it("cap run_id theo dung dinh dang va tang dan", async () => {
    const service = makeService();
    const a = await service.createRun({
      scenarioId: "kich-ban-a",
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
    });
    const b = await service.createRun({
      scenarioId: "kich-ban-a",
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
    });
    expect(a.runId).toMatch(/^AUTOTEST_\d{8}_001$/);
    expect(b.runId).toMatch(/^AUTOTEST_\d{8}_002$/);
  });

  it("50 lan chay song song khong trung run_id", async () => {
    const service = makeService();
    const runs = await Promise.all(
      Array.from({ length: 50 }, () =>
        service.createRun({
          scenarioId: "song-song",
          mode: "chay-nhanh",
          targetUrl: "https://uat.example.invalid",
        }),
      ),
    );
    const ids = new Set(runs.map((r) => r.runId));
    expect(ids.size).toBe(50);
  });

  it("luu buoc chay va ket thuc lan chay, loc duoc theo kich ban va ket qua", async () => {
    const service = makeService();
    const run = await service.createRun({
      scenarioId: "doanh-thu",
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
    });
    await service.recordStep({
      runId: run.runId,
      stepId: "dat-lich",
      name: "Đặt lịch",
      status: "qua",
      durationMs: 1500,
      errorCode: null,
    });
    await service.finishRun(run.runId, "qua", { reportPath: "runs/bao-cao.md" });

    const detail = await service.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("qua");
    expect(detail?.run.reportPath).toBe("runs/bao-cao.md");
    expect(detail?.steps).toHaveLength(1);
    expect(detail?.steps[0]?.durationMs).toBe(1500);

    expect(await service.listRuns({ scenarioId: "doanh-thu" })).toHaveLength(1);
    expect(await service.listRuns({ scenarioId: "khac" })).toHaveLength(0);
    expect(await service.listRuns({ status: "qua" })).toHaveLength(1);
    expect(await service.listRuns({ status: "hong" })).toHaveLength(0);
  });
});
