/**
 * Route proxy bat dau thuc thi lan chay (Epic 3): Control khong tu quyet
 * dinh dich - orchestrator kiem tra lai allowlist (AD-6) truoc khi chay.
 */
import { NextResponse } from "next/server";

import { ORCHESTRATOR_URL } from "../../../../../lib/orchestrator";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/start`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
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
