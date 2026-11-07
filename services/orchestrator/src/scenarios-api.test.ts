import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildExcelTemplate } from "@autotest/scenario-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InMemoryRunRepository, RunService } from "./run-store.js";
import { InMemoryScenarioRepository, ScenarioService } from "./scenario-store.js";
import { createOrchestratorServer } from "./server.js";
import { makeTestConfig } from "./testing.js";

const sampleYaml = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../packages/scenario-schema/samples/dat-lich-den-bao-cao.yaml",
  ),
  "utf8",
);

const SMALL_YAML = `schemaVersion: 2
id: kich-ban-nho
ten: Kịch bản nhỏ để test
cacVai: [le-tan, benh-nhan]
cacBuoc:
  - id: dang-nhap
    vai: le-tan
    hanhDong: dang-nhap
    phatSuKien: san-sang
  - id: dat-lich
    vai: benh-nhan
    hanhDong: dat-lich-hen
    choSuKien: san-sang
`;

const BAD_YAML = `schemaVersion: 2
id: kich-ban-loi
ten: Kịch bản lỗi
cacVai: [le-tan]
cacBuoc:
  - id: buoc-1
    vai: le-tan
    hanhDong: hanh-dong-khong-ton-tai
`;

describe("API thu vien kich ban (S2.2 AC-2, AC-3)", () => {
  let server: Server;
  let baseUrl: string;
  let scenarioService: ScenarioService;

  beforeAll(async () => {
    scenarioService = new ScenarioService(new InMemoryScenarioRepository());
    await scenarioService.seedIfEmpty(sampleYaml);
    server = createOrchestratorServer({
      config: makeTestConfig(),
      runService: new RunService(new InMemoryRunRepository()),
      scenarioService,
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  const post = (body: unknown) =>
    fetch(`${baseUrl}/api/scenarios`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("thu vien co san kich ban mau sau seed, liet ke co tom tat", async () => {
    const res = await fetch(`${baseUrl}/api/scenarios`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scenarios: Array<{ id: string; roles: string[]; stepCount: number; metricCount: number }>;
    };
    const mau = body.scenarios.find((s) => s.id === "dat-lich-den-bao-cao");
    expect(mau).toBeDefined();
    expect(mau?.roles).toHaveLength(5);
    expect(mau?.stepCount).toBe(8);
    expect(mau?.metricCount).toBe(3);
  });

  it("nap YAML hop le -> 201 va xuat hien trong thu vien", async () => {
    const res = await post({ filename: "nho.yaml", format: "yaml", contentText: SMALL_YAML });
    expect(res.status).toBe(201);
    const list = (await (await fetch(`${baseUrl}/api/scenarios`)).json()) as {
      scenarios: Array<{ id: string }>;
    };
    expect(list.scenarios.some((s) => s.id === "kich-ban-nho")).toBe(true);
  });

  it("nap YAML sai -> 422 kem loi theo truong, khong nap do dang", async () => {
    const res = await post({ filename: "loi.yaml", format: "yaml", contentText: BAD_YAML });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      errors: Array<{ file: string; line: number | null; field: string; message: string }>;
    };
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]?.field).toContain("hanhDong");
    expect(body.errors[0]?.message).toContain("thư viện bước dùng chung");
    const detail = await fetch(`${baseUrl}/api/scenarios/kich-ban-loi`);
    expect(detail.status).toBe(404);
  });

  it("nap Excel mau -> 201 (chuyen doi roi validate)", async () => {
    const buffer = await buildExcelTemplate();
    const res = await post({
      filename: "mau.xlsx",
      format: "excel",
      contentBase64: buffer.toString("base64"),
    });
    // Kich ban mau da seed trung id -> 409 la dung ky vong; xoa truoc roi nap lai de kiem 201 that
    if (res.status === 409) {
      await fetch(`${baseUrl}/api/scenarios/dat-lich-den-bao-cao`, { method: "DELETE" });
      const retry = await post({
        filename: "mau.xlsx",
        format: "excel",
        contentBase64: buffer.toString("base64"),
      });
      expect(retry.status).toBe(201);
    } else {
      expect(res.status).toBe(201);
    }
  });

  it("nap trung id -> 409", async () => {
    const res = await post({ filename: "nho.yaml", format: "yaml", contentText: SMALL_YAML });
    expect(res.status).toBe(409);
  });

  it("chi tiet kich ban co vai/buoc/chi tieu; xoa xong thi 404", async () => {
    const res = await fetch(`${baseUrl}/api/scenarios/kich-ban-nho`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scenario: { cacVai: string[]; cacBuoc: unknown[] };
      yaml: string;
    };
    expect(body.scenario.cacVai).toEqual(["le-tan", "benh-nhan"]);
    expect(body.scenario.cacBuoc).toHaveLength(2);
    expect(body.yaml).toContain("kich-ban-nho");

    const del = await fetch(`${baseUrl}/api/scenarios/kich-ban-nho`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await fetch(`${baseUrl}/api/scenarios/kich-ban-nho`);
    expect(after.status).toBe(404);
    const delAgain = await fetch(`${baseUrl}/api/scenarios/kich-ban-nho`, { method: "DELETE" });
    expect(delAgain.status).toBe(404);
  });

  it("tao lan chay tu giao dien (queue) -> trang thai dang-cho, nhan Dang cho chay", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "dat-lich-den-bao-cao", mode: "xem-truc-tiep", queue: true }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; resultLabel: string };
    expect(body.status).toBe("dang-cho");
    expect(body.resultLabel).toBe("Đang chờ chạy");
  });
});
