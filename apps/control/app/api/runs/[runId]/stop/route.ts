/**
 * Route proxy dung an toan lan chay (S5.2 AC-2): chuyen yeu cau dung
 * xuong Orchestrator - noi quyet dinh dung sau buoc hien tai, dong
 * phien va van chay buoc don du lieu.
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
      `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/stop`,
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
