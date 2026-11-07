import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMPTY_BANNED_LIST } from "./data-generator.js";
import { DataService, PgRunDataRepository } from "./run-data-store.js";
import { PgRunRepository, RunService } from "./run-store.js";
import { PgScenarioRepository, ScenarioService } from "./scenario-store.js";

/**
 * Test tich hop PostgreSQL that cho kho kich ban (S2.2) va kho du lieu
 * lan chay (S2.3). Chi chay khi co TEST_DATABASE_URL; khong co thi bo qua
 * co ghi chu - khong gia vo da chay (dung mau S1.3).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const sampleYaml = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../packages/scenario-schema/samples/dat-lich-den-bao-cao.yaml",
  ),
  "utf8",
);

describe.skipIf(!TEST_DATABASE_URL)("PgScenarioRepository + PgRunDataRepository (PostgreSQL that)", () => {
  let scenarioRepo: PgScenarioRepository;
  let dataRepo: PgRunDataRepository;
  let runRepo: PgRunRepository;

  beforeAll(async () => {
    scenarioRepo = new PgScenarioRepository(TEST_DATABASE_URL as string);
    dataRepo = new PgRunDataRepository(TEST_DATABASE_URL as string);
    runRepo = new PgRunRepository(TEST_DATABASE_URL as string);
    await runRepo.init();
    await scenarioRepo.init();
    await dataRepo.init();
    // Migration chay lai phai idempotent
    await scenarioRepo.init();
    await dataRepo.init();
  });

  afterAll(async () => {
    await scenarioRepo.close();
    await dataRepo.close();
    await runRepo.close();
  });

  it("luu/doc/xoa kich ban tren PG that", async () => {
    const service = new ScenarioService(scenarioRepo);
    const id = `pg-test-${Date.now()}`;
    const yaml = sampleYaml.replace("id: dat-lich-den-bao-cao", `id: ${id}`);
    const imported = await service.importScenario({ filename: "pg.yaml", format: "yaml", contentText: yaml });
    expect(imported.ok).toBe(true);
    const found = await service.getScenario(id);
    expect(found?.scenario.cacBuoc).toHaveLength(8);
    const deleted = await service.deleteScenario(id);
    expect(deleted).toBe(true);
    expect(await service.getScenario(id)).toBeNull();
  });

  it("sinh du lieu va luu kem lan chay tren PG that", async () => {
    const runService = new RunService(runRepo);
    const scenarioService = new ScenarioService(scenarioRepo);
    await scenarioService.seedIfEmpty(sampleYaml);
    const dataService = new DataService(dataRepo, runService, scenarioService, EMPTY_BANNED_LIST);
    const run = await runService.createRun({
      scenarioId: "dat-lich-den-bao-cao",
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    const input = await dataService.generateForRun(run.runId);
    expect(input.data.thongKe.soLichHen).toBe(2);
    const readBack = await dataService.getRunInput(run.runId);
    expect(readBack?.data.benhNhan).toHaveLength(2);
    expect(readBack?.seed).toBe(run.runId);
  });
});
