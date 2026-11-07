/** Route proxy chi tiet/xoa kich ban (S2.2 AC-3). */
import { NextResponse } from "next/server";

import { ORCHESTRATOR_URL } from "../../../../lib/orchestrator";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/scenarios/${encodeURIComponent(id)}`, {
      cache: "no-store",
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

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/scenarios/${encodeURIComponent(id)}`, {
      method: "DELETE",
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
