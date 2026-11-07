/**
 * Route proxy trang thai stream theo vai (S3.2): trinh duyet poll endpoint
 * nay de ve luoi o stream + nhan buoc hien tai cua tung vai.
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
      `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/streams`,
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
