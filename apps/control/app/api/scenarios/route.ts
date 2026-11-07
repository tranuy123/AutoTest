/**
 * Route proxy thu vien kich ban (S2.2):
 * GET  - liet ke kich ban tu orchestrator
 * POST - nap file (multipart form-data, truong "file"): .yaml doc text,
 *        .xlsx ma hoa base64; orchestrator validate bang schema S2.1.
 */
import { NextResponse } from "next/server";

import { ORCHESTRATOR_URL } from "../../../lib/orchestrator";

export async function GET() {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/scenarios`, { cache: "no-store" });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "orchestrator_unreachable", message: "Chưa kết nối được Orchestrator" },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file", message: "Chưa chọn file kịch bản" }, { status: 400 });
  }
  const name = file.name.toLowerCase();
  let payload: Record<string, unknown>;
  if (name.endsWith(".xlsx")) {
    const buf = Buffer.from(await file.arrayBuffer());
    payload = { filename: file.name, format: "excel", contentBase64: buf.toString("base64") };
  } else if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    payload = { filename: file.name, format: "yaml", contentText: await file.text() };
  } else {
    return NextResponse.json(
      {
        errors: [
          {
            file: file.name,
            line: null,
            field: "(file)",
            message: "Chỉ nạp được file .yaml hoặc .xlsx",
          },
        ],
      },
      { status: 422 },
    );
  }
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/scenarios`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
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
