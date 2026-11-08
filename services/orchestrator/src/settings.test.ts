/**
 * Test S5.5: trang cau hinh khai bao dich UAT + tai khoan theo vai.
 * - GET /api/settings che mat khau + quet ro ri toan than phan hoi.
 * - PUT validate fail-closed (URL sai, dich ngoai allowlist, vai la).
 * - Uu tien settings > env, fallback env, mat khau rong = giu cu.
 * - Cong chan AD-6 va executor dung cau hinh HIEU LUC (doc truc tiep).
 */
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScenarioYaml } from "@autotest/scenario-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EffectiveConfigResolver } from "./effective-config.js";
import { createOrchestratorServer, type OrchestratorDeps } from "./server.js";
import { InMemorySettingsRepository, SettingsService } from "./settings-store.js";
import { makeExecutionStack, makeFullRoleConfig, makeTestConfig } from "./testing.js";

async function bootServer(deps: OrchestratorDeps): Promise<{ server: Server; baseUrl: string }> {
  const server = createOrchestratorServer(deps);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

interface SettingsViewBody {
  targetBaseUrl: string;
  targetAllowlist: string;
  testTenant: string;
  roles: Array<{ roleId: string; username: string | null; hasPassword: boolean }>;
}

describe("API /api/settings — doc che mat khau + ghi co validate (S5.5)", () => {
  const config = makeFullRoleConfig();
  const service = new SettingsService(new InMemorySettingsRepository(), config);
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await bootServer({ config, settingsService: service }));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("GET tra cau hinh hieu luc tu .env, quet ro ri: khong chua mat khau o bat ky dau", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    expect(res.status).toBe(200);
    const text = await res.text();
    // Quet ro ri tren TOAN THAN phan hoi (tinh than test S1.2).
    expect(text).not.toContain("mat-khau-gia-test");
    expect(text).not.toContain('"password":');
    const body = JSON.parse(text) as SettingsViewBody;
    expect(body.targetBaseUrl).toBe("https://uat.example.invalid");
    expect(body.testTenant).toBe("autotest-tenant-mau");
    expect(body.roles).toHaveLength(5);
    const leTan = body.roles.find((r) => r.roleId === "le-tan");
    expect(leTan?.username).toBe("le-tan-mau@example.invalid");
    expect(leTan?.hasPassword).toBe(true);
  });

  it("PUT doi dich + allowlist: GET settings va GET /api/environment thay doi ngay", async () => {
    const put = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetBaseUrl: "https://uat2.example.invalid",
        targetAllowlist: "https://uat2.example.invalid",
        testTenant: "tenant-uat-2",
      }),
    });
    expect(put.status).toBe(200);
    const view = (await put.json()) as SettingsViewBody;
    expect(view.targetBaseUrl).toBe("https://uat2.example.invalid");
    expect(view.testTenant).toBe("tenant-uat-2");

    const env = await fetch(`${baseUrl}/api/environment`);
    const envBody = (await env.json()) as {
      targetBaseUrl: string;
      targetEvaluation: { allowed: boolean };
    };
    expect(envBody.targetBaseUrl).toBe("https://uat2.example.invalid");
    expect(envBody.targetEvaluation.allowed).toBe(true);
  });

  it("PUT dich ngoai allowlist hieu luc bi tu choi 400 va khong luu", async () => {
    const put = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetBaseUrl: "https://crm.phongkham-that.vn" }),
    });
    expect(put.status).toBe(400);
    const body = (await put.json()) as { message: string };
    expect(body.message).toContain("allowlist");

    const get = await fetch(`${baseUrl}/api/settings`);
    const view = (await get.json()) as SettingsViewBody;
    expect(view.targetBaseUrl).toBe("https://uat2.example.invalid");
  });

  it("PUT URL sai dinh dang / khong phai http(s) bi tu choi 400", async () => {
    for (const targetBaseUrl of ["khong phai url", "ftp://uat2.example.invalid"]) {
      const put = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetBaseUrl }),
      });
      expect(put.status).toBe(400);
      const body = (await put.json()) as { message: string };
      expect(body.message.length).toBeGreaterThan(0);
    }
  });

  it("PUT vai la bi tu choi 400", async () => {
    const put = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roles: { "vai-khong-ton-tai": { username: "x@y.invalid" } } }),
    });
    expect(put.status).toBe(400);
    const body = (await put.json()) as { message: string };
    expect(body.message).toContain("Vai không tồn tại");
  });

  it("PUT mat khau moi: khong lo qua API, executor doc duoc; de trong = giu nguyen", async () => {
    const put = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roles: { "le-tan": { password: "mat-khau-moi-s5-5", username: "le-tan-moi@example.invalid" } },
      }),
    });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain("mat-khau-moi-s5-5");
    expect(putText).not.toContain("mat-khau-gia-test");

    const get = await fetch(`${baseUrl}/api/settings`);
    const getText = await get.text();
    expect(getText).not.toContain("mat-khau-moi-s5-5");
    const view = JSON.parse(getText) as SettingsViewBody;
    const leTan = view.roles.find((r) => r.roleId === "le-tan");
    expect(leTan?.username).toBe("le-tan-moi@example.invalid");
    expect(leTan?.hasPassword).toBe(true);

    // Lop noi bo (executor) doc duoc mat khau hieu luc tu settings.
    const resolver = new EffectiveConfigResolver(config, service);
    const account = await resolver.getRoleAccount("le-tan");
    expect(account?.password).toBe("mat-khau-moi-s5-5");
    expect(account?.username).toBe("le-tan-moi@example.invalid");

    // Mat khau rong khi luu = giu nguyen mat khau vua dat.
    const put2 = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roles: { "le-tan": { password: "" } } }),
    });
    expect(put2.status).toBe(200);
    const account2 = await resolver.getRoleAccount("le-tan");
    expect(account2?.password).toBe("mat-khau-moi-s5-5");
  });

  it("chua noi settingsService thi /api/settings tra 501", async () => {
    const bare = await bootServer({ config: makeTestConfig() });
    try {
      const get = await fetch(`${bare.baseUrl}/api/settings`);
      expect(get.status).toBe(501);
      const put = await fetch(`${bare.baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(put.status).toBe(501);
    } finally {
      await closeServer(bare.server);
    }
  });
});

describe("EffectiveConfigResolver — settings thang env, thieu thi fallback (S5.5)", () => {
  it("kho rong: moi gia tri la cua .env, co sandbox giu nguyen tu env", async () => {
    const config = makeFullRoleConfig();
    const resolver = new EffectiveConfigResolver(
      config,
      new SettingsService(new InMemorySettingsRepository(), config),
    );
    const target = await resolver.getTarget();
    expect(target.baseUrl).toBe("https://uat.example.invalid");
    expect(target.allowlist).toEqual(["https://uat.example.invalid"]);
    expect(target.tenant).toBe("autotest-tenant-mau");
    const account = await resolver.getRoleAccount("bac-si");
    expect(account?.username).toBe("bac-si-mau@example.invalid");
    expect(account?.password).toBe("mat-khau-gia-test");
    const status = await resolver.getEnvironmentStatus();
    expect(status.channelsSandbox).toBe(true);
    expect(status.roles.find((r) => r.id === "bac-si")?.configured).toBe(true);
  });

  it("co settings: chi truong duoc khai bao bi ghi de, con lai van env", async () => {
    const config = makeFullRoleConfig();
    const repo = new InMemorySettingsRepository();
    await repo.setMany([
      ["target.baseUrl", "https://uat9.example.invalid"],
      ["role.bac-si.username", "bac-si-9@example.invalid"],
    ]);
    const resolver = new EffectiveConfigResolver(
      config,
      new SettingsService(repo, config),
    );
    const target = await resolver.getTarget();
    expect(target.baseUrl).toBe("https://uat9.example.invalid");
    expect(target.allowlist).toEqual(["https://uat.example.invalid"]);
    const bacSi = await resolver.getRoleAccount("bac-si");
    expect(bacSi?.username).toBe("bac-si-9@example.invalid");
    expect(bacSi?.password).toBe("mat-khau-gia-test");
    const thuNgan = await resolver.getRoleAccount("thu-ngan");
    expect(thuNgan?.username).toBe("thu-ngan-mau@example.invalid");
    expect(await resolver.getRoleAccount("vai-la")).toBeNull();
  });
});

describe("Cong chan AD-6 dung cau hinh hieu luc sau PUT (S5.5 AC-5)", () => {
  const config = makeTestConfig();
  const service = new SettingsService(new InMemorySettingsRepository(), config);
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await bootServer({ config, settingsService: service }));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  async function taoLanChay(targetUrl?: string): Promise<number> {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "kich-ban-mau", ...(targetUrl ? { targetUrl } : {}) }),
    });
    return res.status;
  }

  it("truoc PUT: dich uat2 bi chan 403; sau PUT mo allowlist thi qua cong (501)", async () => {
    expect(await taoLanChay("https://uat2.example.invalid")).toBe(403);

    const put = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetAllowlist: "https://uat.example.invalid, https://uat2.example.invalid",
      }),
    });
    expect(put.status).toBe(200);

    // 501 = da qua cong chan, dung o buoc tao lan chay (server test khong
    // noi kho lan chay) - dung mau cua environment.test.ts (S1.2).
    expect(await taoLanChay("https://uat2.example.invalid")).toBe(501);
  });

  it("dich mac dinh cua lan chay lay tu cau hinh hieu luc sau PUT", async () => {
    const put = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetBaseUrl: "https://uat2.example.invalid" }),
    });
    expect(put.status).toBe(200);
    // Khong gui targetUrl: dich mac dinh la uat2 (trong allowlist hieu luc).
    expect(await taoLanChay()).toBe(501);
    // Dich cu (env) van trong allowlist nen van qua cong khi chi dinh ro.
    expect(await taoLanChay("https://uat.example.invalid")).toBe(501);
    // Dich ngoai ca hai van bi chan.
    expect(await taoLanChay("https://la.example.com")).toBe(403);
  });
});

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

describe("Executor lay tai khoan vai tu settings khai bao (S5.5 AC-5)", () => {
  const overrides = { ROLE_QUAN_LY_USERNAME: "", ROLE_QUAN_LY_PASSWORD: "" };

  async function chayKichBanMau(
    stack: Awaited<ReturnType<typeof makeExecutionStack>>,
  ): Promise<Map<string, string>> {
    const usernames = new Map<string, string>();
    const original = stack.worker.createSession.bind(stack.worker);
    stack.worker.createSession = async (req) => {
      usernames.set(req.roleId, req.username);
      return original(req);
    };
    const yaml = await readFile(SAMPLE_YAML, "utf8");
    const parsed = parseScenarioYaml(yaml);
    if (!parsed.ok) throw new Error("YAML mẫu không hợp lệ");
    await stack.scenarioService.importScenario({
      filename: "dat-lich-den-bao-cao.yaml",
      format: "yaml",
      contentText: yaml,
    });
    const run = await stack.runService.createRun({
      scenarioId: parsed.scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("qua");
    return usernames;
  }

  it("env thieu tai khoan quan-ly: khai bao qua settings thi chay QUA voi dung tai khoan do", async () => {
    const serviceConfig = makeFullRoleConfig(overrides);
    const service = new SettingsService(new InMemorySettingsRepository(), serviceConfig);
    const saved = await service.update({
      roles: {
        "quan-ly": {
          username: "quan-ly-khai-bao@example.invalid",
          password: "mat-khau-quan-ly-s5-5",
        },
      },
    });
    expect(saved.ok).toBe(true);

    const stack = await makeExecutionStack(overrides, { settingsService: service });
    const usernames = await chayKichBanMau(stack);
    expect(usernames.get("quan-ly")).toBe("quan-ly-khai-bao@example.invalid");
    expect(usernames.get("le-tan")).toBe("le-tan-mau@example.invalid");
  });

  it("doi chung: khong co settings thi lan chay HONG vi thieu tai khoan quan-ly", async () => {
    const stack = await makeExecutionStack(overrides);
    const yaml = await readFile(SAMPLE_YAML, "utf8");
    const parsed = parseScenarioYaml(yaml);
    if (!parsed.ok) throw new Error("YAML mẫu không hợp lệ");
    await stack.scenarioService.importScenario({
      filename: "dat-lich-den-bao-cao.yaml",
      format: "yaml",
      contentText: yaml,
    });
    const run = await stack.runService.createRun({
      scenarioId: parsed.scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("hong");
  });
});
