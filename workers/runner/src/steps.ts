/**
 * Thu vien buoc co ban (S3.1 AC-2): mo trang, dien form, bam nut, chon muc,
 * cho phan tu, doc gia tri hien thi, chup anh man hinh.
 * Moi buoc co timeout ro rang (truyen vao hoac mac dinh
 * DEFAULT_STEP_TIMEOUT_MS) va loi nem ra la StepError neu dung ten buoc +
 * ly do - khong de loi tho cua driver ro len tang tren.
 */
import type { LocatorSpec, PageDriver } from "./page-driver.js";
import { DEFAULT_STEP_TIMEOUT_MS, StepError } from "./types.js";

export interface StepContext {
  /** Id buoc trong kich ban - dua vao thong diep loi. */
  stepId: string;
  timeoutMs?: number;
}

function timeoutOf(ctx: StepContext): number {
  return ctx.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
}

async function run<T>(ctx: StepContext, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof StepError) throw error;
    const reason = error instanceof Error ? error.message.split("\n")[0] : "lỗi không rõ";
    throw new StepError(ctx.stepId, reason ?? "lỗi không rõ");
  }
}

export async function moTrang(
  driver: PageDriver,
  ctx: StepContext,
  url: string,
): Promise<void> {
  await run(ctx, () => driver.goto(url, { timeoutMs: timeoutOf(ctx) }));
}

export async function dienTruong(
  driver: PageDriver,
  ctx: StepContext,
  candidates: LocatorSpec[],
  value: string,
): Promise<void> {
  await run(ctx, () => driver.fillFirst(candidates, value, { timeoutMs: timeoutOf(ctx) }));
}

export async function bamNut(
  driver: PageDriver,
  ctx: StepContext,
  candidates: LocatorSpec[],
): Promise<void> {
  await run(ctx, () => driver.clickFirst(candidates, { timeoutMs: timeoutOf(ctx) }));
}

export async function chonMuc(
  driver: PageDriver,
  ctx: StepContext,
  candidates: LocatorSpec[],
  value: string,
): Promise<void> {
  await run(ctx, () =>
    driver.selectFirst(candidates, value, { timeoutMs: timeoutOf(ctx) }),
  );
}

export async function choPhanTu(
  driver: PageDriver,
  ctx: StepContext,
  candidates: LocatorSpec[],
): Promise<void> {
  await run(ctx, () => driver.waitFirstVisible(candidates, { timeoutMs: timeoutOf(ctx) }));
}

export async function docGiaTriHienThi(
  driver: PageDriver,
  ctx: StepContext,
  candidates: LocatorSpec[],
): Promise<string> {
  return run(ctx, () => driver.readFirstText(candidates, { timeoutMs: timeoutOf(ctx) }));
}

export async function docGiaTriNhap(
  driver: PageDriver,
  ctx: StepContext,
  candidates: LocatorSpec[],
): Promise<string> {
  return run(ctx, () => driver.readFirstValue(candidates, { timeoutMs: timeoutOf(ctx) }));
}

export async function chupAnhManHinh(
  driver: PageDriver,
  ctx: StepContext,
  path: string,
): Promise<void> {
  await run(ctx, () => driver.screenshot(path));
}
