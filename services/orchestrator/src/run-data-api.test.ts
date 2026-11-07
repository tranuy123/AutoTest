import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMPTY_BANNED_LIST } from "./data-generator.js";
import { DataService, InMemoryRunDataRepository } from "./run-data-store.js";
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

describe("API du lieu sinh theo run_id (S2.3 AC-3)", () => {
  let server: Server;
  let baseUrl: string;
  let runId: string;

  beforeAll(async () => {
    const runService = new RunService(new InMemoryRunRepository());
    const scenarioService = new ScenarioService(new InMemoryScenarioRepository());
    await scenarioService.seedIfEmpty(sampleYaml);
    const dataService = new DataService(
      new InMemoryRunDataRepository(),
      runService,
      scenarioService,
      EMPTY_BANNED_LIST,
    );
    server = createOrchestratorServer({
      config: makeTestConfig(),
      runService,
      scenarioService,
      dataService,
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const create = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "dat-lich-den-bao-cao", mode: "xem-truc-tiep", queue: true }),
    });
    const body = (await create.json()) as { runId: string };
    runId = body.runId;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("sinh du lieu cho lan chay -> 201, du lieu mang run_id, thong ke khop khai bao mau", async () => {
    const res = await fetch(`${baseUrl}/api/runs/${runId}/generate-data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      runId: string;
      seed: string;
      data: {
        benhNhan: unknown[];
        lichHen: Array<{ runId: string }>;
        thongKe: { soBenhNhan: number; soLichHen: number; tongGiaLichHen: number };
      };
    };
    expect(body.runId).toBe(runId);
    expect(body.seed).toBe(runId); // mac dinh seed = runId
    expect(body.data.thongKe).toEqual({ soBenhNhan: 2, soDichVu: 2, soLichHen: 2, tongGiaLichHen: 500000 });
    expect(body.data.lichHen.every((lh) => lh.runId === runId)).toBe(true);
  });

  it("doc lai input da luu va xuat file JSON co content-disposition", async () => {
    const res = await fetch(`${baseUrl}/api/runs/${runId}/input`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toBe(runId);

    const exp = await fetch(`${baseUrl}/api/runs/${runId}/input/export`);
    expect(exp.status).toBe(200);
    expect(exp.headers.get("content-disposition")).toContain(`input-${runId}.json`);
    const exported = (await exp.json()) as { runId: string; benhNhan: unknown[] };
    expect(exported.runId).toBe(runId);
    expect(exported.benhNhan).toHaveLength(2);
  });

  it("sinh du lieu cho lan chay khong ton tai -> 404", async () => {
    const res = await fetch(`${baseUrl}/api/runs/AUTOTEST_19990101_999/generate-data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("tao lan chay kem generateData -> phan hoi co thong ke input", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenarioId: "dat-lich-den-bao-cao",
        mode: "chay-nhanh",
        queue: true,
        generateData: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      runId: string;
      input?: { thongKe: { soLichHen: number } };
    };
    expect(body.input?.thongKe.soLichHen).toBe(2);
    const input = await fetch(`${baseUrl}/api/runs/${body.runId}/input`);
    expect(input.status).toBe(200);
  });
});
