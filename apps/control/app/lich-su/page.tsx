/**
 * Man hinh Lich su chay (S1.3 - khung): bang lan chay tu API orchestrator,
 * loc theo kich ban va ket qua. Moi dong noi sang trang ket qua cua lan
 * chay do (S5.1: ket luan, bang doi chieu, video, tai bao cao).
 */
import Link from "next/link";

export const dynamic = "force-dynamic";

interface RunView {
  runId: string;
  scenarioId: string;
  mode: string;
  modeLabel: string;
  status: string;
  resultLabel: string;
  startedAt: string;
  finishedAt: string | null;
}

async function taiDanhSach(params: {
  scenarioId?: string;
  result?: string;
}): Promise<RunView[] | null> {
  const url = process.env.ORCHESTRATOR_URL ?? "http://localhost:3101";
  const query = new URLSearchParams();
  if (params.scenarioId) query.set("scenarioId", params.scenarioId);
  if (params.result) query.set("result", params.result);
  try {
    const res = await fetch(`${url}/api/runs?${query.toString()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { runs: RunView[] };
    return data.runs;
  } catch {
    return null;
  }
}

function lopTrangThai(status: string): string {
  if (status === "qua") return "trang-thai ok";
  if (status === "hong") return "trang-thai xau";
  return "trang-thai cho";
}

export default async function LichSu({
  searchParams,
}: {
  searchParams: Promise<{ scenarioId?: string; result?: string }>;
}) {
  const params = await searchParams;
  const runs = await taiDanhSach(params);

  return (
    <>
      <h1>Lịch sử chạy</h1>
      <p className="mo-ta">
        Mỗi lần chạy có một mã run_id riêng. Bấm &quot;Xem kết quả&quot; để mở trang kết
        quả của lần chạy: kết luận, bảng đối chiếu, video từng vai và tải báo cáo.
        Bấm &quot;Xem nhật ký&quot; để xem log chi tiết của lần chạy và tải file log
        (.txt) khi cần gửi đi hỗ trợ.
      </p>

      <form className="the" method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label>
          Kịch bản&nbsp;
          <input
            name="scenarioId"
            defaultValue={params.scenarioId ?? ""}
            placeholder="Ví dụ: doanh-thu"
            style={{ minHeight: 44, padding: "0 10px", borderRadius: 8 }}
          />
        </label>
        <label>
          Kết quả&nbsp;
          <select
            name="result"
            defaultValue={params.result ?? ""}
            style={{ minHeight: 44, padding: "0 10px", borderRadius: 8 }}
          >
            <option value="">Tất cả</option>
            <option value="dang-chay">Đang chạy</option>
            <option value="qua">Qua</option>
            <option value="hong">Hỏng</option>
            <option value="dung">Đã dừng theo yêu cầu</option>
          </select>
        </label>
        <button type="submit" className="nut-phu">
          Lọc danh sách lần chạy
        </button>
      </form>

      {runs === null ? (
        <div className="the">
          <span className="trang-thai xau">● Không kết nối được Orchestrator</span>
        </div>
      ) : runs.length === 0 ? (
        <div className="the">Chưa có lần chạy nào khớp điều kiện lọc.</div>
      ) : (
        <div className="the">
          <table className="bang">
            <thead>
              <tr>
                <th>Giờ bắt đầu</th>
                <th>Run ID</th>
                <th>Kịch bản</th>
                <th>Chế độ</th>
                <th>Kết quả</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId}>
                  <td className="so-lieu">
                    {new Date(run.startedAt).toLocaleString("vi-VN", {
                      timeZone: "Asia/Saigon",
                    })}
                  </td>
                  <td className="so-lieu">{run.runId}</td>
                  <td>{run.scenarioId}</td>
                  <td>{run.modeLabel}</td>
                  <td>
                    <span className={lopTrangThai(run.status)}>{run.resultLabel}</span>
                  </td>
                  <td>
                    <Link
                      href={`/ket-qua/${encodeURIComponent(run.runId)}`}
                      className="lien-ket-nut"
                    >
                      Xem kết quả
                    </Link>
                    <br />
                    <Link
                      href={`/lan-chay/${encodeURIComponent(run.runId)}/nhat-ky`}
                      className="lien-ket-nut"
                    >
                      Xem nhật ký
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
