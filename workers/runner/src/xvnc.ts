/**
 * Quan ly man hinh ao Xvnc (TigerVNC) - moi phien xem truc tiep co mot
 * X server rieng kem VNC server rieng (AD-9, chot qua spike S3.0).
 * Xvnc thay cap Xvfb + x11vnc (x11vnc khong cai duoc tren VM; tren may that
 * co the dung ban TigerVNC tuong duong - xem BAO-CAO-SPIKE.md).
 *
 * So hieu display bat dau tu 91 (tranh display that cua may), cong RFB =
 * 5810 + so display (display :91 -> cong 5901, khop harness cua spike).
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";

export interface SpawnedProcess {
  pid?: number | undefined;
  kill: (signal?: NodeJS.Signals) => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

export type SpawnFn = (command: string, args: string[]) => SpawnedProcess;

const defaultSpawn: SpawnFn = (command, args) =>
  spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }) as unknown as SpawnedProcess;

export interface DisplayHandle {
  display: string;
  displayNumber: number;
  vncPort: number;
  stop: () => Promise<void>;
}

export interface XvncManagerOptions {
  baseDisplay?: number;
  geometry?: string;
  spawnFn?: SpawnFn;
  /** Thoi gian cho cong VNC chap nhan ket noi (ms). */
  readyTimeoutMs?: number;
}

export class XvncManager {
  private readonly baseDisplay: number;
  private readonly geometry: string;
  private readonly spawnFn: SpawnFn;
  private readonly readyTimeoutMs: number;
  private readonly inUse = new Set<number>();

  constructor(options: XvncManagerOptions = {}) {
    this.baseDisplay = options.baseDisplay ?? 91;
    this.geometry = options.geometry ?? "1280x720";
    this.spawnFn = options.spawnFn ?? defaultSpawn;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
  }

  /** Cong RFB suy tu so display (khop quy uoc cua spike S3.0). */
  static vncPortFor(displayNumber: number): number {
    return 5810 + displayNumber;
  }

  private allocateNumber(): number {
    let n = this.baseDisplay;
    while (this.inUse.has(n)) n++;
    this.inUse.add(n);
    return n;
  }

  /** Khoi dong mot Xvnc moi va cho cong VNC san sang. */
  async start(): Promise<DisplayHandle> {
    const displayNumber = this.allocateNumber();
    const vncPort = XvncManager.vncPortFor(displayNumber);
    const args = [
      `:${displayNumber}`,
      "-geometry",
      this.geometry,
      "-depth",
      "24",
      "-rfbport",
      String(vncPort),
      "-SecurityTypes",
      "None",
      "-localhost",
      "-AlwaysShared",
    ];
    let child: SpawnedProcess;
    try {
      child = this.spawnFn("Xvnc", args);
    } catch (error) {
      this.inUse.delete(displayNumber);
      throw new Error(
        `Không khởi động được Xvnc cho display :${displayNumber}: ` +
          (error instanceof Error ? error.message : "lỗi không rõ"),
      );
    }
    let exited = false;
    child.on("exit", () => {
      exited = true;
    });
    try {
      await this.waitForPort(vncPort, () => exited);
    } catch (error) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Tien trinh da chet.
      }
      this.inUse.delete(displayNumber);
      throw error;
    }
    let stopped = false;
    return {
      display: `:${displayNumber}`,
      displayNumber,
      vncPort,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        this.inUse.delete(displayNumber);
        try {
          child.kill("SIGTERM");
        } catch {
          // Tien trinh da chet.
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (!exited) {
          try {
            child.kill("SIGKILL");
          } catch {
            // Tien trinh da chet.
          }
        }
      },
    };
  }

  private async waitForPort(port: number, hasExited: () => boolean): Promise<void> {
    const deadline = Date.now() + this.readyTimeoutMs;
    for (;;) {
      if (hasExited()) {
        throw new Error(`Xvnc đã thoát trước khi cổng VNC ${port} sẵn sàng`);
      }
      const open = await new Promise<boolean>((resolve) => {
        const socket = createConnection({ port, host: "127.0.0.1" });
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      });
      if (open) return;
      if (Date.now() > deadline) {
        throw new Error(`Quá hạn chờ cổng VNC ${port} sẵn sàng`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** Kiem tra nhanh Xvnc co tren may khong (phuc vu chan doan khi khoi dong). */
export function xvncAvailable(spawnFn: SpawnFn = defaultSpawn): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawnFn("Xvnc", ["-version"]);
      let settled = false;
      child.on("error", () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
      child.on("exit", () => {
        if (!settled) {
          settled = true;
          resolve(true);
        }
      });
    } catch {
      resolve(false);
    }
  });
}
