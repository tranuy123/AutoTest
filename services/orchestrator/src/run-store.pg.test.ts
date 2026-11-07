import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgRunRepository, RunService } from "./run-store.js";

/**
 * Test tich hop PostgreSQL that (S1.3 AC-1, AC-2).
 * Chi chay khi co bien TEST_DATABASE_URL tro toi DB test rieng;
 * tren Muse VM dot Epic 1, DB test la autotest_test tren PostgreSQL 16 local.
 * Khong co DB thi bo qua co ghi chu - khong gia vo da chay.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("PgRunRepository (PostgreSQL that)", () => {
  let repo: PgRunRepository;
  let service: RunService;

  beforeAll(async () => {
    repo = new PgRunRepository(TEST_DATABASE_URL as string);
    await repo.init();
    // Migration chay lai lan 2 phai idempotent, khong loi.
    await repo.init();
    service = new RunService(repo);
  });

  afterAll(async () => {
    await repo.close();
  });

  it("luu va doc lai lan chay kem buoc chay", async () => {
    const run = await service.createRun({
      scenarioId: "pg-kiem-chung",
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
    });
    expect(run.runId).toMatch(/^AUTOTEST_\d{8}_\d{3}$/);
    await service.recordStep({
      runId: run.runId,
      stepId: "buoc-1",
      name: "Bước 1",
      status: "qua",
      durationMs: 100,
      errorCode: null,
    });
    await service.finishRun(run.runId, "hong", { videoPath: "runs/video.webm" });

    const detail = await service.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("hong");
    expect(detail?.run.videoPath).toBe("runs/video.webm");
    expect(detail?.steps).toHaveLength(1);
  });

  it("30 lan chay song song tren PostgreSQL khong trung run_id", async () => {
    const runs = await Promise.all(
      Array.from({ length: 30 }, () =>
        service.createRun({
          scenarioId: "pg-song-song",
          mode: "chay-nhanh",
          targetUrl: "https://uat.example.invalid",
        }),
      ),
    );
    expect(new Set(runs.map((r) => r.runId)).size).toBe(30);
  });
});
