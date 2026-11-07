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
  // S5.2: vi tri hang doi lan chay + trang thai gui yeu cau dung.
  const [hangDoi, setHangDoi] = useState<number | null>(banDau?.queuePosition ?? null);
  const [dangGuiDung, setDangGuiDung] = useState(false);
  const [daGuiDung, setDaGuiDung] = useState(false);
  const [loiDung, setLoiDung] = useState<string | null>(null);
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
      // Trang thai tong cua lan chay: vi tri hang doi (S5.2 AC-1) va
      // ket qua cuoi - ke ca khi lan chay bi dung ma cac vai chua tung
      // mo phien (khong the suy ra tu trang thai vai).
      const detailRes = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      if (detailRes.ok) {
        const detail = (await detailRes.json()) as {
          status?: string;
          resultLabel?: string;
          queuePosition?: number | null;
        };
        setHangDoi(detail.queuePosition ?? null);
        if (
          detail.status === "qua" ||
          detail.status === "hong" ||
          detail.status === "dung"
        ) {
          dungPoll.current = true;
          setKetQuaCuoi(detail.resultLabel ?? null);
          return;
        }
      }
      const xongHet = data.roles.every((r) => r.state === "xong" || r.state === "loi");
      if (xongHet && data.roles.length > 0) {
        dungPoll.current = true;
        const detailRes2 = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
          cache: "no-store",
        });
        if (detailRes2.ok) {
          const detail = (await detailRes2.json()) as { resultLabel?: string };
          setKetQuaCuoi(detail.resultLabel ?? null);
        }
      }
    } catch {
      setLoiTai("Chưa tải được trạng thái lần chạy — đang thử lại…");
    }
  }, [runId]);

  // S5.2 AC-2: gui yeu cau dung an toan - orchestrator dung sau buoc
  // hien tai, dong phien va van chay buoc don du lieu.
  const guiDungLanChay = useCallback(async () => {
    setDangGuiDung(true);
    setLoiDung(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("bad");
      setDaGuiDung(true);
    } catch {
      setLoiDung("Không gửi được yêu cầu dừng — thử lại sau giây lát.");
    } finally {
      setDangGuiDung(false);
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

  const thanhDieuKhien = !ketQuaCuoi ? (
    <div
      className="the"
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
        justifyContent: "space-between",
      }}
    >
      <span role="status">
        {hangDoi !== null ? (
          <>
            <span className="trang-thai cho">● Đang chờ phiên trống</span> — vị trí{" "}
            <strong>{hangDoi}</strong> trong hàng đợi. Lần chạy sẽ tự bắt đầu khi có
            phiên trống.
          </>
        ) : daGuiDung ? (
          "Đã ghi yêu cầu dừng — hệ thống dừng sau bước hiện tại và vẫn dọn dữ liệu…"
        ) : (
          "Lần chạy đang hoạt động."
        )}
      </span>
      <button
        type="button"
        className="nut-nguy-hiem"
        onClick={guiDungLanChay}
        disabled={dangGuiDung || daGuiDung}
      >
        {daGuiDung ? "Đang dừng lần chạy…" : "Dừng lần chạy này"}
      </button>
      {loiDung && (
        <span className="thong-bao loi" role="alert">
          {loiDung}
        </span>
      )}
    </div>
  ) : null;

  if (streams.fastMode) {
    return (
      <>
        {thanhDieuKhien}
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
            ✓ Lần chạy đã kết thúc — kết quả: <strong>{ketQuaCuoi}</strong>.{" "}
            <a href={`/ket-qua/${encodeURIComponent(runId)}`}>Mở trang kết quả</a> để
            xem bảng đối chiếu và tải báo cáo.
          </p>
        )}
      </>
    );
  }

  return (
    <>
      {thanhDieuKhien}
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
          ✓ Lần chạy đã kết thúc — kết quả: <strong>{ketQuaCuoi}</strong>.{" "}
          <a href={`/ket-qua/${encodeURIComponent(runId)}`}>Mở trang kết quả</a> để xem
          video phát lại, bảng đối chiếu và báo cáo dọn.
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
