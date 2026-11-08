/**
 * Trang ket qua lan chay (S5.1) theo EXPERIENCE ban 2:
 * - Ket luan lon dau trang: "Kich ban QUA" / "Kich ban HONG - lech N
 *   chi tieu" kem run_id + gio chay (phan biet voi cac lan chay khac).
 * - Bang doi chieu day du (du lieu S4.2), danh sach buoc, video phat
 *   lai theo tung vai (vai khong co video ghi ro ly do bang chu),
 *   tom tat du lieu dau vao da che, ket qua don du lieu, ban ghi
 *   kiem tra sandbox kenh ngoai (S5.3) neu co.
 * - Nut "Tai bao cao (.md)" va "Chay lai kich ban nay".
 */
import Link from "next/link";

import NutChayLai from "../../components/NutChayLai";
import {
  fetchRunResult,
  reportProxyUrl,
  roleLabel,
  videoProxyUrl,
  type DoiChieuDongView,
} from "../../../lib/orchestrator";

export const dynamic = "force-dynamic";

function dinhDangSo(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("vi-VN");
}

function nhanKetQuaDong(dong: DoiChieuDongView): string {
  if (dong.ketQua === "khop") return "✓ Khớp";
  if (dong.ketQua === "lech") return "✗ Lệch";
  return "— Không kiểm chứng được";
}

function lopKetQuaDong(dong: DoiChieuDongView): string {
  if (dong.ketQua === "khop") return "trang-thai ok";
  if (dong.ketQua === "lech") return "trang-thai xau";
  return "trang-thai cho";
}

const NHAN_TRANG_THAI_BUOC: Record<string, string> = {
  qua: "✓ Qua",
  hong: "✗ Hỏng",
  "bo-qua": "— Bỏ qua",
  "dang-chay": "● Đang chạy",
  cho: "● Đang chờ",
};

function lopBuoc(status: string): string {
  if (status === "qua") return "trang-thai ok";
  if (status === "hong") return "trang-thai xau";
  return "trang-thai cho";
}

export default async function TrangKetQua({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const result = await fetchRunResult(runId);

  if (!result) {
    return (
      <>
        <h1>Kết quả lần chạy {runId}</h1>
        <div className="the">
          <span className="trang-thai xau">
            ● Không tải được kết quả — lần chạy không tồn tại hoặc chưa kết nối được
            Orchestrator
          </span>
          <p style={{ marginBottom: 0 }}>
            <Link href="/lich-su" className="lien-ket-nut">
              ← Về Lịch sử chạy
            </Link>
          </p>
        </div>
      </>
    );
  }

  const ketLuan = result.ketLuan ?? result.resultLabel;
  const lopKetLuan =
    result.status === "qua"
      ? "ket-luan-lon qua"
      : result.status === "hong"
        ? "ket-luan-lon hong"
        : "ket-luan-lon cho";

  return (
    <>
      <p className="mo-ta" style={{ marginBottom: 4 }}>
        <Link href="/lich-su">← Lịch sử chạy</Link>
      </p>
      <div className={lopKetLuan} role="status">
        {ketLuan}
      </div>
      <p className="mo-ta">
        Lần chạy <strong className="so-lieu">{result.runId}</strong>
        {result.scenarioName ? (
          <>
            {" "}
            — kịch bản <strong>{result.scenarioName}</strong>
          </>
        ) : (
          <>
            {" "}
            — kịch bản <strong className="so-lieu">{result.scenarioId}</strong>
          </>
        )}{" "}
        · Chế độ: {result.modeLabel} · Bắt đầu:{" "}
        {new Date(result.startedAt).toLocaleString("vi-VN", { timeZone: "Asia/Saigon" })}
        {result.finishedAt
          ? ` · Kết thúc: ${new Date(result.finishedAt).toLocaleString("vi-VN", { timeZone: "Asia/Saigon" })}`
          : ""}
      </p>

      <div className="nhom-nut" style={{ marginBottom: 16 }}>
        <a className="nut-chinh" href={reportProxyUrl(result.runId)}>
          Tải báo cáo (.md)
        </a>
        <a
          className="nut-phu"
          href={`/lan-chay/${encodeURIComponent(result.runId)}/nhat-ky`}
          style={{
            minHeight: 52,
            display: "inline-flex",
            alignItems: "center",
            textDecoration: "none",
          }}
        >
          Xem nhật ký
        </a>
        <NutChayLai scenarioId={result.scenarioId} mode={result.mode} />
      </div>

      {result.stop && (
        <div className="the">
          <h2 style={{ marginTop: 0 }}>Dừng theo yêu cầu</h2>
          <p style={{ marginBottom: 0 }}>
            Lần chạy này đã dừng theo yêu cầu lúc{" "}
            {new Date(result.stop.requestedAt).toLocaleString("vi-VN", {
              timeZone: "Asia/Saigon",
            })}
            . {result.stop.note}
            {result.stop.forcedSessions > 0
              ? ` (${result.stop.forcedSessions} phiên bị đóng sau thời gian ân hạn)`
              : " (mọi phiên đều đóng an toàn)"}
          </p>
        </div>
      )}

      {result.sandboxCheck && (
        <div className="the">
          <h2 style={{ marginTop: 0 }}>Kiểm tra sandbox kênh ngoài</h2>
          <p style={{ marginBottom: 0 }}>
            <span className={result.sandboxCheck.allowed ? "trang-thai ok" : "trang-thai xau"}>
              {result.sandboxCheck.allowed
                ? "✓ Đã xác nhận sandbox — không gửi thật ra ngoài"
                : "✗ Không xác nhận được sandbox"}
            </span>{" "}
            Kênh: {result.sandboxCheck.channels.join(", ")} ·{" "}
            {result.sandboxCheck.reason}
          </p>
        </div>
      )}

      <div className="the">
        <h2 style={{ marginTop: 0 }}>Bảng đối chiếu kiểm đếm</h2>
        {result.kiemDem ? (
          <>
            <p className="mo-ta">
              Ngày đối chiếu: {result.kiemDem.ngay} · Khớp {result.kiemDem.soKhop} · Lệch{" "}
              {result.kiemDem.soLech} · Không kiểm chứng được{" "}
              {result.kiemDem.soKhongKiemChung}
            </p>
            <table className="bang">
              <thead>
                <tr>
                  <th>Chỉ tiêu</th>
                  <th>Kỳ vọng</th>
                  <th>Trên màn hình (UI)</th>
                  <th>Qua API</th>
                  <th>Trong CSDL (DB)</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {result.kiemDem.cacChiTieu.map((dong) => (
                  <tr key={dong.id}>
                    <td>
                      {dong.ten}
                      {dong.ghiChu.length > 0 && (
                        <div className="chu-phu">{dong.ghiChu.join(" · ")}</div>
                      )}
                    </td>
                    <td className="so-lieu">{dinhDangSo(dong.kyVong)}</td>
                    <td className="so-lieu">{dinhDangSo(dong.ui)}</td>
                    <td className="so-lieu">{dinhDangSo(dong.api)}</td>
                    <td className="so-lieu">{dinhDangSo(dong.db)}</td>
                    <td>
                      <span className={lopKetQuaDong(dong)}>{nhanKetQuaDong(dong)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p style={{ marginBottom: 0 }}>
            Lần chạy này không có bảng đối chiếu (kịch bản không khai báo chỉ tiêu kiểm
            đếm, hoặc lần chạy bị chặn trước khi kiểm đếm).
          </p>
        )}
      </div>

      <div className="the">
        <h2 style={{ marginTop: 0 }}>Video thao tác theo vai</h2>
        {result.videos.length === 0 ? (
          <p style={{ marginBottom: 0 }}>Lần chạy này không có vai nào để phát lại.</p>
        ) : (
          <div className="luoi-stream">
            {result.videos.map((video) => (
              <section key={video.roleId} className="o-stream">
                <header className="dau-o-stream">
                  <strong>{video.label}</strong>
                  <span className="trang-thai-o">
                    {video.available ? "Video xem lại" : "Không có video"}
                  </span>
                </header>
                {video.available ? (
                  <video
                    className="video-phat-lai"
                    controls
                    preload="metadata"
                    src={videoProxyUrl(result.runId, video.roleId)}
                  >
                    Trình duyệt không phát được video này.
                  </video>
                ) : (
                  <div className="khung-stream">
                    <div className="man-hinh-stream trong" />
                    <div className="lop-phu-stream">
                      <p>{video.reason ?? "Không có video của vai này"}</p>
                    </div>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="the">
        <h2 style={{ marginTop: 0 }}>Các bước đã chạy</h2>
        {result.steps.length === 0 ? (
          <p style={{ marginBottom: 0 }}>Chưa ghi nhận bước nào cho lần chạy này.</p>
        ) : (
          <table className="bang">
            <thead>
              <tr>
                <th>Bước</th>
                <th>Vai</th>
                <th>Trạng thái</th>
                <th>Lỗi (nếu có)</th>
              </tr>
            </thead>
            <tbody>
              {result.steps.map((step) => (
                <tr key={step.stepId}>
                  <td>{step.name}</td>
                  <td>{roleLabel(step.roleId)}</td>
                  <td>
                    <span className={lopBuoc(step.status)}>
                      {NHAN_TRANG_THAI_BUOC[step.status] ?? step.status}
                    </span>
                  </td>
                  <td>{step.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="the">
        <h2 style={{ marginTop: 0 }}>Dữ liệu đầu vào &amp; dọn dữ liệu</h2>
        {result.input ? (
          <p>
            Dữ liệu sinh tự động (seed <span className="so-lieu">{result.input.seed}</span>
            ): {result.input.data.thongKe.soBenhNhan} bệnh nhân,{" "}
            {result.input.data.thongKe.soDichVu} dịch vụ,{" "}
            {result.input.data.thongKe.soLichHen} lịch hẹn, tổng giá lịch hẹn{" "}
            {dinhDangSo(result.input.data.thongKe.tongGiaLichHen)} đ. Số điện thoại trong
            báo cáo đã được che; chi tiết đầy đủ nằm trong file báo cáo .md.
          </p>
        ) : (
          <p>Không có bộ dữ liệu sinh cho lần chạy này.</p>
        )}
        {result.cleanup ? (
          <p style={{ marginBottom: 0 }}>
            {result.cleanup.sach ? (
              <span className="trang-thai ok">
                ✓ Đã dọn sạch {result.cleanup.daDon} thực thể (qua {result.cleanup.duong})
              </span>
            ) : (
              <span className="trang-thai xau">
                ✗ Còn sót {result.cleanup.conSot.length} thực thể chưa dọn được — xem chi
                tiết trong báo cáo .md
              </span>
            )}
          </p>
        ) : (
          <p style={{ marginBottom: 0 }}>Chưa có báo cáo dọn dữ liệu cho lần chạy này.</p>
        )}
      </div>
    </>
  );
}
