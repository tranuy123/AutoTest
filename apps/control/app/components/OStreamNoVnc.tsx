"use client";

/**
 * O xem stream cua mot phien (S3.2 - AD-9 noVNC).
 * Ket noi WebSocket toi Stream Gateway cua worker (duong /stream/<sessionId>)
 * va hien man hinh Chromium headed cua phien do. Chi xem (viewOnly) - nguoi
 * dung khong dieu khien phien test. Neu chua cai thu vien @novnc/novnc
 * (can pnpm install) hoac mat ket noi, o hien thong diep ro rang chu
 * khong gia vo dang phat.
 */
import { useEffect, useRef, useState } from "react";

export default function OStreamNoVnc({
  wsUrl,
  nhanVai,
  onMatTinHieu,
}: {
  wsUrl: string;
  nhanVai: string;
  onMatTinHieu?: () => void;
}) {
  const khungRef = useRef<HTMLDivElement>(null);
  const [trangThai, setTrangThai] = useState<"dang-tai" | "dang-phat" | "loi-thu-vien" | "mat-ket-noi">(
    "dang-tai",
  );

  useEffect(() => {
    let huy = false;
    let rfb: { disconnect: () => void } | null = null;
    setTrangThai("dang-tai");
    (async () => {
      let RFB: typeof import("@novnc/novnc").default;
      try {
        RFB = (await import("@novnc/novnc")).default;
      } catch {
        if (!huy) setTrangThai("loi-thu-vien");
        return;
      }
      if (huy || !khungRef.current) return;
      try {
        const instance = new RFB(khungRef.current, wsUrl, {
          wsProtocols: ["binary"],
        });
        instance.viewOnly = true;
        instance.scaleViewport = true;
        instance.addEventListener("connect", () => {
          if (!huy) setTrangThai("dang-phat");
        });
        instance.addEventListener("disconnect", () => {
          if (!huy) {
            setTrangThai("mat-ket-noi");
            onMatTinHieu?.();
          }
        });
        rfb = instance;
      } catch {
        if (!huy) {
          setTrangThai("mat-ket-noi");
          onMatTinHieu?.();
        }
      }
    })();
    return () => {
      huy = true;
      try {
        rfb?.disconnect();
      } catch {
        // Bo qua loi khi dong ket noi.
      }
    };
    // onMatTinHieu la callback on dinh tu component cha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  return (
    <div className="khung-stream">
      <div ref={khungRef} className="man-hinh-stream" aria-label={`Màn hình stream của ${nhanVai}`} />
      {trangThai !== "dang-phat" && (
        <div className="lop-phu-stream">
          {trangThai === "dang-tai" && <p>Đang kết nối stream của {nhanVai}…</p>}
          {trangThai === "loi-thu-vien" && (
            <p>
              Chưa tải được thư viện xem stream. Hãy chạy <code>pnpm install</code> trên
              máy chạy AutoTest rồi tải lại trang.
            </p>
          )}
          {trangThai === "mat-ket-noi" && (
            <p>Mất tín hiệu stream — lần chạy vẫn tiếp tục, xem kết quả ở cuối trang.</p>
          )}
        </div>
      )}
    </div>
  );
}
