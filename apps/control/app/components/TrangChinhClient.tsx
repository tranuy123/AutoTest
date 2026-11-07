"use client";

/**
 * Trang chinh - khu "Bat dau o day - 3 buoc" (S2.2 AC-1, AC-2, AC-4).
 * Cau chu va cau truc bam ban mau autotest-ban-mau-giao-dien da duyet +
 * EXPERIENCE ban 2. Moi trang thai deu kem chu tieng Viet.
 */
import { useRef, useState } from "react";

import { roleLabel, type ScenarioSummaryView } from "../../lib/orchestrator";

interface ValidationIssueView {
  file: string;
  line: number | null;
  field: string;
  message: string;
  cell?: string;
}

interface CreatedRunView {
  runId: string;
  resultLabel: string;
  input?: { thongKe: { soBenhNhan: number; soLichHen: number; tongGiaLichHen: number } };
  dataError?: string;
}

const CHE_DO = [
  { id: "xem-truc-tiep", nhan: "Xem trực tiếp (chậm, có stream)", moTa: "Mở trình duyệt thật và stream từng thao tác về lưới xem" },
  { id: "chay-nhanh", nhan: "Chạy nhanh (không xem, chạy song song)", moTa: "Chạy headless, chỉ xem kết quả và video sau khi xong" },
] as const;

export default function TrangChinhClient({
  scenariosBanDau,
  orchestratorOk,
  envAllowed,
  envReason,
  targetBaseUrl,
}: {
  scenariosBanDau: ScenarioSummaryView[];
  orchestratorOk: boolean;
  envAllowed: boolean;
  envReason: string;
  targetBaseUrl: string;
}) {
  const [scenarios, setScenarios] = useState(scenariosBanDau);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<string>("xem-truc-tiep");
  const [dangNap, setDangNap] = useState(false);
  const [loiNap, setLoiNap] = useState<ValidationIssueView[]>([]);
  const [tinNhan, setTinNhan] = useState<string | null>(null);
  const [dangChay, setDangChay] = useState(false);
  const [lanChayMoi, setLanChayMoi] = useState<CreatedRunView | null>(null);
  const [loiChay, setLoiChay] = useState<string | null>(null);
  const [dangThucThi, setDangThucThi] = useState(false);
  const [loiThucThi, setLoiThucThi] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const kichBanDaChon = scenarios.find((s) => s.id === selectedId) ?? null;

  async function taiLaiDanhSach() {
    const res = await fetch("/api/scenarios");
    if (res.ok) {
      const data = (await res.json()) as { scenarios: ScenarioSummaryView[] };
      setScenarios(data.scenarios ?? []);
    }
  }

  async function napFile(file: File) {
    setDangNap(true);
    setLoiNap([]);
    setTinNhan(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/scenarios", { method: "POST", body: form });
      const data = (await res.json()) as {
        message?: string;
        errors?: ValidationIssueView[];
        error?: string;
      };
      if (res.status === 201) {
        setTinNhan(data.message ?? "Đã nạp kịch bản vào thư viện");
        await taiLaiDanhSach();
      } else if (res.status === 422 && data.errors) {
        setLoiNap(data.errors);
      } else if (res.status === 409) {
        setLoiNap([
          { file: file.name, line: null, field: "id", message: data.message ?? "Kịch bản đã có trong thư viện" },
        ]);
      } else {
        setLoiNap([
          { file: file.name, line: null, field: "(file)", message: data.message ?? "Nạp kịch bản thất bại" },
        ]);
      }
    } catch {
      setLoiNap([
        { file: file.name, line: null, field: "(file)", message: "Không gọi được máy chủ — kiểm tra Orchestrator đã chạy chưa" },
      ]);
    } finally {
      setDangNap(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function batDauChay() {
    if (!kichBanDaChon) return;
    setDangChay(true);
    setLoiChay(null);
    setLanChayMoi(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: kichBanDaChon.id, mode }),
      });
      const data = (await res.json()) as CreatedRunView & { message?: string };
      if (res.status === 201) {
        setLanChayMoi(data);
      } else if (res.status === 403) {
        setLoiChay(data.message ?? "Không phải UAT — đã chặn");
      } else {
        setLoiChay(data.message ?? "Tạo lần chạy thất bại");
      }
    } catch {
      setLoiChay("Không gọi được máy chủ — kiểm tra Orchestrator đã chạy chưa");
    } finally {
      setDangChay(false);
    }
  }

  async function thucThiVaXem(runId: string) {
    setDangThucThi(true);
    setLoiThucThi(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.status === 202) {
        window.location.href = `/lan-chay/${encodeURIComponent(runId)}`;
        return;
      }
      setLoiThucThi(
        res.status === 403
          ? (data.message ?? "Không phải UAT — đã chặn")
          : "Chưa bắt đầu thực thi được — thử lại hoặc xem ở mục Lịch sử chạy.",
      );
    } catch {
      setLoiThucThi("Không gọi được máy chủ — kiểm tra Orchestrator đã chạy chưa");
    } finally {
      setDangThucThi(false);
    }
  }

  return (
    <>
      <h1>AutoTest</h1>
      <p className="mo-ta">
        Hệ thống tự động kiểm thử trên môi trường UAT cho CRM_Loyalty: nạp kịch bản, chạy
        nhiều vai cùng lúc có stream trực tiếp, đối chiếu số liệu báo cáo.
      </p>

      {!orchestratorOk ? (
        <div className="the">
          <span className="trang-thai xau">● Chưa kết nối được Orchestrator</span>
          <p className="so-lieu" style={{ marginBottom: 0 }}>
            Hãy chắc chắn dịch vụ Orchestrator đang chạy ở cổng 3101 rồi tải lại trang.
          </p>
        </div>
      ) : envAllowed ? (
        <div className="the">
          <span className="trang-thai ok">● Đúng UAT — được phép chạy</span>{" "}
          <span className="so-lieu">Đích: {targetBaseUrl}</span>
        </div>
      ) : (
        <div className="the">
          <span className="trang-thai xau">● Không phải UAT — đã chặn</span>{" "}
          <span className="so-lieu">
            Đích: {targetBaseUrl}
            {envReason ? ` — ${envReason}` : ""}
          </span>
        </div>
      )}

      <h2>Bắt đầu ở đây — 3 bước</h2>

      <div className="the">
        <h3 className="tieu-de-buoc">Bước 1 — Chọn hoặc nạp kịch bản</h3>
        <input
          ref={fileRef}
          type="file"
          accept=".yaml,.yml,.xlsx"
          style={{ display: "none" }}
          aria-label="Chọn file kịch bản để nạp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void napFile(f);
          }}
        />
        <button
          type="button"
          className="nut-phu"
          disabled={dangNap}
          onClick={() => fileRef.current?.click()}
        >
          {dangNap ? "Đang nạp kịch bản…" : "Nạp kịch bản mới (.yaml, .xlsx)"}
        </button>{" "}
        <a className="nut-phu lien-ket-nut" href="/api/excel-template">
          Tải file Excel mẫu (.xlsx)
        </a>

        {tinNhan && (
          <p className="thong-bao tot" role="status">
            ✓ {tinNhan}
          </p>
        )}
        {loiNap.length > 0 && (
          <div className="thong-bao loi" role="alert">
            <p style={{ marginTop: 0 }}>
              <strong>Kịch bản chưa hợp lệ — chưa nạp vào thư viện.</strong> Sửa các lỗi
              sau rồi nạp lại:
            </p>
            <ul className="danh-sach-loi">
              {loiNap.map((loi, i) => (
                <li key={i}>
                  {loi.cell
                    ? `Ô ${loi.cell}`
                    : loi.line
                      ? `Dòng ${loi.line}`
                      : "Trường"}{" "}
                  <strong>{loi.field}</strong>: {loi.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {scenarios.length === 0 ? (
          <p className="so-lieu">Thư viện chưa có kịch bản nào — hãy nạp file đầu tiên.</p>
        ) : (
          <ul className="danh-sach-kich-ban">
            {scenarios.map((kb) => (
              <li key={kb.id} className={kb.id === selectedId ? "dong-kich-ban da-chon" : "dong-kich-ban"}>
                <div>
                  <strong>{kb.name}</strong>
                  <div className="so-lieu chu-phu">
                    {kb.roles.map(roleLabel).join(", ")} · {kb.stepCount} bước ·{" "}
                    {kb.metricCount} chỉ tiêu kiểm đếm
                  </div>
                </div>
                <button
                  type="button"
                  className="nut-phu"
                  aria-pressed={kb.id === selectedId}
                  onClick={() => setSelectedId(kb.id)}
                >
                  {kb.id === selectedId ? "Đã chọn kịch bản này ✓" : "Chạy kịch bản này"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="the">
        <h3 className="tieu-de-buoc">Bước 2 — Chọn chế độ chạy</h3>
        <div className="nhom-che-do" role="radiogroup" aria-label="Chế độ chạy">
          {CHE_DO.map((cd) => (
            <label key={cd.id} className={mode === cd.id ? "o-che-do da-chon" : "o-che-do"}>
              <input
                type="radio"
                name="che-do"
                value={cd.id}
                checked={mode === cd.id}
                onChange={() => setMode(cd.id)}
              />{" "}
              <span>
                <strong>{cd.nhan}</strong>
                <span className="chu-phu mo-ta-nho">{cd.moTa}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="the">
        <h3 className="tieu-de-buoc">Bước 3 — Bắt đầu</h3>
        <button
          type="button"
          className="nut-chinh"
          disabled={!kichBanDaChon || dangChay || !envAllowed || !orchestratorOk}
          onClick={() => void batDauChay()}
        >
          {dangChay ? "Đang tạo lần chạy…" : "Bắt đầu chạy"}
        </button>{" "}
        {!kichBanDaChon && <span className="chu-phu">Hãy chọn một kịch bản ở Bước 1 trước.</span>}
        {kichBanDaChon && !envAllowed && (
          <span className="chu-phu">Đích không phải UAT nên nút chạy đang bị khóa.</span>
        )}
        {loiChay && (
          <p className="thong-bao loi" role="alert">
            ✗ {loiChay}
          </p>
        )}
        {lanChayMoi && (
          <div className="thong-bao tot" role="status">
            <p style={{ marginTop: 0 }}>
              ✓ Đã tạo lần chạy <strong>{lanChayMoi.runId}</strong> — trạng thái:{" "}
              <strong>{lanChayMoi.resultLabel}</strong>.
            </p>
            {lanChayMoi.input && (
              <p>
                Đã sinh dữ liệu cho lần chạy: {lanChayMoi.input.thongKe.soBenhNhan} bệnh
                nhân giả, {lanChayMoi.input.thongKe.soLichHen} lịch hẹn (tổng giá trị{" "}
                {lanChayMoi.input.thongKe.tongGiaLichHen.toLocaleString("vi-VN")} đ).
              </p>
            )}
            {lanChayMoi.dataError && <p>Chưa sinh được dữ liệu: {lanChayMoi.dataError}</p>}
            <p>
              <button
                type="button"
                className="nut-chinh"
                disabled={dangThucThi}
                onClick={() => void thucThiVaXem(lanChayMoi.runId)}
              >
                {dangThucThi
                  ? "Đang bắt đầu thực thi…"
                  : mode === "chay-nhanh"
                    ? "Bắt đầu thực thi (chạy nhanh)"
                    : "Bắt đầu thực thi và xem trực tiếp"}
              </button>
            </p>
            {loiThucThi && (
              <p className="thong-bao loi" role="alert" style={{ marginBottom: 0 }}>
                ✗ {loiThucThi}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
