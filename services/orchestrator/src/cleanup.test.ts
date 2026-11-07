import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CleanupService, HttpCrmCleanupClient } from "./cleanup.js";
import { EntityRegistry, InMemoryEntityRepository } from "./entity-registry.js";
import { InMemoryRunRepository, RunService } from "./run-store.js";

interface DeleteRequest {
  path: string;
  runId: string | string[] | undefined;
  tenant: string | string[] | undefined;
}

/** CRM gia lap qua HTTP that: ghi lai cac DELETE, cho phep chi dinh loi 500. */
class FakeCrm {
  server!: Server;
  baseUrl = "";
  readonly deletes: DeleteRequest[] = [];
  readonly failPaths = new Set<string>();

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      if (req.method === "DELETE") {
        this.deletes.push({
          path: req.url ?? "",
          runId: req.headers["x-autotest-run-id"],
          tenant: req.headers["x-autotest-tenant"],
        });
        if (this.failPaths.has(req.url ?? "")) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "loi-noi-bo" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ deleted: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    if (typeof address === "object" && address) {
      this.baseUrl = `http://127.0.0.1:${address.port}`;
    }
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

describe("S2.4 — dọn dữ liệu test theo run_id qua API CRM", () => {
  const crm = new FakeCrm();
  let registry: EntityRegistry;
  let runService: RunService;
  let cleanup: CleanupService;

  beforeAll(async () => {
    await crm.start();
    registry = new EntityRegistry(new InMemoryEntityRepository());
    runService = new RunService(new InMemoryRunRepository());
    cleanup = new CleanupService({
      registry,
      client: new HttpCrmCleanupClient(),
      runService,
      targetBaseUrlOf: async () => crm.baseUrl,
      tenant: "autotest-tenant-mau",
    });
  });

  afterAll(async () => {
    await crm.stop();
  });

  it("AC-1/AC-3: dọn đúng thứ tự ngược phụ thuộc, gắn run_id + tenant, đánh dấu sạch", async () => {
    const run = await runService.createRun({
      scenarioId: "kb-mau",
      mode: "chay-nhanh",
      targetUrl: crm.baseUrl,
      status: "dang-cho",
    });
    await registry.register({ runId: run.runId, type: "benh-nhan", entityId: "BN-1" });
    await registry.register({ runId: run.runId, type: "lich-hen", entityId: "LH-1" });
    await registry.register({ runId: run.runId, type: "hoa-don", entityId: "HD-1" });

    crm.deletes.length = 0;
    const report = await cleanup.cleanupRun(run.runId);
    expect(report.sach).toBe(true);
    expect(report.daDon).toBe(3);
    expect(report.conSot).toHaveLength(0);
    // Hoa don xoa truoc lich hen, lich hen truoc benh nhan.
    expect(crm.deletes.map((d) => d.path)).toEqual([
      "/api/test-data/hoa-don/HD-1",
      "/api/test-data/lich-hen/LH-1",
      "/api/test-data/benh-nhan/BN-1",
    ]);
    expect(crm.deletes.every((d) => d.runId === run.runId)).toBe(true);
    expect(crm.deletes.every((d) => d.tenant === "autotest-tenant-mau")).toBe(true);
    const detail = await runService.getRunWithSteps(run.runId);
    expect(detail?.run.cleanupStatus).toBe("sach");
    const entities = await registry.listByRun(run.runId);
    expect(entities.every((e) => e.cleanedAt !== null)).toBe(true);
  });

  it("AC-2: không đụng dữ liệu của lần chạy khác; lần chạy không có dữ liệu là sạch", async () => {
    const runA = await runService.createRun({
      scenarioId: "kb-mau",
      mode: "chay-nhanh",
      targetUrl: crm.baseUrl,
      status: "dang-cho",
    });
    const runB = await runService.createRun({
      scenarioId: "kb-mau",
      mode: "chay-nhanh",
      targetUrl: crm.baseUrl,
      status: "dang-cho",
    });
    await registry.register({ runId: runB.runId, type: "lich-hen", entityId: "LH-CUA-B" });

    crm.deletes.length = 0;
    const report = await cleanup.cleanupRun(runA.runId);
    expect(report.sach).toBe(true);
    expect(report.daDon).toBe(0);
    expect(report.conSot).toHaveLength(0);
    expect(crm.deletes).toHaveLength(0);
    const entitiesB = await registry.listByRun(runB.runId);
    expect(entitiesB[0]?.cleanedAt).toBeNull();
  });

  it("AC-3: còn sót được báo rõ + trạng thái chưa-sạch; dọn thủ công lần 2 chỉ thử phần sót", async () => {
    const run = await runService.createRun({
      scenarioId: "kb-mau",
      mode: "chay-nhanh",
      targetUrl: crm.baseUrl,
      status: "dang-cho",
    });
    await registry.register({ runId: run.runId, type: "benh-nhan", entityId: "BN-2" });
    await registry.register({ runId: run.runId, type: "lich-hen", entityId: "LH-2" });
    crm.failPaths.add("/api/test-data/lich-hen/LH-2");

    const report1 = await cleanup.cleanupRun(run.runId);
    expect(report1.sach).toBe(false);
    expect(report1.daDon).toBe(1);
    expect(report1.conSot).toHaveLength(1);
    expect(report1.conSot[0]?.entityId).toBe("LH-2");
    expect(report1.conSot[0]?.lyDo).toContain("500");
    const detail1 = await runService.getRunWithSteps(run.runId);
    expect(detail1?.run.cleanupStatus).toBe("chua-sach");

    // Don thu cong (cung ham voi endpoint /cleanup): het loi thi sach.
    crm.failPaths.clear();
    crm.deletes.length = 0;
    const report2 = await cleanup.cleanupRun(run.runId);
    expect(report2.sach).toBe(true);
    expect(crm.deletes.map((d) => d.path)).toEqual(["/api/test-data/lich-hen/LH-2"]);
    const detail2 = await runService.getRunWithSteps(run.runId);
    expect(detail2?.run.cleanupStatus).toBe("sach");
  });
});
