/**
 * Spike S3.0 - harness do chinh.
 * Cung 1 kich ban cho ca 2 phuong an stream:
 * - N phien Chrome headed (Playwright) thao tac trang dich mau (go/click/cuon).
 * - Phuong an "cdp": CDP screencast (JPEG) -> WebSocket relay -> viewer ve canvas.
 * - Phuong an "novnc": moi phien 1 may chu X+VNC rieng, cau WebSocket (websockify)
 *   -> viewer dung thu vien @novnc/novnc that.
 *   GHI CHU HA TANG: ke hoach goc dung Xvfb + x11vnc, nhung goi x11vnc khong
 *   cai duoc tren VM nay (apt khong co danh sach goi Ubuntu - xem bao cao
 *   spike). Thay bang Xvnc cua TigerVNC (may chu X ao tich hop VNC, cung
 *   giao thuc RFB, cung client noVNC) - khac biet chi o tang may chu X.
 * Do: do tre hinh (giai ma dong ho khoi tren canvas phia xem), CPU/RAM theo nhom
 * tien trinh, so khung/byte, so lan dut stream va khoang trong khung > 500ms.
 *
 * Vi du:
 *   node lib/measure.js --method cdp   --sessions 4 --duration 90
 *   node lib/measure.js --method novnc --sessions 4 --duration 3600 --label on-dinh
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { writeFile, readdir, readFile } from "node:fs/promises";
import { hostname, cpus, totalmem, freemem } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { chromium } from "playwright";
import WebSocket from "ws";

import { CLOCK_GEOMETRY, decodeClockFromCanvas } from "./clock-codec.js";
import { CdpRelay, VncBridge, startStaticServer } from "./servers.js";
import { ResourceSampler, summarize } from "./proc-stats.js";

const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));
const HTTP_PORT = 8901;
const RELAY_PORT = 8910;
const XVFB_CDP_DISPLAY = 90;
const CHROME_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--mute-audio",
  "--window-size=1280,720",
];

function parseArgs(argv) {
  const args = { method: "cdp", sessions: 1, duration: 90, warmup: 10, label: "" };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--method") args.method = argv[++i];
    else if (key === "--sessions") args.sessions = Number(argv[++i]);
    else if (key === "--duration") args.duration = Number(argv[++i]);
    else if (key === "--warmup") args.warmup = Number(argv[++i]);
    else if (key === "--label") args.label = argv[++i];
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tim pid tien trinh Chrome chinh (khong co --type=) chua duoc gan cho phien nao.
 * Playwright 1.65 khong con browser.process(), nen quet /proc theo cmdline.
 */
const assignedChromePids = new Set();
async function findNewChromeMainPid() {
  for (const pidStr of await readdir("/proc")) {
    if (!/^\d+$/.test(pidStr)) continue;
    const pid = Number(pidStr);
    if (assignedChromePids.has(pid)) continue;
    try {
      const cmd = await readFile(`/proc/${pid}/cmdline`, "utf8");
      if (
        cmd.includes("ms-playwright") &&
        cmd.includes("--user-data-dir=") &&
        !cmd.includes("--type=") &&
        !cmd.includes("headless_shell")
      ) {
        assignedChromePids.add(pid);
        return pid;
      }
      if (
        cmd.includes("headless_shell") &&
        cmd.includes("--user-data-dir=") &&
        !cmd.includes("--type=")
      ) {
        assignedChromePids.add(pid);
        return pid;
      }
    } catch { /* tien trinh vua thoat */ }
  }
  return null;
}

function waitForPort(port, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.end();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`timeout cho cong ${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function spawnLogged(cmd, args, tag, logLines) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => logLines.push(`[${tag}] ${d}`.slice(0, 300)));
  child.stderr.on("data", (d) => logLines.push(`[${tag}!] ${d}`.slice(0, 300)));
  child.on("error", (err) => logLines.push(`[${tag}!] loi spawn: ${err.message}`));
  return child;
}

async function runActivity(page, stopFlag, sessionIdx) {
  const texts = ["Nguyen Van Minh", "Tran Thi Hoa", "Le Van Duc", "Pham Thu Trang"];
  let round = 0;
  while (!stopFlag.stopped) {
    round++;
    try {
      await page.click("#ten");
      await page.keyboard.press("Control+A");
      await page.keyboard.type(texts[(sessionIdx + round) % texts.length], { delay: 25 });
      await page.click("#sdt");
      await page.keyboard.press("Control+A");
      await page.keyboard.type("01123456" + String(10 + ((sessionIdx * 7 + round) % 89)), { delay: 25 });
      await page.click("#dat");
      await page.mouse.wheel(0, 500);
      await sleep(350);
      await page.mouse.wheel(0, -500);
      await sleep(350);
    } catch {
      if (stopFlag.stopped) break;
      await sleep(500);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = new Date();
  const result = {
    spike: "S3.0",
    method: args.method,
    sessionsRequested: args.sessions,
    durationSec: args.duration,
    warmupSec: args.warmup,
    startedAt: startedAt.toISOString(),
    machine: {
      hostname: hostname(),
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown",
      totalMemMB: Math.round(totalmem() / 1048576),
      freeMemMBatStart: Math.round(freemem() / 1048576),
    },
    errors: [],
    sessions: [],
  };
  const logLines = [];
  const stopFlag = { stopped: false };
  const infraProcs = [];
  const bridges = [];
  let relay = null;
  let httpServer = null;
  const targetBrowsers = [];
  const targetPages = [];
  const cdpPublishers = [];
  let viewerBrowser = null;
  const viewerPages = [];
  let sampler = null;

  try {
    httpServer = await startStaticServer(HTTP_PORT);
    if (args.method === "cdp") relay = new CdpRelay(RELAY_PORT);

    // --- Ha tang X/VNC ---
    const xvfbPids = [];
    const vncPids = [];
    if (args.method === "cdp") {
      const xvfb = spawnLogged("Xvfb", [`:${XVFB_CDP_DISPLAY}`, "-screen", "0", "1280x720x24", "-nolisten", "tcp"], "xvfb", logLines);
      infraProcs.push(xvfb);
      xvfbPids.push(xvfb.pid);
      await sleep(800);
    }

    // --- Mo cac phien dich ---
    for (let i = 0; i < args.sessions; i++) {
      const sessionInfo = { index: i, launched: false, crashed: false, t0: null };
      result.sessions.push(sessionInfo);
      let display;
      if (args.method === "novnc") {
        const dispNum = 91 + i;
        display = `:${dispNum}`;
        const vncPort = 5901 + i;
        // Xvnc = may chu X ao + VNC server trong 1 tien trinh (thay cap Xvfb+x11vnc).
        const xvnc = spawnLogged(
          "Xvnc",
          [display, "-geometry", "1280x720", "-depth", "24", "-rfbport", String(vncPort),
           "-SecurityTypes", "None", "-localhost", "-AlwaysShared"],
          `xvnc${i}`,
          logLines,
        );
        infraProcs.push(xvnc);
        vncPids.push(xvnc.pid);
        await waitForPort(vncPort);
        await sleep(300);
        const bridge = new VncBridge(6901 + i, vncPort);
        bridges.push(bridge);
        sessionInfo.vncPort = vncPort;
        sessionInfo.bridgePort = 6901 + i;
      } else {
        display = `:${XVFB_CDP_DISPLAY}`;
      }

      try {
        const browser = await chromium.launch({
          headless: false,
          args: CHROME_ARGS,
          env: { ...process.env, DISPLAY: display },
        });
        sessionInfo.launched = true;
        sessionInfo.browserPid = await findNewChromeMainPid();
        browser.on("disconnected", () => {
          sessionInfo.crashed = true;
          sessionInfo.crashedAt = new Date().toISOString();
        });
        targetBrowsers.push(browser);
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${HTTP_PORT}/target?session=${i}`, { waitUntil: "load" });
        sessionInfo.t0 = await page.evaluate(() => window.__t0);
        targetPages.push(page);
        sessionInfo.activity = runActivity(page, stopFlag, i);
      } catch (error) {
        sessionInfo.launchError = String(error).slice(0, 500);
        result.errors.push(`phien ${i}: ${sessionInfo.launchError}`);
      }
    }

    // --- Gan stream phia worker (CDP) ---
    if (args.method === "cdp") {
      for (let i = 0; i < targetPages.length; i++) {
        const page = targetPages[i];
        const sessionInfo = result.sessions[i];
        try {
          const cdp = await page.context().newCDPSession(page);
          const ws = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/?session=${i}&role=pub`);
          await new Promise((resolve, reject) => {
            ws.once("open", resolve);
            ws.once("error", reject);
          });
          cdpPublishers.push(ws);
          let framesSent = 0;
          cdp.on("Page.screencastFrame", (event) => {
            framesSent++;
            sessionInfo.framesSent = framesSent;
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(Buffer.from(event.data, "base64"));
            }
            cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
          });
          await cdp.send("Page.startScreencast", {
            format: "jpeg",
            quality: 65,
            maxWidth: 1280,
            maxHeight: 720,
            everyNthFrame: 1,
          });
          sessionInfo.streamAttached = true;
        } catch (error) {
          sessionInfo.streamError = String(error).slice(0, 300);
        }
      }
    }

    // --- Mo cac trang xem ---
    viewerBrowser = await chromium.launch({ headless: true, args: CHROME_ARGS });
    result.viewerBrowserPid = await findNewChromeMainPid();
    const viewerContext = await viewerBrowser.newContext({ viewport: { width: 1300, height: 760 } });
    for (let i = 0; i < args.sessions; i++) {
      const vpage = await viewerContext.newPage();
      if (args.method === "cdp") {
        await vpage.goto(`http://127.0.0.1:${HTTP_PORT}/viewer-cdp?session=${i}&relay=ws://127.0.0.1:${RELAY_PORT}`);
      } else {
        await vpage.goto(`http://127.0.0.1:${HTTP_PORT}/viewer-novnc?ws=ws://127.0.0.1:${6901 + i}`);
      }
      viewerPages.push(vpage);
    }

    // Cho viewer doc duoc dong ho lan dau (hoac het thoi gian cho).
    const decodeExpr = `(${decodeClockFromCanvas.toString()})(window.__canvas(), ${JSON.stringify(CLOCK_GEOMETRY)})`;
    for (let i = 0; i < viewerPages.length; i++) {
      const deadline = Date.now() + 25000;
      let ok = false;
      while (Date.now() < deadline) {
        try {
          const v = await viewerPages[i].evaluate(decodeExpr);
          if (typeof v === "number") { ok = true; break; }
        } catch { /* canvas chua san sang */ }
        await sleep(400);
      }
      result.sessions[i].viewerReady = ok;
      if (!ok) result.errors.push(`phien ${i}: viewer khong doc duoc dong ho sau 25s`);
    }

    // --- Lay mau tai nguyen ---
    sampler = new ResourceSampler(() => ({
      phien: { roots: result.sessions.map((s) => s.browserPid).filter((p) => typeof p === "number"), expand: true },
      "ha-tang-x-vnc": { roots: [...xvfbPids, ...vncPids], expand: false },
      "phia-xem": { roots: typeof result.viewerBrowserPid === "number" ? [result.viewerBrowserPid] : [], expand: true },
      "cong-stream-trong-harness": { roots: [process.pid], expand: false },
    }), 2000);
    sampler.start();

    await sleep(args.warmup * 1000);
    const measureStart = Date.now();
    result.measureStartedAt = new Date(measureStart).toISOString();

    // --- Vong lay mau do tre ---
    const latencyBySession = result.sessions.map(() => []);
    const staleBySession = result.sessions.map(() => ({ events: 0, active: false, lastValue: null, lastChangeAt: Date.now(), nullSamples: 0, samples: 0 }));
    while (Date.now() - measureStart < args.duration * 1000) {
      for (let i = 0; i < viewerPages.length; i++) {
        const sessionInfo = result.sessions[i];
        if (!sessionInfo.launched || sessionInfo.crashed) continue;
        const st = staleBySession[i];
        try {
          const decoded = await viewerPages[i].evaluate(decodeExpr);
          st.samples++;
          if (typeof decoded !== "number") {
            st.nullSamples++;
            continue;
          }
          const latency = Date.now() - sessionInfo.t0 - decoded;
          if (latency >= -100 && latency < 60000) latencyBySession[i].push(latency);
          if (st.lastValue === null || decoded !== st.lastValue) {
            st.lastValue = decoded;
            st.lastChangeAt = Date.now();
            st.active = false;
          } else if (!st.active && Date.now() - st.lastChangeAt > 500) {
            st.events++;
            st.active = true;
          }
        } catch {
          st.nullSamples++;
        }
      }
      await sleep(120);
    }
    const measureEnd = Date.now();
    result.measureEndedAt = new Date(measureEnd).toISOString();

    // --- Tong hop ---
    const resourceSamples = sampler.stop();
    sampler = null;
    result.resourceSampleCount = resourceSamples.length;
    const groupNames = ["phien", "ha-tang-x-vnc", "phia-xem", "cong-stream-trong-harness"];
    result.resources = {};
    for (const name of groupNames) {
      const rss = resourceSamples.map((r) => r[name]?.rssMB).filter((v) => typeof v === "number");
      const cpu = resourceSamples.map((r) => r[name]?.cpuPct).filter((v) => typeof v === "number");
      result.resources[name] = { rssMB: summarize(rss), cpuPct: summarize(cpu) };
    }
    const launchedCount = result.sessions.filter((s) => s.launched).length || 1;
    result.resources.perSession = {
      rssMB: result.resources.phien.rssMB.avg !== null ? Math.round((result.resources.phien.rssMB.avg / launchedCount) * 10) / 10 : null,
      cpuPct: result.resources.phien.cpuPct.avg !== null ? Math.round((result.resources.phien.cpuPct.avg / launchedCount) * 10) / 10 : null,
    };

    const allLatency = latencyBySession.flat();
    result.latencyAll = summarize(allLatency);
    const relaySnap = relay ? relay.snapshot() : null;
    for (let i = 0; i < result.sessions.length; i++) {
      const s = result.sessions[i];
      s.crashedDuringMeasure = Boolean(s.crashed);
      s.latencyMs = summarize(latencyBySession[i]);
      s.staleEvents = staleBySession[i].events;
      s.decodeSamples = staleBySession[i].samples;
      s.decodeNullSamples = staleBySession[i].nullSamples;
      if (args.method === "cdp" && relaySnap) {
        const rs = relaySnap[String(i)] ?? {};
        s.framesViaRelay = rs.frames ?? 0;
        s.fps = Math.round(((rs.frames ?? 0) / args.duration) * 10) / 10;
        s.streamKBps = Math.round((((rs.bytes ?? 0) / 1024) / args.duration) * 10) / 10;
        s.frameGapsOver500ms = rs.gaps ?? 0;
        s.pubDisconnects = rs.pubDisconnects ?? 0;
        s.subDisconnects = rs.subDisconnects ?? 0;
      }
      if (args.method === "novnc") {
        const bs = bridges[i] ? bridges[i].snapshot() : {};
        s.streamKBps = Math.round((((bs.bytesFromVnc ?? 0) / 1024) / args.duration) * 10) / 10;
        s.bridgeBytesFromVnc = bs.bytesFromVnc ?? 0;
        s.bridgeBytesToVnc = bs.bytesToVnc ?? 0;
        s.bridgeConnections = bs.connections ?? 0;
        s.bridgeDisconnects = bs.disconnects ?? 0;
      }
      try {
        s.viewerStats = await viewerPages[i].evaluate(() => window.__stats);
      } catch { /* viewer da dong */ }
      delete s.activity;
      delete s.t0;
    }
  } catch (error) {
    result.fatalError = String(error && error.stack ? error.stack : error).slice(0, 1500);
  } finally {
    stopFlag.stopped = true;
    if (sampler) sampler.stop();
    for (const ws of cdpPublishers) try { ws.terminate(); } catch { /* bo qua */ }
    for (const bridge of bridges) await bridge.close().catch(() => {});
    if (relay) await relay.close().catch(() => {});
    for (const b of targetBrowsers) await b.close().catch(() => {});
    if (viewerBrowser) await viewerBrowser.close().catch(() => {});
    for (const p of infraProcs) try { p.kill("SIGTERM"); } catch { /* bo qua */ }
    if (httpServer) await new Promise((r) => httpServer.close(() => r()));
    result.endedAt = new Date().toISOString();
    result.logTail = logLines.slice(-30);
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    const name = `${args.method}-${args.sessions}phien${args.label ? "-" + args.label : ""}-${stamp}.json`;
    const payload = JSON.stringify(result, null, 2);
    try {
      await writeFile(join(RESULTS_DIR, name), payload);
    } catch (writeError) {
      // Du phong: ghi ra /tmp va in loi goc ra stderr de khong mat bang chung.
      console.error("LOI GHI KET QUA:", writeError);
      console.error("FATAL GOC:", result.fatalError ?? "(khong co)");
      await writeFile(join("/tmp", name), payload).catch(() => {});
    }
    console.log(JSON.stringify({
      file: name,
      method: result.method,
      sessionsRequested: result.sessionsRequested,
      launched: result.sessions.filter((s) => s.launched).length,
      latencyAll: result.latencyAll ?? null,
      perSession: result.perSession ?? result.resources?.perSession ?? null,
      resources: result.resources,
      sessions: result.sessions.map((s) => ({
        i: s.index, launched: s.launched, crashed: s.crashed ?? false, viewerReady: s.viewerReady ?? false,
        latency: s.latencyMs ?? null, stale: s.staleEvents ?? null, fps: s.fps ?? null,
        kbps: s.streamKBps ?? null, gaps: s.frameGapsOver500ms ?? null,
        pubDisc: s.pubDisconnects ?? null, bridgeDisc: s.bridgeDisconnects ?? null,
        viewerStats: s.viewerStats ?? null,
      })),
      errors: result.errors,
      fatalError: result.fatalError ?? null,
    }, null, 2));
  }
}

await main();
