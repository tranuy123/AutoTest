import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { StreamGateway } from "./stream-gateway.js";
import { acceptWebSocket } from "./ws-min.js";

/**
 * Kiem chung cau noVNC bang socket that (S3.2 AC-1/AC-3 o muc gateway):
 * VNC gia lap gui loi chao RFB, viewer dung WebSocket client co san cua
 * Node 24. Ngat VNC giua chung -> viewer bi dong, gateway bao mat tin hieu,
 * va gateway khong nem loi ra ngoai (lan chay khong bi anh huong - AD-7).
 */
describe("StreamGateway - cau WebSocket <-> VNC (S3.2)", () => {
  let vncServer: NetServer;
  let vncSocket: Socket | null = null;
  let vncReceived: Buffer[] = [];
  let httpServer: HttpServer;
  let port = 0;
  const gateway = new StreamGateway();

  beforeAll(async () => {
    vncServer = createNetServer((socket) => {
      vncSocket = socket;
      socket.write(Buffer.from("RFB 003.008\n"));
      socket.on("data", (d) => vncReceived.push(d));
    });
    await new Promise<void>((resolve) => vncServer.listen(0, "127.0.0.1", resolve));
    const vncPort = (vncServer.address() as { port: number }).port;
    gateway.register("ses-1", vncPort);

    httpServer = createHttpServer();
    httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const match = /^\/stream\/([^/]+)$/.exec(url.pathname);
      const ws = match ? acceptWebSocket(req, socket as never, head) : null;
      if (!ws || !match) {
        socket.destroy();
        return;
      }
      gateway.handleConnection(decodeURIComponent(match[1] ?? ""), ws);
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    port = (httpServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    vncSocket?.destroy();
    await new Promise<void>((resolve) => vncServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("chuyen tiep du lieu hai chieu giua viewer va VNC", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/stream/ses-1`);
    ws.binaryType = "arraybuffer";
    const received: string[] = [];
    ws.addEventListener("message", (event) => {
      const data = event.data as ArrayBuffer;
      received.push(Buffer.from(data).toString("utf8"));
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("WS loi")));
    });
    // Cho loi chao RFB tu VNC qua cau.
    await new Promise((r) => setTimeout(r, 200));
    expect(received.join("")).toContain("RFB 003.008");
    // Viewer -> VNC.
    vncReceived = [];
    ws.send(new Uint8Array([1, 2, 3, 4]));
    await new Promise((r) => setTimeout(r, 200));
    expect(Buffer.concat(vncReceived).equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
    expect(gateway.statusOf("ses-1")?.viewers).toBe(1);
    expect(gateway.statusOf("ses-1")?.state).toBe("dang-phat");
    ws.close();
  });

  it("mat VNC giua chung: viewer bi dong, gateway bao mat tin hieu, khong nem loi (AC-3, AD-7)", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/stream/ses-1`);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("WS loi")));
    });
    await new Promise((r) => setTimeout(r, 150));
    const closed = new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve());
    });
    vncSocket?.destroy();
    vncSocket = null;
    await closed;
    const info = gateway.statusOf("ses-1");
    expect(info?.state).toBe("mat-tin-hieu");
    expect(info?.lastError).toContain("VNC");
    // Phien van dang ky (lan chay tiep tuc) - gateway chi doi trang thai.
    expect(gateway.has("ses-1")).toBe(true);
  });

  it("phien khong co stream thi dong ket noi ngay", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/stream/khong-co`);
    const closed = new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve());
      ws.addEventListener("error", () => resolve());
    });
    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
});
