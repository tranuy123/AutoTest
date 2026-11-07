/**
 * Man hinh Cau hinh moi truong (S1.2, theo EXPERIENCE ban 2):
 * hien URL dang noi, trang thai duoc phep/bi chan kem chu, tung vai
 * "da cau hinh / chua cau hinh" - khong bao gio hien mat khau.
 */
export const dynamic = "force-dynamic";

interface RoleTrangThai {
  id: string;
  label: string;
  username: string | null;
  configured: boolean;
}

interface EnvironmentTrangThai {
  targetBaseUrl: string;
  allowlist: string[];
  testTenant: string;
  channelsSandbox: boolean | null;
  roles: RoleTrangThai[];
  targetEvaluation: { allowed: boolean; reason: string };
}

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

  const duocPhep = trangThai.targetEvaluation.allowed;

  return (
    <>
      <h1>Cấu hình môi trường</h1>
      <p className="mo-ta">
        AutoTest chỉ được phép chạy vào môi trường UAT nằm trong allowlist. Kiểm tra này
        thực hiện ở Orchestrator (AD-6) — giao diện không có cách nào bỏ qua.
      </p>

      <div className="the">
        <p style={{ marginTop: 0 }}>
          {duocPhep ? (
            <span className="trang-thai ok">● Đúng UAT — được phép chạy</span>
          ) : (
            <span className="trang-thai xau">● Không phải UAT — đã chặn</span>
          )}
        </p>
        <table className="bang">
          <tbody>
            <tr>
              <th>URL đang nối</th>
              <td className="so-lieu">{trangThai.targetBaseUrl}</td>
            </tr>
            <tr>
              <th>Lý do</th>
              <td>{trangThai.targetEvaluation.reason}</td>
            </tr>
            <tr>
              <th>Allowlist UAT</th>
              <td className="so-lieu">{trangThai.allowlist.join(", ")}</td>
            </tr>
            <tr>
              <th>Tenant / chi nhánh test</th>
              <td>{trangThai.testTenant}</td>
            </tr>
            <tr>
              <th>Kênh Zalo/Facebook/SMS</th>
              <td>
                {trangThai.channelsSandbox === true
                  ? "Đang ở chế độ sandbox — an toàn"
                  : trangThai.channelsSandbox === false
                    ? "KHÔNG ở sandbox — nguy hiểm, không được chạy kịch bản có nhắc hẹn"
                    : "Chưa khai báo — coi như chưa an toàn"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Tài khoản theo vai trên UAT</h2>
      <div className="the">
        <table className="bang">
          <thead>
            <tr>
              <th>Vai</th>
              <th>Tên đăng nhập</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {trangThai.roles.map((role) => (
              <tr key={role.id}>
                <td>{role.label}</td>
                <td className="so-lieu">{role.username ?? "—"}</td>
                <td>
                  {role.configured ? (
                    <span className="trang-thai ok">Đã cấu hình</span>
                  ) : (
                    <span className="trang-thai cho">Chưa cấu hình</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mo-ta" style={{ marginBottom: 0 }}>
          Mật khẩu chỉ nằm trong file .env trên máy chạy, không hiển thị ở đây và không
          được Orchestrator trả ra API.
        </p>
      </div>
    </>
  );
}
