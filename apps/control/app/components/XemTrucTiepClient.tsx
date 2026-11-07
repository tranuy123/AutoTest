"use client";

/**
 * Trang xem lan chay (S3.2 + S3.4 AC-1):
 * - Che do xem truc tiep: luoi o stream theo vai (nhan vai, buoc hien tai,
 *   vien + chu trang thai), poll trang thai vai tu orchestrator moi 1.5s.
 * - O nao bi gateway bao mat tin hieu thi hien "Mat tin hieu stream - lan
 *   chay van tiep tuc" (AC-3), khong lam gian doan cac o khac.
 * - Che do chay nhanh: lop phu "Che do chay nhanh - khong co stream"
 *   dung ban mau da duyet, chi hien tien do theo vai.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { RoleStreamView, RunStreamsView } from "../../lib/orchestrator";
import OStreamNoVnc from "./OStreamNoVnc";

const MAU_VIEN: Record<RoleStreamView["state"], string> = {
  cho: "vien-cho",
  "dang-chay": "vien-dang-chay",
  xong: "vien-xong",
  loi: "vien-loi",
};

const MAU_CHAM: Record<RoleStreamView["state"], string> = {
  cho: "var(--chu-phu)",
  "dang-chay": "var(--cho)",
  xong: "var(--qua)",
  loi: "var(--hong)",
};

export default function XemTrucTiepClient({
  runId,
  banDau,
}: {
  runId: string;
  banDau: RunStreamsView | null;
}) {
  const [streams, setStreams] = useState<RunStreamsView | null>(banDau);
  const [ketQuaCuoi, setKetQuaCuoi] = useState<string | null>(null);
  const [loiTai, setLoiTai] = useState<string | null>(null);
  const [matTinHieu, setMatTinHieu] = useState<ReadonlySet<string>>(new Set());
  const dungPoll = useRef(false);

  const taiTrangThai = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/streams`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("bad");
      const data = (await res.json()) as RunStreamsView;
      setStreams(data);
      setLoiTai(null);
      const xongHet = data.roles.every((r) => r.state === "xong" || r.state === "loi");
      if (xongHet && data.roles.length > 0) {
        dungPoll.current = true;
        const detailRes = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
          cache: "no-store",
        });
        if (detailRes.ok) {
          const detail = (await detailRes.json()) as { resultLabel?: string };
          setKetQuaCuoi(detail.resultLabel ?? null);
        }
      }
    } catch {
      setLoiTai("Chưa tải được trạng thái lần chạy — đang thử lại…");
    }
  }, [runId]);

  useEffect(() => {
    void taiTrangThai();
    const id = setInterval(() => {
      if (!dungPoll.current) void taiTrangThai();
    }, 1500);
    return () => clearInterval(id);
  }, [taiTrangThai]);

  if (!streams) {
    return (
      <div className="the">
        <p className="so-lieu">
          {loiTai ?? "Đang tải trạng thái lần chạy… (nếu kéo dài, kiểm tra Orchestrator đã chạy chưa)"}
        </p>
      </div>
    );
  }

  if (streams.fastMode) {
    return (
      <>
        <div className="the lop-phu-chay-nhanh">
          <h2 style={{ marginTop: 0 }}>Chế độ chạy nhanh — không có stream</h2>
          <p className="mo-ta" style={{ marginBottom: 0 }}>
            Lần chạy này chạy headless để lấy kết quả nhanh nên không phát hình trực
            tiếp. Tiến độ theo vai ở dưới; video thao tác (nếu có) xem ở trang kết quả
            sau khi chạy xong.
          </p>
        </div>
        <BangTienDoVai roles={streams.roles} />
        {ketQuaCuoi && (
          <p className="thong-bao tot" role="status">
            ✓ Lần chạy đã kết thúc — kết quả: <strong>{ketQuaCuoi}</strong>
          </p>
        )}
      </>
    );
  }

  return (
    <>
      {loiTai && (
        <p className="thong-bao loi" role="alert">
          {loiTai}
        </p>
      )}
      <div className="luoi-stream">
        {streams.roles.map((role) => {
          const streamMat = role.stream?.state === "mat-tin-hieu" || matTinHieu.has(role.roleId);
          return (
            <section key={role.roleId} className={`o-stream ${MAU_VIEN[role.state]}`}>
              <header className="dau-o-stream">
                <strong>{role.label}</strong>
                <span className="trang-thai-o">
                  <span aria-hidden style={{ color: MAU_CHAM[role.state] }}>
                    ●
                  </span>{" "}
                  {role.stateLabel}
                </span>
              </header>
              {role.stream?.wsUrl && role.state === "dang-chay" ? (
                <OStreamNoVnc
                  wsUrl={role.stream.wsUrl}
                  nhanVai={role.label}
                  onMatTinHieu={() =>
                    setMatTinHieu((truoc) => new Set(truoc).add(role.roleId))
                  }
                />
              ) : (
                <div className="khung-stream">
                  <div className="man-hinh-stream trong" />
                  <div className="lop-phu-stream">
                    {role.state === "cho" && <p>Đang chờ phiên của {role.label} bắt đầu…</p>}
                    {role.state === "dang-chay" && streamMat && (
                      <p>Mất tín hiệu stream — lần chạy vẫn tiếp tục.</p>
                    )}
                    {role.state === "dang-chay" && !streamMat && <p>Đang mở stream…</p>}
                    {role.state === "xong" && <p>✓ {role.label} đã chạy xong.</p>}
                    {role.state === "loi" && <p>✗ Phiên của {role.label} bị lỗi — xem bước lỗi ở dưới.</p>}
                  </div>
                </div>
              )}
              {role.state === "dang-chay" && streamMat && (
                <p className="thong-bao loi" role="alert" style={{ margin: "10px 0 0" }}>
                  Mất tín hiệu stream — lần chạy vẫn tiếp tục.
                </p>
              )}
              <footer className="chan-o-stream">
                {role.currentStepLabel
                  ? `Bước hiện tại: ${role.currentStepLabel}`
                  : role.state === "cho"
                    ? "Chưa bắt đầu"
                    : "Đã hoàn tất các bước"}
              </footer>
            </section>
          );
        })}
      </div>
      {ketQuaCuoi && (
        <p className="thong-bao tot" role="status">
          ✓ Lần chạy đã kết thúc — kết quả: <strong>{ketQuaCuoi}</strong>. Xem chi tiết
          và báo cáo dọn ở mục Lịch sử chạy.
        </p>
      )}
    </>
  );
}

function BangTienDoVai({ roles }: { roles: RoleStreamView[] }) {
  return (
    <div className="the">
      <table className="bang">
        <thead>
          <tr>
            <th>Vai</th>
            <th>Trạng thái</th>
            <th>Bước hiện tại</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.roleId}>
              <td>{role.label}</td>
              <td>
                <span aria-hidden style={{ color: MAU_CHAM[role.state] }}>
                  ●
                </span>{" "}
                {role.stateLabel}
              </td>
              <td>{role.currentStepLabel ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
