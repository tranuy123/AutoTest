/**
 * Man hinh Cau hinh moi truong (S1.2 + S5.5): phia server doc trang thai
 * moi truong + cau hinh khai bao hieu luc tu Orchestrator, phan hien thi
 * va form khai bao nam o CauHinhClient. Mat khau khong bao gio duoc tra
 * ve day - chi co trang thai "da co mat khau hay chua".
 */
import CauHinhClient, {
  type EnvironmentTrangThai,
} from "../components/CauHinhClient";
import { fetchSettings } from "../../lib/orchestrator";

export const dynamic = "force-dynamic";

async function taiTrangThai(): Promise<EnvironmentTrangThai | null> {
  const url = process.env.ORCHESTRATOR_URL ?? "http://localhost:3101";
  try {
    const res = await fetch(`${url}/api/environment`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as EnvironmentTrangThai;
  } catch {
    return null;
  }
}

export default async function CauHinh() {
  const trangThai = await taiTrangThai();

  if (!trangThai) {
    return (
      <>
        <h1>Cấu hình môi trường</h1>
        <div className="the">
          <span className="trang-thai xau">● Không kết nối được Orchestrator</span>
          <p className="mo-ta" style={{ marginTop: 12, marginBottom: 0 }}>
            Chưa đọc được trạng thái môi trường. Vì nguyên tắc chặn cứng (fail-closed), nút
            Bắt đầu chạy không khả dụng cho đến khi Orchestrator hoạt động trở lại.
          </p>
        </div>
      </>
    );
  }

  const caiDat = await fetchSettings();

  return <CauHinhClient trangThai={trangThai} caiDatBanDau={caiDat} />;
}
