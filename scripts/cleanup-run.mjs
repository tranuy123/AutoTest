#!/usr/bin/env node
/**
 * Don thu cong du lieu test cua mot lan chay theo run_id (S2.4 AC-4).
 * Goi POST /api/runs/<run_id>/cleanup cua Orchestrator va in bao cao:
 * da don bao nhieu, con sot gi (kem ly do), sach hay chua sach.
 *
 * Cach dung:
 *   node scripts/cleanup-run.mjs AUTOTEST_20261107_001
 *   ORCHESTRATOR_URL=http://localhost:3101 node scripts/cleanup-run.mjs <run_id>
 * Ma thoat: 0 = sach, 1 = con sot hoac loi.
 */
const runId = process.argv[2];
if (!runId) {
  console.error("Thiếu run_id. Cách dùng: node scripts/cleanup-run.mjs <run_id>");
  process.exit(2);
}
const base = (process.env.ORCHESTRATOR_URL ?? "http://localhost:3101").replace(/\/$/, "");
try {
  const res = await fetch(`${base}/api/runs/${encodeURIComponent(runId)}/cleanup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const report = await res.json();
  if (!res.ok) {
    console.error(`Dọn thất bại (HTTP ${res.status}):`, JSON.stringify(report));
    process.exit(1);
  }
  console.log(`Lần chạy: ${report.runId}`);
  console.log(`Đã dọn: ${report.daDon} thực thể qua ${report.duong}`);
  if (report.conSot?.length) {
    console.log("Còn sót:");
    for (const item of report.conSot) {
      console.log(`- ${item.type} ${item.entityId}: ${item.lyDo}`);
    }
  }
  console.log(report.sach ? "Kết quả: SẠCH" : "Kết quả: CHƯA SẠCH — xem phần còn sót ở trên");
  process.exit(report.sach ? 0 : 1);
} catch (error) {
  console.error("Không gọi được Orchestrator:", error instanceof Error ? error.message : error);
  process.exit(1);
}
