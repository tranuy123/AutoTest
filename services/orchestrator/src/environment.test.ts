import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrchestratorServer } from "./server.js";
import { makeTestConfig } from "./testing.js";

describe("API moi truong + cong chan (S1.2 AC-2, AC-3, AC-4)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createOrchestratorServer({ config: makeTestConfig() });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("GET /api/environment tra trang thai va khong lo mat khau", async () => {
    const res = await fetch(`${baseUrl}/api/environment`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("mat-khau-gia-test");
    const body = JSON.parse(text) as {
      targetBaseUrl: string;
      targetEvaluation: { allowed: boolean };
      roles: Array<{ id: string; configured: boolean }>;
    };
    expect(body.targetBaseUrl).toBe("https://uat.example.invalid");
    expect(body.targetEvaluation.allowed).toBe(true);
    expect(body.roles.find((r) => r.id === "le-tan")?.configured).toBe(true);
    expect(body.roles.find((r) => r.id === "quan-ly")?.configured).toBe(false);
  });

  it("POST /api/runs voi URL production mau bi chan 403 kem thong diep da chan", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenarioId: "kich-ban-mau",
        targetUrl: "https://crm.phongkham-that.vn",
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { blocked: boolean; message: string };
    expect(body.blocked).toBe(true);
    expect(body.message).toContain("đã chặn");
  });

  it("POST /api/runs voi URL la bi chan 403", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "kich-ban-mau", targetUrl: "https://la.example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/runs voi URL UAT trong allowlist thi qua duoc cong chan (chua tao lan chay - S1.3)", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "kich-ban-mau" }),
    });
    // 501 = da qua cong chan, dung o buoc tao lan chay (thuoc S1.3)
    expect(res.status).toBe(501);
  });
});
