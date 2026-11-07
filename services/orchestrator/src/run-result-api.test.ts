/**
 * Test S5.1 - trang ket qua lan chay o muc API: chi tiet ket qua gom
 * ket luan lon, bang doi chieu (S4.2), video theo vai (AC-2), bao cao
 * Markdown (AC-3), du lieu lan chay cu khong doi khi chay lan moi (AC-4).
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScenarioYaml } from "@autotest/scenario-schema";
import { afterEach, describe, expect, it } from "vitest";

import type { KiemDemService } from "./kiem-dem.js";
import type { BangDoiChieu } from "./reconciler.js";
import { createOrchestratorServer } from "./server.js";
import { makeExecutionStack } from "./testing.js";

const SAMPLE_YAML = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "scenario-schema",
  "samples",
  "dat-lich-den-bao-cao.yaml",
);

const ONE_ROLE_YAML = `schemaVersion: 2
id: chi-dang-nhap
ten: Chỉ đăng nhập
cacVai: [le-tan]
cacBuoc:
  - id: dang-nhap
    vai: le-tan
    hanhDong: dang-nhap
`;

function bangKhop(runId: string): BangDoiChieu {
  return {
    runId,
    ngay: "2026-11-07",
    cacChiTieu: [
      {
        id: "doanh-thu-ngay",
        ten: "Doanh thu trong ngày",
        donVi: "VND",
        kyVong: 500000,
        ui: 500000,
        api: 500000,
        db: 500000,
        ketQua: "khop",
        doLech: {},
        ghiChu: [],
      },
    ],
    ketQua: "qua",
    soKhop: 1,
    soLech: 0,
    soKhongKiemChung: 0,
  };
}

function kiemDemStub(bang: (runId: string) => BangDoiChieu): KiemDemService {
  return {
    kiemDem: async (input: { run: { runId: string } }) => bang(input.run.runId),
  } as unknown as KiemDemService;
}

interface RunningServer {
  base: string;
  close: () => Promise<void>;
}

let running: RunningServer | null = null;

async function startServer(stack: Awaited<ReturnType<typeof makeExecutionStack>>) {
  const server = createOrchestratorServer({
    config: stack.config,
    runService: stack.runService,
    scenarioService: stack.scenarioService,
    dataService: stack.dataService,
    executor: stack.executor,
    bus: stack.bus,
    roleStatus: stack.roleStatus,
    registry: stack.registry,
    cleanupService: stack.cleanupService,
    batchService: stack.batchService,
    worker: stack.worker,
    artifactsRoot: stack.artifactsRoot,
    streamGatewayWsUrl: "ws://localhost:3102",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  running = {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  return running;
}

afterEach(async () => {
  await running?.close();
  running = null;
});

interface RunDetailJson {
  status: string;
  ketLuan: string | null;
  finishedAt: string | null;
  kiemDem: { soKhop: number; soLech: number } | null;
  videos: { roleId: string; available: boolean; reason: string | null }[];
  steps: unknown[];
  input: {
    data: {
      thongKe: { soBenhNhan: number };
      benhNhan: { soDienThoai: string }[];
    };
  } | null;
}

async function fetchDetail(base: string, runId: string): Promise<RunDetailJson> {
  const res = await fetch(`${base}/api/runs/${runId}`);
  return (await res.json()) as RunDetailJson;
}

async function seedSample(stack: Awaited<ReturnType<typeof makeExecutionStack>>) {
  const yaml = await readFile(SAMPLE_YAML, "utf8");
  const parsed = parseScenarioYaml(yaml);
  if (!parsed.ok) throw new Error("YAML mẫu không hợp lệ");
  await stack.scenarioService.importScenario({
    filename: "dat-lich-den-bao-cao.yaml",
    format: "yaml",
    contentText: yaml,
  });
  return parsed.scenario;
}

describe("S5.1 - chi tiet ket qua + bao cao + video theo vai", () => {
  it("AC-1/AC-2/AC-3: lan chay QUA co ket luan, bang doi chieu, video tung vai phat duoc, bao cao .md du muc va da che SDT", async () => {
    const stack = await makeExecutionStack(
      {},
      { keepVideoOnPass: true, kiemDemService: kiemDemStub(bangKhop) },
    );
    stack.worker.writeVideoFiles = true;
    const scenario = await seedSample(stack);
    const { base } = await startServer(stack);

    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);

    const detail = await fetchDetail(base, run.runId);
    expect(detail.status).toBe("qua");
    expect(detail.ketLuan).toBe("Kịch bản QUA");
    expect(detail.kiemDem?.soKhop).toBe(1);
    expect(detail.videos).toHaveLength(5);
    expect(detail.videos.every((v) => v.available)).toBe(true);
    expect(detail.input?.data.thongKe.soBenhNhan).toBe(2);

    // SDT trong chi tiet da bi che - ban goc khong duoc lo ra API.
    const rawInput = await stack.dataService.getRunInput(run.runId);
    const rawPhone = rawInput?.data.benhNhan[0]?.soDienThoai ?? "";
    expect(rawPhone).toMatch(/^011\d+$/);
    expect(JSON.stringify(detail.input)).not.toContain(rawPhone);
    expect(detail.input?.data.benhNhan[0]?.soDienThoai).toContain("***");

    // Video phat lai duoc qua API (AC-2): endpoint stream dung file tren
    // dia (tren VM sandbox file gia lap bi cat 0 byte khi ghi nen chi
    // kiem chieu dai noi dung tra ve voi kich thuoc file thuc tren dia).
    const videoRes = await fetch(`${base}/api/runs/${run.runId}/videos/le-tan`);
    expect(videoRes.status).toBe(200);
    expect(videoRes.headers.get("content-type")).toContain("video/webm");
    const videoBody = await videoRes.text();
    const { stat } = await import("node:fs/promises");
    const videoStat = await stat(
      join(stack.artifactsRoot, run.runId, "video", "le-tan", "video.webm"),
    );
    expect(Number(videoRes.headers.get("content-length"))).toBe(videoStat.size);
    expect(videoBody.length).toBe(videoStat.size);

    // Bao cao Markdown (AC-3): du cac muc, co bang doi chieu, ket qua
    // don, lien ket video; khong chua SDT goc.
    const reportRes = await fetch(`${base}/api/runs/${run.runId}/report.md`);
    expect(reportRes.status).toBe(200);
    const md = await reportRes.text();
    expect(md).toContain(`# Báo cáo lần chạy ${run.runId}`);
    expect(md).toContain("Kịch bản QUA");
    expect(md).toContain("## Bảng đối chiếu kiểm đếm");
    expect(md).toContain("Doanh thu trong ngày");
    expect(md).toContain("## Dọn dữ liệu sau lần chạy");
    expect(md).toContain(`/api/runs/${run.runId}/videos/le-tan`);
    expect(md).not.toContain(rawPhone);
  });

  it("AC-4: du lieu lan chay cu khong doi khi co lan chay moi", async () => {
    const stack = await makeExecutionStack(
      {},
      { keepVideoOnPass: true, kiemDemService: kiemDemStub(bangKhop) },
    );
    const scenario = await seedSample(stack);
    const { base } = await startServer(stack);

    const runA = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(runA.runId);
    const before = await fetchDetail(base, runA.runId);

    const runB = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "chay-nhanh",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(runB.runId);

    const after = await fetchDetail(base, runA.runId);
    expect(after.ketLuan).toBe(before.ketLuan);
    expect(after.finishedAt).toBe(before.finishedAt);
    expect(after.kiemDem).toEqual(before.kiemDem);
    expect(after.steps).toEqual(before.steps);
  });

  it("AC-2: che do chay nhanh + lan chay QUA khong luu video -> trang ket qua giai thich ro ly do", async () => {
    const stack = await makeExecutionStack();
    stack.worker.writeVideoFiles = true;
    await stack.scenarioService.importScenario({
      filename: "chi-dang-nhap.yaml",
      format: "yaml",
      contentText: ONE_ROLE_YAML,
    });
    const { base } = await startServer(stack);
    const run = await stack.runService.createRun({
      scenarioId: "chi-dang-nhap",
      mode: "chay-nhanh",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);

    const detail = await fetchDetail(base, run.runId);
    expect(detail.status).toBe("qua");
    expect(detail.videos).toHaveLength(1);
    expect(detail.videos[0]?.available).toBe(false);
    expect(detail.videos[0]?.reason).toBe(
      "Chế độ chạy nhanh: lần chạy qua nên không lưu video",
    );
    const videoRes = await fetch(`${base}/api/runs/${run.runId}/videos/le-tan`);
    expect(videoRes.status).toBe(404);
    const videoBody = (await videoRes.json()) as Record<string, unknown>;
    expect(videoBody.reason).toContain("Chế độ chạy nhanh");
  });

  it("AC-1: kiem dem lech -> ket luan lon ghi ro 'lệch N chỉ tiêu'", async () => {
    const stack = await makeExecutionStack(
      {},
      {
        kiemDemService: kiemDemStub((runId) => ({
          ...bangKhop(runId),
          ketQua: "hong",
          soKhop: 0,
          soLech: 1,
          cacChiTieu: [
            { ...bangKhop(runId).cacChiTieu[0]!, ketQua: "lech", db: 450000, doLech: { db: -50000 } },
          ],
        })),
      },
    );
    const scenario = await seedSample(stack);
    const { base } = await startServer(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await fetchDetail(base, run.runId);
    expect(detail.status).toBe("hong");
    expect(detail.ketLuan).toBe("Kịch bản HỎNG — lệch 1 chỉ tiêu");
    const md = await (await fetch(`${base}/api/runs/${run.runId}/report.md`)).text();
    expect(md).toContain("Kịch bản HỎNG — lệch 1 chỉ tiêu");
    expect(md).toContain("Lệch");
  });
});
