/**
 * Factory phien trinh duyet (S3.1 AC-1, AC-4).
 * Moi phien = 1 Chromium rieng + 1 browser context rieng (cookie/session
 * khong dung chung giua cac vai - S3.3 AC-1) + thu muc video rieng.
 * Dong phien sach: context.close() (de Playwright xuat video) -> browser.close().
 *
 * PlaywrightSessionFactory la ban chay that; FakeSessionFactory phuc vu
 * test logic khi khong co trinh duyet (Muse VM).
 */
import { join } from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { FakePageDriver, PlaywrightPageDriver, type PageDriver } from "./page-driver.js";
import type { SessionRequest } from "./types.js";
import type { DisplayHandle } from "./xvnc.js";

export interface BrowserSessionHandle {
  driver: PageDriver;
  /** Dong context + browser; tra duong dan video sau khi dong (neu co). */
  close: () => Promise<{ videoPath: string | null }>;
}

export interface SessionFactory {
  launch: (
    req: SessionRequest,
    display: DisplayHandle | null,
  ) => Promise<BrowserSessionHandle>;
}

export class PlaywrightSessionFactory implements SessionFactory {
  async launch(
    req: SessionRequest,
    display: DisplayHandle | null,
  ): Promise<BrowserSessionHandle> {
    const headless = req.mode === "nhanh";
    const browser: Browser = await chromium.launch({
      headless,
      slowMo: req.mode === "xem" ? (req.paceMs ?? 0) : 0,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      env: display
        ? { ...process.env, DISPLAY: display.display }
        : { ...process.env },
    });
    const videoDir = join(req.artifactsDir, "video", req.roleId);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
      });
      page = await context.newPage();
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
    const driver = new PlaywrightPageDriver(page);
    let closed = false;
    return {
      driver,
      close: async () => {
        if (closed) return { videoPath: null };
        closed = true;
        let videoPath: string | null = null;
        try {
          await context?.close();
          videoPath = (await page?.video()?.path().catch(() => null)) ?? null;
        } finally {
          await browser.close().catch(() => undefined);
        }
        return { videoPath };
      },
    };
  }
}

/* ------------------------- Gia lap (test) ------------------------- */

export interface FakeLaunchRecord {
  req: SessionRequest;
  display: DisplayHandle | null;
  driver: FakePageDriver;
  closed: boolean;
}

export class FakeSessionFactory implements SessionFactory {
  readonly launches: FakeLaunchRecord[] = [];
  /** Gan truoc phan tu CRM gia cho moi driver moi (dung trong test). */
  setupDriver: ((driver: FakePageDriver, req: SessionRequest) => void) | null = null;
  failLaunchWith: Error | null = null;

  async launch(
    req: SessionRequest,
    display: DisplayHandle | null,
  ): Promise<BrowserSessionHandle> {
    if (this.failLaunchWith) throw this.failLaunchWith;
    const driver = new FakePageDriver();
    this.setupDriver?.(driver, req);
    const record: FakeLaunchRecord = { req, display, driver, closed: false };
    this.launches.push(record);
    return {
      driver,
      close: async () => {
        record.closed = true;
        return { videoPath: join(req.artifactsDir, "video", req.roleId, "video.webm") };
      },
    };
  }

  /** So phien chua dong - test dung de chung minh dong sach (AC-4). */
  get openCount(): number {
    return this.launches.filter((l) => !l.closed).length;
  }
}
