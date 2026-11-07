import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrchestratorServer } from "./server.js";
import { makeTestConfig } from "./testing.js";

describe("orchestrator /health (S1.1)", () => {
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

  it("GET /health tra { status: ok }", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("duong dan la tra 404", async () => {
    const res = await fetch(`${baseUrl}/khong-ton-tai`);
    expect(res.status).toBe(404);
  });
});
