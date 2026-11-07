"use client";

/**
 * Nut "Chay lai kich ban nay" (S5.1, man hinh ket qua theo EXPERIENCE):
 * tao mot lan chay MOI cung kich ban + che do, bat dau thuc thi roi
 * chuyen sang trang xem lan chay moi. Lan chay cu khong bi dong vao.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NutChayLai({
  scenarioId,
  mode,
}: {
  scenarioId: string;
  mode: string;
}) {
  const router = useRouter();
  const [dangTao, setDangTao] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  async function chayLai() {
    setDangTao(true);
    setLoi(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId, mode }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        runId?: string;
        message?: string;
      };
      if (!res.ok || !data.runId) {
        throw new Error(data.message ?? "Không tạo được lần chạy mới");
      }
      const startRes = await fetch(
        `/api/runs/${encodeURIComponent(data.runId)}/start`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      if (!startRes.ok) {
        const startData = (await startRes.json().catch(() => ({}))) as { message?: string };
        throw new Error(startData.message ?? "Không bắt đầu được lần chạy mới");
      }
      router.push(`/lan-chay/${encodeURIComponent(data.runId)}`);
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không chạy lại được — thử lại sau");
      setDangTao(false);
    }
  }

  return (
    <span>
      <button type="button" className="nut-phu" onClick={chayLai} disabled={dangTao}>
        {dangTao ? "Đang tạo lần chạy mới…" : "Chạy lại kịch bản này"}
      </button>
      {loi && (
        <span className="thong-bao loi" role="alert" style={{ marginLeft: 12 }}>
          {loi}
        </span>
      )}
    </span>
  );
}
