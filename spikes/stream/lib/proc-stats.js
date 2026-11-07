/**
 * Spike S3.0 - do CPU/RAM theo nhom tien trinh bang /proc (Linux).
 * CPU% tinh tu delta (utime+stime) giua 2 lan lay mau; RSS la tong VmRSS.
 * Moi nhom khai bao { roots, expand }: expand=true thi gom ca con chau,
 * expand=false thi chi dung cac pid ke khai (vd tien trinh harness).
 */
import { readdir, readFile } from "node:fs/promises";

const CLK_TCK = 100;

async function readAllProcs() {
  const all = new Map();
  for (const pidStr of await readdir("/proc")) {
    if (!/^\d+$/.test(pidStr)) continue;
    const pid = Number(pidStr);
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const closeIdx = stat.lastIndexOf(")");
      const fields = stat.slice(closeIdx + 2).split(" ");
      const status = await readFile(`/proc/${pid}/status`, "utf8");
      const rssMatch = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
      all.set(pid, {
        pid,
        ppid: Number(fields[1]),
        cpuTicks: Number(fields[11]) + Number(fields[12]),
        rssKB: rssMatch ? Number(rssMatch[1]) : 0,
      });
    } catch {
      /* tien trinh vua thoat */
    }
  }
  return all;
}

function treeFrom(all, roots) {
  const childrenOf = new Map();
  for (const info of all.values()) {
    if (!childrenOf.has(info.ppid)) childrenOf.set(info.ppid, []);
    childrenOf.get(info.ppid).push(info.pid);
  }
  const result = new Set();
  const queue = [...roots];
  while (queue.length) {
    const pid = queue.pop();
    if (result.has(pid)) continue;
    result.add(pid);
    for (const child of childrenOf.get(pid) ?? []) queue.push(child);
  }
  return result;
}

/** spec: { tenNhom: { roots: number[], expand: boolean } } */
export async function sampleGroups(spec) {
  const all = await readAllProcs();
  const out = {};
  for (const [name, cfg] of Object.entries(spec)) {
    const pids = cfg.expand ? treeFrom(all, cfg.roots) : new Set(cfg.roots);
    let rssKB = 0;
    let cpuTicks = 0;
    let count = 0;
    for (const pid of pids) {
      const info = all.get(pid);
      if (!info) continue;
      rssKB += info.rssKB;
      cpuTicks += info.cpuTicks;
      count++;
    }
    out[name] = { rssMB: rssKB / 1024, cpuTicks, procs: count };
  }
  return out;
}

export class ResourceSampler {
  constructor(specFn, intervalMs = 2000) {
    this.specFn = specFn;
    this.intervalMs = intervalMs;
    this.samples = [];
    this.timer = null;
    this.last = null;
    this.lastAt = 0;
  }

  start() {
    const tick = async () => {
      try {
        const now = Date.now();
        const snap = await sampleGroups(this.specFn());
        if (this.last && this.lastAt) {
          const dtSec = (now - this.lastAt) / 1000;
          const row = { at: now };
          for (const [name, cur] of Object.entries(snap)) {
            const prev = this.last[name];
            const dTicks = prev ? cur.cpuTicks - prev.cpuTicks : 0;
            row[name] = {
              rssMB: Math.round(cur.rssMB * 10) / 10,
              cpuPct: prev ? Math.round(((dTicks / CLK_TCK / dtSec) * 100 + Number.EPSILON) * 10) / 10 : 0,
              procs: cur.procs,
            };
          }
          this.samples.push(row);
        }
        this.last = snap;
        this.lastAt = now;
      } catch {
        /* bo qua lan lay mau loi */
      }
    };
    void tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    return this.samples;
  }
}

/** Thong ke tom tat cho 1 mang so. */
export function summarize(values) {
  if (!values.length) return { n: 0, avg: null, median: null, p95: null, max: null, min: null };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    n: sorted.length,
    avg: round(sum / sorted.length),
    median: round(pick(0.5)),
    p95: round(pick(0.95)),
    max: round(sorted[sorted.length - 1]),
    min: round(sorted[0]),
  };
}
