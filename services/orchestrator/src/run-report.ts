/**
 * Bao cao ket qua lan chay (S5.1, FR-8).
 *
 * Module nay lap rap "chi tiet ket qua" cua mot lan chay tu cac nguon
 * da co: ho so lan chay + buoc (S1.3), ban tong hop ket-qua.json cua
 * executor (bang kiem dem S4.2 + ket qua theo vai), du lieu dau vao da
 * sinh (S2.3 - che so dien thoai khi dua ra ngoai), bao cao don (S2.4),
 * ban ghi kiem tra sandbox (S5.3). Cung mot DTO dung cho:
 * - API GET /api/runs/:id (trang ket qua tren Control App).
 * - GET /api/runs/:id/report.md (file bao cao tai xuong - AC-3).
 * - GET /api/runs/:id/videos/:roleId (phat lai video theo vai - AC-2).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { ROLE_DEFINITIONS } from "./config.js";
import type { CleanupReport } from "./cleanup.js";
import type { GeneratedRunData } from "./data-generator.js";
import type { BangDoiChieu } from "./reconciler.js";
import type { RunInputRecord } from "./run-data-store.js";
import {
  RUN_MODE_LABELS,
  type RunRecord,
  type RunStepRecord,
} from "./run-store.js";
import type { SandboxCheckRecord } from "./sandbox-gate.js";
import type { WorkerSessionResult } from "./worker-client.js";

/** Noi dung ban tong hop ket-qua.json do RunExecutor ghi. */
export interface RunReportFile {
  kiemDem: BangDoiChieu | null;
  roles: WorkerSessionResult[];
  sandboxCheck?: SandboxCheckRecord | null;
}

export async function docBaoCaoLanChay(run: RunRecord): Promise<RunReportFile | null> {
  // Uu tien ban luu trong kho lan chay (S5.1, migration 006) - nguon
  // chinh thuc; file ket-qua.json chi la du phong cho ho so cu.
  if (run.resultDetail) {
    return {
      kiemDem: (run.resultDetail.kiemDem as BangDoiChieu | null) ?? null,
      roles: (run.resultDetail.roles ?? []) as WorkerSessionResult[],
      sandboxCheck: (run.resultDetail.sandboxCheck as SandboxCheckRecord | null) ?? null,
    };
  }
  if (!run.reportPath) return null;
  try {
    const parsed = JSON.parse(await readFile(run.reportPath, "utf8")) as Partial<RunReportFile>;
    return {
      kiemDem: parsed.kiemDem ?? null,
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
      sandboxCheck: parsed.sandboxCheck ?? null,
    };
  } catch {
    return null;
  }
}

/** Che so dien thoai khi dua vao bao cao/trang ket qua: giu 3 so dau + 2 so cuoi. */
export function maskPhone(soDienThoai: string): string {
  const digits = soDienThoai.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

/** Ban sao du lieu sinh da che du lieu nhay cam (AC-3). */
export function redactGeneratedData(data: GeneratedRunData): GeneratedRunData {
  return {
    ...data,
    benhNhan: data.benhNhan.map((p) => ({ ...p, soDienThoai: maskPhone(p.soDienThoai) })),
  };
}

/** Dong ket luan lon cua trang ket qua (EXPERIENCE ban 2, man hinh ket qua). */
export function ketLuanLanChay(run: RunRecord, kiemDem: BangDoiChieu | null): string {
  switch (run.status) {
    case "qua":
      return "Kịch bản QUA";
    case "hong":
      if (kiemDem && kiemDem.soLech > 0) return `Kịch bản HỎNG — lệch ${kiemDem.soLech} chỉ tiêu`;
      if (kiemDem && kiemDem.soKhongKiemChung > 0)
        return `Kịch bản HỎNG — ${kiemDem.soKhongKiemChung} chỉ tiêu không kiểm chứng được`;
      return "Kịch bản HỎNG";
    case "dung":
      return "Đã dừng theo yêu cầu";
    case "dang-chay":
      return "Lần chạy đang chạy";
    default:
      return "Lần chạy đang chờ";
  }
}

export interface RoleVideoInfo {
  roleId: string;
  label: string;
  available: boolean;
  /** URL phat lai qua API (chi co khi available). */
  url: string | null;
  /** Ly do bang chu khi khong co video (AC-2). */
  reason: string | null;
}

function nhanVai(roleId: string): string {
  return ROLE_DEFINITIONS.find((r) => r.id === roleId)?.label ?? roleId;
}

function duongDanVideoUngVien(
  run: RunRecord,
  roleId: string,
  reportRoles: WorkerSessionResult[],
  artifactsRoot: string,
): string | null {
  const fromReport = reportRoles.find((r) => r.roleId === roleId)?.videoPath ?? null;
  const candidates = [
    fromReport,
    join(artifactsRoot, run.runId, "video", roleId, "video.webm"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Tim file video that cua mot vai trong lan chay - chi chap nhan duong
 * dan nam trong thu muc artifact cua dung lan chay do (chong doc file
 * ngoai pham vi).
 */
export function timFileVideo(input: {
  run: RunRecord;
  roleId: string;
  reportRoles: WorkerSessionResult[];
  artifactsRoot: string;
}): string | null {
  const found = duongDanVideoUngVien(
    input.run,
    input.roleId,
    input.reportRoles,
    input.artifactsRoot,
  );
  if (!found) return null;
  const goc = resolve(input.artifactsRoot, input.run.runId);
  const tuyetDoi = resolve(found);
  return tuyetDoi === goc || tuyetDoi.startsWith(goc + sep) ? tuyetDoi : null;
}

function lyDoKhongCoVideo(input: {
  run: RunRecord;
  reportRole: WorkerSessionResult | undefined;
}): string {
  const { run, reportRole } = input;
  if (!run.finishedAt) return "Lần chạy chưa kết thúc — chưa có video";
  if (!reportRole) return "Vai này không có phiên chạy trong lần chạy này";
  if (!reportRole.videoPath) return "Phiên của vai này không ghi được video";
  if (run.status === "qua") {
    return run.mode === "chay-nhanh"
      ? "Chế độ chạy nhanh: lần chạy qua nên không lưu video"
      : "Lần chạy qua: video đã xoá theo chính sách (chỉ giữ video khi lần chạy hỏng hoặc bị dừng)";
  }
  return "Không tìm thấy file video của vai này trên đĩa";
}

export function buildRoleVideos(input: {
  run: RunRecord;
  roleIds: readonly string[];
  reportRoles: WorkerSessionResult[];
  artifactsRoot: string;
}): RoleVideoInfo[] {
  return input.roleIds.map((roleId) => {
    const path = timFileVideo({
      run: input.run,
      roleId,
      reportRoles: input.reportRoles,
      artifactsRoot: input.artifactsRoot,
    });
    const reportRole = input.reportRoles.find((r) => r.roleId === roleId);
    return {
      roleId,
      label: nhanVai(roleId),
      available: path !== null,
      url: path
        ? `/api/runs/${encodeURIComponent(input.run.runId)}/videos/${encodeURIComponent(roleId)}`
        : null,
      reason: path ? null : lyDoKhongCoVideo({ run: input.run, reportRole }),
    };
  });
}

/* ------------------------- DTO chi tiet ket qua ------------------------- */

export interface RunResultDetail {
  run: RunRecord;
  ketLuan: string;
  scenarioName: string | null;
  steps: RunStepRecord[];
  kiemDem: BangDoiChieu | null;
  videos: RoleVideoInfo[];
  /** Du lieu dau vao da che so dien thoai; null = lan chay chua sinh du lieu. */
  input: RunInputRecord | null;
  cleanup: CleanupReport | null;
  sandboxCheck: SandboxCheckRecord | null;
  /** S5.2: thong tin dung theo yeu cau neu lan chay bi dung giua chung. */
  stop: { requestedAt: string; forcedSessions: number; note: string } | null;
}

export interface RunResultDeps {
  getRunWithSteps: (
    runId: string,
  ) => Promise<{ run: RunRecord; steps: RunStepRecord[] } | null>;
  getScenario: (
    scenarioId: string,
  ) => Promise<{ name: string; scenario: { cacVai: readonly string[] } } | null>;
  getRunInput: (runId: string) => Promise<RunInputRecord | null>;
  getCleanupReport: (runId: string) => CleanupReport | null;
  getSandboxRecord: (runId: string) => SandboxCheckRecord | null;
  artifactsRoot: string;
}

export async function assembleRunResultDetail(
  deps: RunResultDeps,
  runId: string,
): Promise<RunResultDetail | null> {
  const detail = await deps.getRunWithSteps(runId);
  if (!detail) return null;
  const { run, steps } = detail;
  const scenario = await deps.getScenario(run.scenarioId).catch(() => null);
  const reportFile = await docBaoCaoLanChay(run);
  const kiemDem = reportFile?.kiemDem ?? null;
  const roleIds = scenario?.scenario.cacVai ?? reportFile?.roles.map((r) => r.roleId) ?? [];
  const rawInput = await deps.getRunInput(runId).catch(() => null);
  return {
    run,
    ketLuan: ketLuanLanChay(run, kiemDem),
    scenarioName: scenario?.name ?? null,
    steps,
    kiemDem,
    videos: buildRoleVideos({
      run,
      roleIds,
      reportRoles: reportFile?.roles ?? [],
      artifactsRoot: deps.artifactsRoot,
    }),
    input: rawInput ? { ...rawInput, data: redactGeneratedData(rawInput.data) } : null,
    cleanup: deps.getCleanupReport(runId),
    // Ban ghi sandbox: uu tien ban song cua cong (chinh xac nhat), roi
    // moi den ban trong ket-qua.json.
    sandboxCheck: deps.getSandboxRecord(runId) ?? reportFile?.sandboxCheck ?? null,
    stop: run.resultDetail?.stop ?? null,
  };
}

/* ------------------------- Bao cao Markdown (AC-3) ------------------------- */

function fmtSo(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("vi-VN");
}

function fmtThoiGian(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Saigon" });
}

const NHAN_TRANG_THAI_BUOC: Record<string, string> = {
  qua: "Qua",
  hong: "Hỏng",
  dung: "Đã dừng theo yêu cầu",
  "bo-qua": "Bỏ qua",
};

export function buildMarkdownReport(detail: RunResultDetail): string {
  const { run } = detail;
  const lines: string[] = [];
  lines.push(`# Báo cáo lần chạy ${run.runId}`);
  lines.push("");
  lines.push(`- Kết luận: **${detail.ketLuan}**`);
  lines.push(
    `- Kịch bản: ${run.scenarioId}${detail.scenarioName ? ` — ${detail.scenarioName}` : ""}`,
  );
  lines.push(`- Chế độ: ${RUN_MODE_LABELS[run.mode] ?? run.mode}`);
  lines.push(`- Đích kiểm thử: ${run.targetUrl}`);
  lines.push(`- Bắt đầu: ${fmtThoiGian(run.startedAt)} · Kết thúc: ${fmtThoiGian(run.finishedAt)}`);
  lines.push("");

  if (detail.stop) {
    lines.push("## Dừng theo yêu cầu (S5.2)");
    lines.push("");
    lines.push(`- Thời điểm yêu cầu dừng: ${fmtThoiGian(detail.stop.requestedAt)}`);
    lines.push(`- ${detail.stop.note}`);
    lines.push(
      `- Số phiên bị đóng sau thời gian ân hạn: ${detail.stop.forcedSessions} (0 = mọi phiên đóng an toàn)`,
    );
    lines.push("");
  }

  if (detail.sandboxCheck) {
    const sc = detail.sandboxCheck;
    lines.push("## Kiểm tra sandbox kênh ngoài (S5.3)");
    lines.push("");
    lines.push(`- Thời điểm kiểm tra: ${fmtThoiGian(sc.checkedAt)}`);
    lines.push(`- Kênh ngoài kịch bản khai báo: ${sc.channels.join(", ")}`);
    lines.push(
      `- Kết quả: ${sc.allowed ? "Đang ở sandbox — được phép chạy" : "BỊ CHẶN — không xác nhận được sandbox"}`,
    );
    lines.push(`- Lý do: ${sc.reason}`);
    lines.push(`- Tín hiệu dựa vào: ${sc.signals.join("; ")}`);
    lines.push("");
  }

  lines.push("## Dữ liệu đầu vào (đã che dữ liệu nhạy cảm)");
  lines.push("");
  if (!detail.input) {
    lines.push("Lần chạy chưa sinh dữ liệu đầu vào.");
  } else {
    const d = detail.input.data;
    lines.push(`- Seed sinh dữ liệu: ${detail.input.seed}`);
    lines.push(`- Nhận diện test: ${d.nhanDienTest}`);
    lines.push(
      `- Thống kê: ${d.thongKe.soBenhNhan} bệnh nhân, ${d.thongKe.soDichVu} dịch vụ, ${d.thongKe.soLichHen} lịch hẹn, tổng giá lịch hẹn ${fmtSo(d.thongKe.tongGiaLichHen)} đ`,
    );
    lines.push("");
    lines.push("| Bệnh nhân | Họ tên | Số điện thoại (đã che) | Ngày sinh |");
    lines.push("| --- | --- | --- | --- |");
    for (const p of d.benhNhan) {
      lines.push(`| ${p.id} | ${p.hoTen} | ${p.soDienThoai} | ${p.ngaySinh} |`);
    }
    lines.push("");
    lines.push("| Dịch vụ | Tên | Giá (đ) |");
    lines.push("| --- | --- | --- |");
    for (const s of d.dichVu) lines.push(`| ${s.ma} | ${s.ten} | ${fmtSo(s.gia)} |`);
    lines.push("");
    lines.push("| Lịch hẹn | Bệnh nhân | Dịch vụ | Ngày giờ | Giá (đ) |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const a of d.lichHen) {
      lines.push(`| ${a.id} | ${a.benhNhanId} | ${a.dichVuMa} | ${a.ngayGio} | ${fmtSo(a.gia)} |`);
    }
  }
  lines.push("");

  lines.push("## Các bước của lần chạy");
  lines.push("");
  if (detail.steps.length === 0) {
    lines.push("Chưa ghi nhận bước nào.");
  } else {
    lines.push("| Bước | Tên | Trạng thái | Thời lượng (ms) | Ghi chú |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const step of detail.steps) {
      lines.push(
        `| ${step.stepId} | ${step.name} | ${NHAN_TRANG_THAI_BUOC[step.status] ?? step.status} | ${step.durationMs ?? "—"} | ${step.errorCode ?? ""} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Bảng đối chiếu kiểm đếm");
  lines.push("");
  if (!detail.kiemDem) {
    lines.push("Lần chạy này không có bảng đối chiếu (kịch bản không khai báo kiểm đếm hoặc khối kiểm đếm chưa chạy).");
  } else {
    const bang = detail.kiemDem;
    lines.push(
      `Kết quả kiểm đếm: ${bang.ketQua === "qua" ? "QUA" : "HỎNG"} — ${bang.soKhop} khớp, ${bang.soLech} lệch, ${bang.soKhongKiemChung} không kiểm chứng được.`,
    );
    lines.push("");
    lines.push("| Chỉ tiêu | Kỳ vọng | UI | API | DB | Kết quả |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const dong of bang.cacChiTieu) {
      const ketQua =
        dong.ketQua === "khop" ? "Khớp" : dong.ketQua === "lech" ? "Lệch" : "Không kiểm chứng được";
      lines.push(
        `| ${dong.ten} | ${fmtSo(dong.kyVong)} | ${fmtSo(dong.ui)} | ${fmtSo(dong.api)} | ${fmtSo(dong.db)} | ${ketQua} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Dọn dữ liệu sau lần chạy");
  lines.push("");
  if (!detail.cleanup) {
    lines.push("Chưa có báo cáo dọn dữ liệu cho lần chạy này.");
  } else {
    const c = detail.cleanup;
    lines.push(
      `- Kết quả: ${c.sach ? "Sạch — đã dọn hết dữ liệu test của lần chạy" : `CHƯA SẠCH — còn sót ${c.conSot.length} thực thể`}`,
    );
    lines.push(`- Đã dọn: ${c.daDon} thực thể (đường: ${c.duong})`);
    for (const sot of c.conSot) {
      lines.push(`- Còn sót: ${sot.type} ${sot.entityId} — ${sot.lyDo}`);
    }
  }
  lines.push("");

  lines.push("## Video theo vai");
  lines.push("");
  for (const video of detail.videos) {
    lines.push(
      video.available
        ? `- ${video.label}: ${video.url}`
        : `- ${video.label}: (không có video — ${video.reason})`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
