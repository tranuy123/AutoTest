"use client";

/**
 * Trang nhat ky lan chay (S5.6):
 * - Hien toan bo entry cua lan chay theo thu tu thoi gian, monospace;
 *   dong loi do, canh bao vang (mau + chu nhu DESIGN.md).
 * - Loc theo vai (chi cac vai co mat trong log) va theo muc (Tat ca /
 *   Chi loi).
 * - Lan chay dang chay: tu lam moi moi ~3 giay qua proxy; chay xong
 *   thi dung poll (cung mau voi XemTrucTiepClient).
 * - Hai nut hanh dong lon: "Tai log (.txt)" (file gui di ho tro) va
 *   "Sao chep toan bo log" (lay dung ban .txt ve clipboard).
 * Entry da duoc orchestrator sanitize tu luc ghi - trang chi hien thi.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  logsProxyUrl,
  logsTextProxyUrl,
  roleLabel,
  type RunLogEntryView,
  type RunLogsView,
} from "../../lib/orchestrator";

function gioHienThi(ts: string): string {
  const date = new Date(ts);
  return Number.isNaN(date.getTime())
    ? "--:--:--"
    : date.toLocaleTimeString("vi-VN", { timeZone: "Asia/Saigon", hour12: false });
}

function dongText(entry: RunLogEntryView): string {
  return `${gioHienThi(entry.ts)} | ${entry.roleId ?? "-"} | ${entry.stepId ?? "-"} | ${entry.level.toUpperCase()} | ${entry.message || entry.event}`;
}

function lopDong(entry: RunLogEntryView): string {
  if (entry.level === "error") return "dong-nhat-ky loi";
  if (entry.level === "warn") return "dong-nhat-ky canh-bao";
  return "dong-nhat-ky";
}

export default function NhatKyClient({
  runId,
  banDau,
}: {
  runId: string;
  banDau: RunLogsView | null;
}) {
  const [duLieu, setDuLieu] = useState<RunLogsView | null>(banDau);
  const [locVai, setLocVai] = useState<string>("tat-ca");
  const [locMuc, setLocMuc] = useState<string>("tat-ca");
  const [loiTai, setLoiTai] = useState<string | null>(null);
  const [daSaoChep, setDaSaoChep] = useState(false);
  const [loiSaoChep, setLoiSaoChep] = useState<string | null>(null);
  const [dangSaoChep, setDangSaoChep] = useState(false);
  const dungPoll = useRef(false);

  const taiNhatKy = useCallback(async () => {
    try {
      const res = await fetch(logsProxyUrl(runId), { cache: "no-store" });
      if (!res.ok) throw new Error("bad");
      const data = (await res.json()) as RunLogsView;
      setDuLieu(data);
      setLoiTai(null);
      // Nhan biet lan chay da ket thuc qua chi tiet lan chay (cung cach
      // XemTrucTiepClient dung) de dung poll.
      const detailRes = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      if (detailRes.ok) {
        const detail = (await detailRes.json()) as { status?: string };
        if (
          detail.status === "qua" ||
          detail.status === "hong" ||
          detail.status === "dung"
        ) {
          dungPoll.current = true;
        }
      }
    } catch {
      setLoiTai("Chưa tải được nhật ký — đang thử lại…");
    }
  }, [runId]);

  useEffect(() => {
    void taiNhatKy();
    const id = setInterval(() => {
      if (!dungPoll.current) void taiNhatKy();
    }, 3000);
    return () => clearInterval(id);
  }, [taiNhatKy]);

  const saoChepLog = useCallback(async () => {
    setDangSaoChep(true);
    setLoiSaoChep(null);
    setDaSaoChep(false);
    try {
      const res = await fetch(logsTextProxyUrl(runId), { cache: "no-store" });
      if (!res.ok) throw new Error("bad");
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setDaSaoChep(true);
    } catch {
      setLoiSaoChep("Không sao chép được — hãy dùng nút Tải log (.txt) thay thế.");
    } finally {
      setDangSaoChep(false);
    }
  }, [runId]);

  const cacVai = useMemo(() => {
    const seen: string[] = [];
    for (const entry of duLieu?.entries ?? []) {
      if (entry.roleId && !seen.includes(entry.roleId)) seen.push(entry.roleId);
    }
    return seen;
  }, [duLieu]);

  const entriesLoc = useMemo(() => {
    return (duLieu?.entries ?? []).filter((entry) => {
      if (locVai !== "tat-ca" && entry.roleId !== locVai) return false;
      if (locMuc === "loi" && entry.level !== "error") return false;
      return true;
    });
  }, [duLieu, locVai, locMuc]);

  if (!duLieu) {
    return (
      <div className="the">
        <p className="so-lieu">
          {loiTai ??
            "Đang tải nhật ký… (nếu kéo dài, kiểm tra lần chạy có tồn tại và Orchestrator đã chạy chưa)"}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="nhom-nut" style={{ marginBottom: 14 }}>
        <a className="nut-chinh" href={logsTextProxyUrl(runId)}>
          Tải log (.txt)
        </a>
        <button
          type="button"
          className="nut-phu"
          onClick={saoChepLog}
          disabled={dangSaoChep}
          style={{ minHeight: 52 }}
        >
          {dangSaoChep ? "Đang sao chép…" : "Sao chép toàn bộ log"}
        </button>
        {daSaoChep && (
          <span className="trang-thai ok" role="status" style={{ alignSelf: "center" }}>
            ✓ Đã sao chép
          </span>
        )}
      </div>
      {loiSaoChep && (
        <p className="thong-bao loi" role="alert">
          {loiSaoChep}
        </p>
      )}
      {loiTai && (
        <p className="thong-bao loi" role="alert">
          {loiTai}
        </p>
      )}
      {duLieu.truncated && (
        <p className="thong-bao loi" role="alert">
          Nhật ký quá dài nên đã bị cắt bớt — chỉ giữ 5.000 dòng đầu của lần chạy này.
        </p>
      )}

      <div className="the" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label>
          Vai&nbsp;
          <select
            value={locVai}
            onChange={(e) => setLocVai(e.target.value)}
            style={{ minHeight: 44, padding: "0 10px", borderRadius: 8 }}
          >
            <option value="tat-ca">Tất cả</option>
            {cacVai.map((roleId) => (
              <option key={roleId} value={roleId}>
                {roleLabel(roleId)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mức&nbsp;
          <select
            value={locMuc}
            onChange={(e) => setLocMuc(e.target.value)}
            style={{ minHeight: 44, padding: "0 10px", borderRadius: 8 }}
          >
            <option value="tat-ca">Tất cả</option>
            <option value="loi">Chỉ lỗi</option>
          </select>
        </label>
        <span className="so-lieu" style={{ alignSelf: "center" }}>
          {entriesLoc.length}/{duLieu.entries.length} dòng
        </span>
      </div>

      <div className="the">
        {duLieu.entries.length === 0 ? (
          <p style={{ margin: 0 }}>
            Chưa có dòng nhật ký nào cho lần chạy này — lần chạy có thể chưa bắt đầu
            thực thi.
          </p>
        ) : entriesLoc.length === 0 ? (
          <p style={{ margin: 0 }}>Không có dòng nào khớp bộ lọc hiện tại.</p>
        ) : (
          <div className="khung-nhat-ky">
            {entriesLoc.map((entry) => (
              <div key={entry.seq} className={lopDong(entry)}>
                {dongText(entry)}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
