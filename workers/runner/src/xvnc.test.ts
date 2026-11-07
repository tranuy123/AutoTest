import { createServer, type Server } from "node:net";

import { describe, expect, it } from "vitest";

import { XvncManager, type SpawnedProcess } from "./xvnc.js";

interface FakeChild extends SpawnedProcess {
  args: string[];
  killed: string[];
}

function fakeSpawnFactory(children: FakeChild[]): (cmd: string, args: string[]) => SpawnedProcess {
  return (_cmd, args) => {
    const child: FakeChild = {
      args,
      killed: [],
      pid: 4242,
      kill: (signal) => {
        child.killed.push(signal ?? "SIGTERM");
        return true;
      },
      on: () => child,
    };
    children.push(child);
    return child;
  };
}

describe("XvncManager (S3.1 AC-1, AD-9)", () => {
  it("khoi dong Xvnc dung tham so cua spike va cap display tang dan", async () => {
    // Mo cong VNC gia (5901 cho :91, 5902 cho :92) de waitForPort qua duoc.
    const servers: Server[] = [];
    for (const port of [5901, 5902]) {
      const server = createServer(() => undefined);
      await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
      servers.push(server);
    }
    try {
      const children: FakeChild[] = [];
      const manager = new XvncManager({ spawnFn: fakeSpawnFactory(children) });
      const h1 = await manager.start();
      const h2 = await manager.start();
      expect(h1.display).toBe(":91");
      expect(h1.vncPort).toBe(5901);
      expect(h2.display).toBe(":92");
      expect(h2.vncPort).toBe(5902);
      expect(children[0]?.args).toContain("-rfbport");
      expect(children[0]?.args).toContain("5901");
      expect(children[0]?.args).toContain("-SecurityTypes");
      await h1.stop();
      expect(children[0]?.killed).toContain("SIGTERM");
      await h2.stop();
      // Sau khi stop, so display duoc giai phong va cap lai tu dau trong.
      const h3 = await manager.start();
      expect(h3.display).toBe(":91");
      await h3.stop();
    } finally {
      for (const server of servers) server.close();
    }
  });

  it("Xvnc khong san sang thi bao loi ro va khong giu so display", async () => {
    const children: FakeChild[] = [];
    const manager = new XvncManager({
      spawnFn: fakeSpawnFactory(children),
      readyTimeoutMs: 300,
      baseDisplay: 95,
    });
    let caught: unknown = null;
    try {
      await manager.start();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("VNC");
    expect(children[0]?.killed).toContain("SIGKILL");
  });
});
