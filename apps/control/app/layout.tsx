import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "AutoTest — Kiểm thử tự động trên UAT",
  description:
    "Hệ thống tự động kiểm thử trên môi trường UAT cho CRM_Loyalty: nạp kịch bản, stream thao tác nhiều vai trò, đối chiếu số liệu báo cáo.",
};

const MUC_DIEU_HUONG = [
  { href: "/", nhan: "Trang chính" },
  { href: "/thu-vien", nhan: "Thư viện kịch bản" },
  { href: "/lich-su", nhan: "Lịch sử chạy" },
  { href: "/cau-hinh", nhan: "Cấu hình môi trường" },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <div className="khung">
          <nav className="thanh-trai" aria-label="Điều hướng chính">
            <div className="logo">AutoTest</div>
            {MUC_DIEU_HUONG.map((muc) => (
              <Link key={muc.href} href={muc.href}>
                {muc.nhan}
              </Link>
            ))}
          </nav>
          <main className="vung-chinh">{children}</main>
        </div>
      </body>
    </html>
  );
}
