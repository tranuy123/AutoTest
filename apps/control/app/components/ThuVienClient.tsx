"use client";

/**
 * Trang Thu vien kich ban (S2.2 AC-3, AC-4): tim theo ten, xem chi tiet
 * (vai, cac buoc, chi tieu kiem dem), xoa co hoi xac nhan.
 * Trang thai luon kem chu tieng Viet, khong chi mau/bieu tuong.
 */
import { useState } from "react";

import { roleLabel, type ScenarioSummaryView } from "../../lib/orchestrator";

interface ScenarioDetail extends ScenarioSummaryView {
  scenario: {
    cacVai: string[];
    cacBuoc: Array<{
      id: string;
      vai: string;
      hanhDong: string;
      choSuKien?: string;
      phatSuKien?: string;
    }>;
    kiemDem?: Array<{ id: string; ten: string; nguon: string[]; donVi?: string }>;
  };
}

export default function ThuVienClient({
  scenariosBanDau,
  orchestratorOk,
}: {
  scenariosBanDau: ScenarioSummaryView[];
  orchestratorOk: boolean;
}) {
  const [scenarios, setScenarios] = useState(scenariosBanDau);
  const [tuKhoa, setTuKhoa] = useState("");
  const [chiTiet, setChiTiet] = useState<ScenarioDetail | null>(null);
  const [dangTaiChiTiet, setDangTaiChiTiet] = useState<string | null>(null);
  const [choXacNhanXoa, setChoXacNhanXoa] = useState<string | null>(null);
  const [tinNhan, setTinNhan] = useState<string | null>(null);

  const daLoc = scenarios.filter(
    (kb) =>
      kb.name.toLowerCase().includes(tuKhoa.toLowerCase()) ||
      kb.id.toLowerCase().includes(tuKhoa.toLowerCase()),
  );

  async function xemChiTiet(id: string) {
    if (chiTiet?.id === id) {
      setChiTiet(null);
      return;
    }
    setDangTaiChiTiet(id);
    try {
      const res = await fetch(`/api/scenarios/${encodeURIComponent(id)}`);
      if (res.ok) setChiTiet((await res.json()) as ScenarioDetail);
    } finally {
      setDangTaiChiTiet(null);
    }
  }

  async function xoaKichBan(id: string, ten: string) {
    const res = await fetch(`/api/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      setScenarios((prev) => prev.filter((kb) => kb.id !== id));
      if (chiTiet?.id === id) setChiTiet(null);
      setTinNhan(`Đã xoá kịch bản '${ten}' khỏi thư viện`);
    } else {
      setTinNhan(`Xoá kịch bản '${ten}' thất bại — thử lại sau`);
    }
    setChoXacNhanXoa(null);
  }

  return (
    <>
      <h1>Thư viện kịch bản</h1>
      <p className="mo-ta">
        Kịch bản được lưu bền trong kho của AutoTest. Tìm theo tên, xem chi tiết các bước
        và chỉ tiêu kiểm đếm, hoặc xoá kịch bản không còn dùng.
      </p>

      {!orchestratorOk && (
        <div className="the">
          <span className="trang-thai xau">● Chưa kết nối được Orchestrator</span>
          <p className="so-lieu" style={{ marginBottom: 0 }}>
            Hãy chắc chắn dịch vụ Orchestrator đang chạy ở cổng 3101 rồi tải lại trang.
          </p>
        </div>
      )}

      {tinNhan && (
        <p className="thong-bao tot" role="status">
          ✓ {tinNhan}
        </p>
      )}

      <div className="the">
        <label htmlFor="o-tim" className="tieu-de-buoc" style={{ display: "block" }}>
          Tìm kịch bản theo tên
        </label>
        <input
          id="o-tim"
          className="o-nhap"
          type="text"
          placeholder="Gõ tên kịch bản…"
          value={tuKhoa}
          onChange={(e) => setTuKhoa(e.target.value)}
        />
        <p className="so-lieu" style={{ marginBottom: 0 }}>
          Tìm thấy {daLoc.length} / {scenarios.length} kịch bản
        </p>
      </div>

      {daLoc.length === 0 ? (
        <div className="the">
          <p style={{ margin: 0 }}>Không có kịch bản nào khớp với từ khóa tìm kiếm.</p>
        </div>
      ) : (
        daLoc.map((kb) => (
          <div className="the" key={kb.id}>
            <div className="dong-kich-ban">
              <div>
                <strong style={{ fontSize: 17 }}>{kb.name}</strong>
                <div className="so-lieu chu-phu">
                  Mã: {kb.id} · Vai: {kb.roles.map(roleLabel).join(", ")} · {kb.stepCount}{" "}
                  bước · {kb.metricCount} chỉ tiêu kiểm đếm · Nạp lúc{" "}
                  {new Date(kb.createdAt).toLocaleString("vi-VN")}
                </div>
              </div>
              <div className="nhom-nut">
                <button
                  type="button"
                  className="nut-phu"
                  onClick={() => void xemChiTiet(kb.id)}
                >
                  {chiTiet?.id === kb.id
                    ? "Đóng chi tiết"
                    : dangTaiChiTiet === kb.id
                      ? "Đang tải chi tiết…"
                      : "Xem chi tiết"}
                </button>
                <button
                  type="button"
                  className="nut-phu nut-nguy-hiem"
                  onClick={() => setChoXacNhanXoa(kb.id)}
                >
                  Xoá kịch bản
                </button>
              </div>
            </div>

            {choXacNhanXoa === kb.id && (
              <div className="thong-bao loi" role="alertdialog" aria-label="Xác nhận xoá kịch bản">
                <p style={{ marginTop: 0 }}>
                  Bạn có chắc muốn xoá kịch bản <strong>{kb.name}</strong> khỏi thư viện
                  không? Hành động này không hoàn tác được.
                </p>
                <button
                  type="button"
                  className="nut-phu nut-nguy-hiem"
                  onClick={() => void xoaKichBan(kb.id, kb.name)}
                >
                  Xoá hẳn kịch bản này
                </button>{" "}
                <button type="button" className="nut-phu" onClick={() => setChoXacNhanXoa(null)}>
                  Không xoá
                </button>
              </div>
            )}

            {chiTiet?.id === kb.id && (
              <div className="chi-tiet">
                <h3 className="tieu-de-buoc">Các bước ({chiTiet.scenario.cacBuoc.length})</h3>
                <table className="bang">
                  <thead>
                    <tr>
                      <th>Bước</th>
                      <th>Vai thực hiện</th>
                      <th>Hành động</th>
                      <th>Đồng bộ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chiTiet.scenario.cacBuoc.map((buoc) => (
                      <tr key={buoc.id}>
                        <td>{buoc.id}</td>
                        <td>{roleLabel(buoc.vai)}</td>
                        <td>{buoc.hanhDong}</td>
                        <td>
                          {buoc.choSuKien ? `Chờ: ${buoc.choSuKien}` : ""}
                          {buoc.choSuKien && buoc.phatSuKien ? " · " : ""}
                          {buoc.phatSuKien ? `Phát: ${buoc.phatSuKien}` : ""}
                          {!buoc.choSuKien && !buoc.phatSuKien ? "—" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3 className="tieu-de-buoc">
                  Chỉ tiêu kiểm đếm ({chiTiet.scenario.kiemDem?.length ?? 0})
                </h3>
                {(chiTiet.scenario.kiemDem ?? []).length === 0 ? (
                  <p className="so-lieu">Kịch bản không khai báo chỉ tiêu kiểm đếm.</p>
                ) : (
                  <ul>
                    {(chiTiet.scenario.kiemDem ?? []).map((ct) => (
                      <li key={ct.id}>
                        <strong>{ct.ten}</strong> — đối chiếu từ: {ct.nguon.join(", ")}
                        {ct.donVi ? ` · đơn vị: ${ct.donVi}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}
