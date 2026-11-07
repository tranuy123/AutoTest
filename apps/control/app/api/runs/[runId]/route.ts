/**
 * Route proxy chi tiet lan chay (trang thai tong, buoc, bao cao don -
 * S2.4) cho trang xem truc tiep poll khi can ket qua cuoi.
 */
import { NextResponse } from "next/server";

import { ORCHESTRATOR_URL } from "../../../../lib/orchestrator";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}`,
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
