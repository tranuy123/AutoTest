/**
 * Route proxy nhat ky lan chay dang JSON (S5.6): trang Nhat ky poll
 * endpoint nay moi ~3 giay khi lan chay dang chay. Entry da duoc
 * orchestrator sanitize tu luc ghi - proxy chi chuyen nguyen van.
 */
import { NextResponse } from "next/server";

import { ORCHESTRATOR_URL } from "../../../../../lib/orchestrator";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/logs`,
      { cache: "no-store" },
    );
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "orchestrator_unreachable", message: "Chưa kết nối được Orchestrator" },
      { status: 502 },
    );
  }
}
