"use client";

/**
 * Trang Cau hinh moi truong (S1.2 + S5.5): khoi trang thai doc tu
 * Orchestrator o tren (dich dang noi, duoc phep/bi chan, kenh sandbox),
 * ben duoi la FORM KHAI BAO: URL dich UAT, allowlist, tenant va tai
 * khoan tung vai. Luu xong ap dung ngay cho cac lan chay sau - khong
 * can sua .env, khong can khoi dong lai. Mat khau khong bao gio hien
 * lai: o mat khau de trong = giu nguyen mat khau hien tai.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { roleLabel, type SettingsView } from "../../lib/orchestrator";

export interface EnvironmentTrangThai {
  targetBaseUrl: string;
  allowlist: string[];
  testTenant: string;
  channelsSandbox: boolean | null;
  roles: Array<{
    id: string;
    label: string;
    username: string | null;
    configured: boolean;
  }>;
  targetEvaluation: { allowed: boolean; reason: string };
}

export default function CauHinhClient({
  trangThai,
  caiDatBanDau,
}: {
  trangThai: EnvironmentTrangThai;
  caiDatBanDau: SettingsView | null;
}) {
  const router = useRouter();
  const [caiDat, setCaiDat] = useState<SettingsView | null>(caiDatBanDau);
  const [dich, setDich] = useState(
    caiDatBanDau?.targetBaseUrl ?? trangThai.targetBaseUrl,
  );
  const [allowlist, setAllowlist] = useState(
    caiDatBanDau?.targetAllowlist ?? trangThai.allowlist.join(", "),
  );
  const [tenant, setTenant] = useState(caiDatBanDau?.testTenant ?? trangThai.testTenant);
  const [tenDangNhap, setTenDangNhap] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (caiDatBanDau?.roles ?? []).map((r) => [r.roleId, r.username ?? ""]),
    ),
  );
  const [matKhau, setMatKhau] = useState<Record<string, string>>({});
  const [dangLuu, setDangLuu] = useState(false);
  const [thongBao, setThongBao] = useState<{
    loai: "tot" | "loi";
    text: string;
  } | null>(null);

  const duocPhep = trangThai.targetEvaluation.allowed;

  async function luuCauHinh() {
    if (!caiDat) return;
    setDangLuu(true);
    setThongBao(null);
    const roles: Record<string, { username: string; password?: string }> = {};
    for (const role of caiDat.roles) {
      roles[role.roleId] = {
        username: (tenDangNhap[role.roleId] ?? "").trim(),
        // Chi gui mat khau khi nguoi dung thuc su nhap - de trong la giu nguyen.
        ...(matKhau[role.roleId] ? { password: matKhau[role.roleId] } : {}),
      };
    }
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetBaseUrl: dich.trim(),
          targetAllowlist: allowlist,
          testTenant: tenant.trim(),
          roles,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as SettingsView & {
        message?: string;
      };
      if (!res.ok) {
        setThongBao({
          loai: "loi",
          text: data.message ?? "Lưu cấu hình thất bại — thử lại sau",
        });
        return;
      }
      setCaiDat(data);
      setDich(data.targetBaseUrl);
      setAllowlist(data.targetAllowlist);
      setTenant(data.testTenant);
      setTenDangNhap(
        Object.fromEntries(data.roles.map((r) => [r.roleId, r.username ?? ""])),
      );
      setMatKhau({});
      setThongBao({
        loai: "tot",
        text: "Đã lưu cấu hình — áp dụng ngay cho các lần chạy sau, không cần khởi động lại",
      });
      // Nap lai khoi trang thai phia server (URL dang noi, duoc phep/bi chan).
      router.refresh();
    } catch {
      setThongBao({
        loai: "loi",
        text: "Chưa kết nối được Orchestrator — cấu hình chưa được lưu, thử lại sau",
      });
    } finally {
      setDangLuu(false);
    }
  }

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
        <p className="mo-ta" style={{ marginBottom: 0 }}>
          Cờ sandbox kênh ngoài chỉ đổi được trong file .env trên máy chạy — không sửa
          qua giao diện, để tránh vô tình bật gửi thật tới khách hàng.
        </p>
      </div>

      <h2>Khai báo đích UAT và tài khoản theo vai</h2>
      {!caiDat ? (
        <div className="the">
          <span className="trang-thai xau">● Chưa đọc được cấu hình khai báo</span>
          <p className="mo-ta" style={{ marginTop: 12, marginBottom: 0 }}>
            Orchestrator chưa trả được phần cấu hình khai báo nên form tạm khoá. Các lần
            chạy vẫn dùng giá trị trong file .env như trước.
          </p>
        </div>
      ) : (
        <div className="the">
          <label className="nhan-truong" htmlFor="o-dich">
            URL đích UAT
          </label>
          <input
            id="o-dich"
            className="o-nhap"
            type="url"
            value={dich}
            onChange={(e) => setDich(e.target.value)}
            placeholder="Ví dụ: https://uat.phongkham.vn"
          />
          <label className="nhan-truong" htmlFor="o-allowlist">
            Allowlist UAT (các địa chỉ cách nhau bằng dấu phẩy)
          </label>
          <input
            id="o-allowlist"
            className="o-nhap"
            type="text"
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            placeholder="Ví dụ: https://uat.phongkham.vn"
          />
          <label className="nhan-truong" htmlFor="o-tenant">
            Tenant / chi nhánh test
          </label>
          <input
            id="o-tenant"
            className="o-nhap"
            type="text"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="Ví dụ: chi-nhanh-test"
          />

          <table className="bang" style={{ marginTop: 18 }}>
            <thead>
              <tr>
                <th>Vai</th>
                <th>Tên đăng nhập</th>
                <th>Mật khẩu</th>
              </tr>
            </thead>
            <tbody>
              {caiDat.roles.map((role) => (
                <tr key={role.roleId}>
                  <td>{roleLabel(role.roleId)}</td>
                  <td>
                    <input
                      className="o-nhap o-nhap-bang"
                      type="text"
                      aria-label={`Tên đăng nhập của vai ${roleLabel(role.roleId)}`}
                      value={tenDangNhap[role.roleId] ?? ""}
                      onChange={(e) =>
                        setTenDangNhap((prev) => ({
                          ...prev,
                          [role.roleId]: e.target.value,
                        }))
                      }
                      placeholder="Chưa khai báo tên đăng nhập"
                    />
                  </td>
                  <td>
                    <input
                      className="o-nhap o-nhap-bang"
                      type="password"
                      aria-label={`Mật khẩu của vai ${roleLabel(role.roleId)}`}
                      value={matKhau[role.roleId] ?? ""}
                      onChange={(e) =>
                        setMatKhau((prev) => ({ ...prev, [role.roleId]: e.target.value }))
                      }
                      placeholder={
                        role.hasPassword
                          ? "Để trống = giữ mật khẩu hiện tại"
                          : "Chưa có mật khẩu"
                      }
                      autoComplete="new-password"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mo-ta">
            Mật khẩu được lưu trong cơ sở dữ liệu nội bộ của AutoTest trên chính máy
            này và không bao giờ hiển thị lại. File .env chỉ còn là giá trị mặc định
            ban đầu — giá trị khai báo ở đây được ưu tiên hơn và áp dụng ngay.
          </p>

          {thongBao && (
            <div className={`thong-bao ${thongBao.loai === "tot" ? "tot" : "loi"}`}>
              {thongBao.loai === "tot" ? "✓ " : "✕ "}
              {thongBao.text}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="nut-chinh" onClick={luuCauHinh} disabled={dangLuu}>
              {dangLuu ? "Đang lưu cấu hình…" : "Lưu cấu hình"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
