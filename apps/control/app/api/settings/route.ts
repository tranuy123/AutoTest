/**
 * Route proxy cau hinh khai bao (S5.5): GET doc cau hinh hieu luc da che
 * (khong co mat khau), PUT gui khai bao moi len Orchestrator - validate
 * (dinh dang URL, cong chan allowlist AD-6, vai hop le) do Orchestrator
 * quyet dinh; loi 400 kem message tieng Viet duoc chuyen nguyen ve.
 */
import { NextResponse } from "next/server";

import { ORCHESTRATOR_URL } from "../../../lib/orchestrator";

export async function GET() {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/settings`, { cache: "no-store" });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "orchestrator_unreachable", message: "Chưa kết nối được Orchestrator" },
      { status: 502 },
    );
  }
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
