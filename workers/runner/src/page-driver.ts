/**
 * PageDriver - lop truu tuong thao tac trang de engine va thu vien buoc
 * khong phu thuoc truc tiep vao Playwright.
 *
 * Nguyen tac dinh danh phan tu ben vung (S3.1 Dev Notes): moi thao tac nhan
 * mot DANH SACH ung vien dinh danh theo thu tu uu tien role -> label ->
 * test-id -> text -> css; driver thu tung ung vien va dung ung vien dau
 * tien hien thi duoc. Selector CSS trang tri chi la phuong an cuoi cung.
 *
 * Hai ban cai dat:
 * - PlaywrightPageDriver: chay tren trang Playwright that (may that/UAT).
 * - FakePageDriver: gia lap trong bo nho de test logic tren moi truong
 *   khong co trinh duyet (Muse VM) - ghi nhat ky thao tac, cho phep dat
 *   san phan tu va gay loi theo kich ban test.
 */
import type { Page } from "playwright";

export type LocatorSpec =
  | { by: "role"; role: string; name?: string }
  | { by: "label"; text: string }
  | { by: "testid"; id: string }
  | { by: "text"; text: string }
  | { by: "css"; selector: string };

/** Khoa chuan de FakePageDriver dang ky phan tu va test tra cuu. */
export function locatorKey(spec: LocatorSpec): string {
  switch (spec.by) {
    case "role":
      return `role:${spec.role}:${spec.name ?? ""}`;
    case "label":
      return `label:${spec.text}`;
    case "testid":
      return `testid:${spec.id}`;
    case "text":
      return `text:${spec.text}`;
    case "css":
      return `css:${spec.selector}`;
  }
}

export interface DriverOptions {
  timeoutMs: number;
}

export interface PageDriver {
  goto(url: string, opts: DriverOptions): Promise<void>;
  currentUrl(): string;
  /** Dien gia tri vao truong dau tien tim thay trong cac ung vien. */
  fillFirst(candidates: LocatorSpec[], value: string, opts: DriverOptions): Promise<void>;
  clickFirst(candidates: LocatorSpec[], opts: DriverOptions): Promise<void>;
  selectFirst(candidates: LocatorSpec[], value: string, opts: DriverOptions): Promise<void>;
  waitFirstVisible(candidates: LocatorSpec[], opts: DriverOptions): Promise<void>;
  /** Doc text hien thi cua phan tu. */
  readFirstText(candidates: LocatorSpec[], opts: DriverOptions): Promise<string>;
  /** Doc gia tri cua o nhap (input value). */
  readFirstValue(candidates: LocatorSpec[], opts: DriverOptions): Promise<string>;
  screenshot(path: string): Promise<void>;
}

/* ------------------------- Playwright that ------------------------- */

type PlaywrightLocator = ReturnType<Page["locator"]>;

export class PlaywrightPageDriver implements PageDriver {
  constructor(private readonly page: Page) {}

  private locatorOf(spec: LocatorSpec): PlaywrightLocator {
    const page = this.page;
    switch (spec.by) {
      case "role":
        // ARIA role cua Playwright la union type; thu vien buoc chi dung cac
        // role pho bien (button, link, textbox...) nen ep ve tham so cua API.
        return page.getByRole(
          spec.role as Parameters<Page["getByRole"]>[0],
          spec.name ? { name: spec.name } : {},
        ) as PlaywrightLocator;
      case "label":
        return page.getByLabel(spec.text);
      case "testid":
        return page.getByTestId(spec.id);
      case "text":
        return page.getByText(spec.text);
      case "css":
        return page.locator(spec.selector);
    }
  }

  /** Tim ung vien dau tien hien thi trong thoi gian cho con lai. */
  private async firstVisible(
    candidates: LocatorSpec[],
    timeoutMs: number,
  ): Promise<PlaywrightLocator> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    for (const spec of candidates) {
      const remaining = Math.max(1, deadline - Date.now());
      const probe = Math.min(remaining, Math.max(250, Math.floor(timeoutMs / candidates.length)));
      const locator = this.locatorOf(spec).first();
      try {
        await locator.waitFor({ state: "visible", timeout: probe });
        return locator;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `Không tìm thấy phần tử nào trong ${candidates.length} định danh ứng viên` +
        (lastError instanceof Error ? ` (${lastError.message.split("\n")[0]})` : ""),
    );
  }

  async goto(url: string, opts: DriverOptions): Promise<void> {
    await this.page.goto(url, { timeout: opts.timeoutMs, waitUntil: "domcontentloaded" });
  }

  currentUrl(): string {
    return this.page.url();
  }

  async fillFirst(
    candidates: LocatorSpec[],
    value: string,
    opts: DriverOptions,
  ): Promise<void> {
    const locator = await this.firstVisible(candidates, opts.timeoutMs);
    await locator.fill(value, { timeout: opts.timeoutMs });
  }

  async clickFirst(candidates: LocatorSpec[], opts: DriverOptions): Promise<void> {
    const locator = await this.firstVisible(candidates, opts.timeoutMs);
    await locator.click({ timeout: opts.timeoutMs });
  }

  async selectFirst(
    candidates: LocatorSpec[],
    value: string,
    opts: DriverOptions,
  ): Promise<void> {
    const locator = await this.firstVisible(candidates, opts.timeoutMs);
    await locator.selectOption(value, { timeout: opts.timeoutMs });
  }

  async waitFirstVisible(candidates: LocatorSpec[], opts: DriverOptions): Promise<void> {
    await this.firstVisible(candidates, opts.timeoutMs);
  }

  async readFirstText(candidates: LocatorSpec[], opts: DriverOptions): Promise<string> {
    const locator = await this.firstVisible(candidates, opts.timeoutMs);
    return (await locator.innerText({ timeout: opts.timeoutMs })).trim();
  }

  async readFirstValue(candidates: LocatorSpec[], opts: DriverOptions): Promise<string> {
    const locator = await this.firstVisible(candidates, opts.timeoutMs);
    return locator.inputValue({ timeout: opts.timeoutMs });
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: false });
  }
}

/* ------------------------- Gia lap (test) ------------------------- */

export interface FakeElement {
  visible: boolean;
  text?: string;
  value?: string;
}

export interface FakeOp {
  op: string;
  key?: string;
  value?: string;
  url?: string;
}

export class FakePageDriver implements PageDriver {
  readonly elements = new Map<string, FakeElement>();
  readonly ops: FakeOp[] = [];
  private url = "about:blank";
  private readonly failures = new Map<string, Error>();

  /** Dat san mot phan tu theo dinh danh (test dung de dung canh CRM gia). */
  setElement(spec: LocatorSpec, element: FakeElement): this {
    this.elements.set(locatorKey(spec), { ...element });
    return this;
  }

  /** Buoc thao tac tren phan tu nay se nem loi (mo phong loi giao dien). */
  failOn(spec: LocatorSpec, error: Error): this {
    this.failures.set(locatorKey(spec), error);
    return this;
  }

  private find(candidates: LocatorSpec[]): { key: string; element: FakeElement } {
    for (const spec of candidates) {
      const key = locatorKey(spec);
      const failure = this.failures.get(key);
      if (failure) throw failure;
      const element = this.elements.get(key);
      if (element?.visible) return { key, element };
    }
    throw new Error(
      `Không tìm thấy phần tử nào trong ${candidates.length} định danh ứng viên`,
    );
  }

  async goto(url: string): Promise<void> {
    this.ops.push({ op: "goto", url });
    this.url = url;
  }

  currentUrl(): string {
    return this.url;
  }

  async fillFirst(candidates: LocatorSpec[], value: string): Promise<void> {
    const { key, element } = this.find(candidates);
    element.value = value;
    this.ops.push({ op: "fill", key, value });
  }

  async clickFirst(candidates: LocatorSpec[]): Promise<void> {
    const { key } = this.find(candidates);
    this.ops.push({ op: "click", key });
  }

  async selectFirst(candidates: LocatorSpec[], value: string): Promise<void> {
    const { key, element } = this.find(candidates);
    element.value = value;
    this.ops.push({ op: "select", key, value });
  }

  async waitFirstVisible(candidates: LocatorSpec[]): Promise<void> {
    const { key } = this.find(candidates);
    this.ops.push({ op: "wait", key });
  }

  async readFirstText(candidates: LocatorSpec[]): Promise<string> {
    const { key, element } = this.find(candidates);
    this.ops.push({ op: "readText", key });
    return element.text ?? "";
  }

  async readFirstValue(candidates: LocatorSpec[]): Promise<string> {
    const { key, element } = this.find(candidates);
    this.ops.push({ op: "readValue", key });
    return element.value ?? "";
  }

  async screenshot(path: string): Promise<void> {
    this.ops.push({ op: "screenshot", value: path });
  }
}
