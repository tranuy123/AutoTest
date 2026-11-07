/**
 * Spike S3.0 - cac may chu phu tro trong tien trinh do:
 * - HTTP tinh: trang dich mau, 2 trang viewer, ma nguon @novnc/novnc.
 * - CdpRelay: WebSocket nhan khung screencast tu phia worker, phat cho viewer;
 *   dem khung/byte, khoang trong > 500ms va so lan dut ket noi.
 * - VncBridge: cau WebSocket <-> TCP toi VNC server (vai tro websockify),
 *   dem byte 2 chieu va so ket noi/dut ket noi.
 */
import { createServer as createHttpServer } from "node:http";
import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocketServer, WebSocket } from "ws";

const LIB_DIR = fileURLToPath(new URL(".", import.meta.url));
const NOVNC_DIR = fileURLToPath(new URL("../node_modules/@novnc/novnc/", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

export function startStaticServer(port) {
  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let filePath;
      if (url.pathname === "/target") filePath = join(LIB_DIR, "target.html");
      else if (url.pathname === "/viewer-cdp") filePath = join(LIB_DIR, "viewer-cdp.html");
      else if (url.pathname === "/viewer-novnc") filePath = join(LIB_DIR, "viewer-novnc.html");
      else if (url.pathname.startsWith("/novnc/")) {
        const rel = normalize(url.pathname.slice("/novnc/".length));
        if (rel.startsWith("..")) throw new Error("bad path");
        filePath = join(NOVNC_DIR, rel);
      } else {
        res.writeHead(404).end("not found");
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

export class CdpRelay {
  constructor(port) {
    this.stats = new Map(); // session -> {frames, bytes, gaps, pubDisconnects, subDisconnects}
    this.subs = new Map(); // session -> Set<WebSocket>
    this.wss = new WebSocketServer({ port, host: "127.0.0.1" });
    this.wss.on("connection", (socket, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const session = url.searchParams.get("session") ?? "0";
      const role = url.searchParams.get("role") ?? "sub";
      const st = this.#stat(session);
      socket.binaryType = "nodebuffer";
      if (role === "sub") {
        if (!this.subs.has(session)) this.subs.set(session, new Set());
        this.subs.get(session).add(socket);
        socket.on("close", () => {
          st.subDisconnects++;
          this.subs.get(session)?.delete(socket);
        });
        return;
      }
      // role = pub (phia worker day khung len)
      st.pubConnected = true;
      socket.on("message", (data) => {
        const now = Date.now();
        if (st.lastFrameAt && now - st.lastFrameAt > 500) st.gaps++;
        st.lastFrameAt = now;
        st.frames++;
        st.bytes += data.length;
        for (const sub of this.subs.get(session) ?? []) {
          if (sub.readyState === WebSocket.OPEN) sub.send(data);
        }
      });
      socket.on("close", () => {
        st.pubDisconnects++;
        st.pubConnected = false;
      });
    });
  }

  #stat(session) {
    if (!this.stats.has(session)) {
      this.stats.set(session, {
        frames: 0,
        bytes: 0,
        gaps: 0,
        pubDisconnects: 0,
        subDisconnects: 0,
        pubConnected: false,
        lastFrameAt: 0,
      });
    }
    return this.stats.get(session);
  }

  snapshot() {
    return Object.fromEntries(this.stats);
  }

  async close() {
    for (const clients of this.subs.values()) for (const s of clients) s.terminate();
    await new Promise((r) => this.wss.close(() => r()));
  }
}

export class VncBridge {
  constructor(wsPort, vncPort) {
    this.wsPort = wsPort;
    this.vncPort = vncPort;
    this.stats = { connections: 0, disconnects: 0, bytesToVnc: 0, bytesFromVnc: 0, active: 0 };
    this.wss = new WebSocketServer({ port: wsPort, host: "127.0.0.1" });
    this.wss.on("connection", (socket) => {
      this.stats.connections++;
      this.stats.active++;
      socket.binaryType = "nodebuffer";
      const tcp = createConnection({ port: vncPort, host: "127.0.0.1" });
      let closed = false;
      const done = () => {
        if (closed) return;
        closed = true;
        this.stats.disconnects++;
        this.stats.active--;
        try { socket.terminate(); } catch { /* da dong */ }
        try { tcp.destroy(); } catch { /* da dong */ }
      };
      socket.on("message", (data) => {
        this.stats.bytesToVnc += data.length;
        if (tcp.writable) tcp.write(data);
      });
      tcp.on("data", (data) => {
        this.stats.bytesFromVnc += data.length;
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      });
      socket.on("close", done);
      socket.on("error", done);
      tcp.on("close", done);
      tcp.on("error", done);
    });
  }

  snapshot() {
    return { ...this.stats };
  }

  async close() {
    for (const client of this.wss.clients) client.terminate();
    await new Promise((r) => this.wss.close(() => r()));
  }
}
