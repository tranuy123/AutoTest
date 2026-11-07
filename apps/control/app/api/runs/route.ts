/**
 * Route proxy tao lan chay (S2.2 AC-1): giao dien luon tao lan chay o
 * trang thai cho (queue) kem sinh du lieu; thuc thi that thuoc Epic 3.
 * Cong chan allowlist AD-6 van do orchestrator quyet dinh (403 neu Production).
 */
import { NextResponse } from "next/server";

import { ORCHESTRATOR_URL } from "../../../lib/orchestrator";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, queue: true, generateData: true }),
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "orchestrator_unreachable", message: "Chưa kết nối được Orchestrator" },
      { status: 502 },
    );
  }
}
