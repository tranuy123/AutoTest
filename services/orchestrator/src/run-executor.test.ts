import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScenarioYaml } from "@autotest/scenario-schema";
import { describe, expect, it } from "vitest";

import { resolveStepData } from "./run-executor.js";
import { makeExecutionStack } from "./testing.js";

const SAMPLE_YAML = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "scenario-schema",
  "samples",
  "dat-lich-den-bao-cao.yaml",
);

async function seedSampleScenario(stack: Awaited<ReturnType<typeof makeExecutionStack>>) {
  const yaml = await readFile(SAMPLE_YAML, "utf8");
  const parsed = parseScenarioYaml(yaml);
  if (!parsed.ok) throw new Error("YAML mẫu không hợp lệ");
  await stack.scenarioService.importScenario({
    filename: "dat-lich-den-bao-cao.yaml",
    format: "yaml",
    contentText: yaml,
  });
  return parsed.scenario;
}

describe("resolveStepData — giải tham chiếu dữ liệu sinh", () => {
  it("thay $benhNhan[0]/$dichVu[0]/$lichHen[0] thành khóa chấm thật, giữ nguyên giá trị thường", async () => {
    const stack = await makeExecutionStack();
    const scenario = await seedSampleScenario(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "chay-nhanh",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    const generated = (await stack.dataService.generateForRun(run.runId)).data;
    const resolved = resolveStepData(
      {
        id: "b3",
        vai: "benh-nhan",
        hanhDong: "dat-lich-hen",
        duLieu: {
          benhNhan: "$benhNhan[0]",
          dichVu: "$dichVu[0]",
          lichHen: "$lichHen[0]",
          ghiChu: "giữ nguyên",
        },
      },
      generated,
    );
    expect(resolved["benhNhan"]).toBe(generated.benhNhan[0]?.hoTen);
    expect(resolved["benhNhan.hoTen"]).toBe(generated.benhNhan[0]?.hoTen);
    expect(resolved["benhNhan.soDienThoai"]).toBe(generated.benhNhan[0]?.soDienThoai);
    expect(resolved["dichVu"]).toBe(generated.dichVu[0]?.ma);
    expect(resolved["dichVu.ten"]).toBe(generated.dichVu[0]?.ten);
    expect(resolved["lichHen.id"]).toBe(generated.lichHen[0]?.id);
    expect(resolved["ghiChu"]).toBe("giữ nguyên");
  });

  it("tham chiếu không tồn tại báo lỗi nêu rõ bước", () => {
    const generated = {
      runId: "RUN_X",
      seed: "seed-test",
      nhanDienTest: "AUTOTEST_RUN_X",
      benhNhan: [],
      dichVu: [],
      lichHen: [],
      phuTro: [],
      thongKe: { soBenhNhan: 0, soDichVu: 0, soLichHen: 0, tongGiaLichHen: 0 },
    };
    expect(() =>
      resolveStepData(
        { id: "bX", vai: "le-tan", hanhDong: "check-in", duLieu: { benhNhan: "$benhNhan[0]" } },
        generated,
      ),
    ).toThrow(/bX.*\$benhNhan\[0\]/);
  });
});

describe("RunExecutor — kịch bản mẫu nhiều vai (S3.3)", () => {
  it("AC-4: 5 vai chạy qua toàn bộ trên worker giả lập; sự kiện/kết quả/dọn đều khớp", async () => {
    const stack = await makeExecutionStack();
    const scenario = await seedSampleScenario(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });

    await stack.executor.startRun(run.runId);

    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("qua");
    // Moi buoc trong kich ban deu co ket qua ghi lai.
    expect(detail?.steps.length).toBe(scenario.cacBuoc.length);
    expect(detail?.steps.every((s) => s.status === "qua")).toBe(true);
    // Chung dong bo: toan bo chuoi buoc CHO su kien deu qua - neu dong bo
    // hong, cac buoc nay se hong vi qua han (xem test AC-3). Day la bang
    // chung truc tiep cua luong su kien AD-3 ma khong phu thuoc file
    // ket-qua.json (sandbox VM cat 0 byte file do tien trinh test ghi).
    const waitingSteps = [
      "dat-lich", // cho 'le-tan-san-sang'
      "xac-nhan-lich", // cho 'lich-da-dat'
      "check-in", // cho 'lich-da-xac-nhan'
      "bat-dau-kham", // cho 'da-check-in'
      "thanh-toan", // cho 'kham-xong'
      "xem-bao-cao", // cho 'da-thanh-toan'
    ];
    for (const stepId of waitingSteps) {
      const step = detail?.steps.find((s) => s.stepId === stepId);
      expect(step?.status).toBe("qua");
    }
    // Trang thai phien cua tung vai.
    for (const roleId of scenario.cacVai) {
      expect(stack.roleStatus.get(run.runId, roleId)?.state).toBe("xong");
    }
    // S2.4: thuc the tao ra da duoc don qua client CRM (gia lap) va danh dau sach.
    expect(detail?.run.cleanupStatus).toBe("sach");
    const entities = await stack.registry.listByRun(run.runId);
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((e) => e.cleanedAt !== null)).toBe(true);
    expect(stack.cleanupClient.calls.length).toBe(entities.length);
    expect(stack.cleanupClient.calls[0]?.runId).toBe(run.runId);
    expect(stack.cleanupClient.calls[0]?.tenant).toBe(stack.config.testTenant);
  });

  it("AC-1: giới hạn phiên song song được tôn trọng (tối đa 2 phiên cùng lúc)", async () => {
    const stack = await makeExecutionStack({}, { maxConcurrentSessions: 2 });
    const scenario = await seedSampleScenario(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    expect(stack.worker.maxActiveSessions).toBeLessThanOrEqual(2);
    expect(stack.worker.maxActiveSessions).toBeGreaterThanOrEqual(1);
  });

  it("AC-1 (tiếp): mỗi vai một phiên riêng với đúng tài khoản của vai; chế độ xem xin stream", async () => {
    const stack = await makeExecutionStack();
    const created: Array<{ roleId: string; username: string; mode: string; stream: boolean }> = [];
    const original = stack.worker.createSession.bind(stack.worker);
    stack.worker.createSession = async (req) => {
      created.push({
        roleId: req.roleId,
        username: req.username,
        mode: req.mode,
        stream: req.stream,
      });
      return original(req);
    };
    const scenario = await seedSampleScenario(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    expect(created).toHaveLength(scenario.cacVai.length);
    const byRole = new Map(created.map((c) => [c.roleId, c]));
    expect(byRole.get("le-tan")?.username).toBe("le-tan-mau@example.invalid");
    expect(byRole.get("bac-si")?.username).toBe("bac-si-mau@example.invalid");
    expect(byRole.get("thu-ngan")?.username).toBe("thu-ngan-mau@example.invalid");
    expect(new Set(created.map((c) => c.username)).size).toBe(created.length);
    expect(created.every((c) => c.mode === "xem" && c.stream)).toBe(true);
  });

  it("AC-3: vai không phát sự kiện → vai chờ hỏng đúng bước, lỗi nêu sự kiện và vai nguồn", async () => {
    const stack = await makeExecutionStack();
    // le-tan dang nhap hong -> khong phat 'le-tan-san-sang'
    stack.worker.failStepIds.add("dang-nhap-le-tan");
    const scenario = await seedSampleScenario(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("hong");
    const failedWait = detail?.steps.find((s) => s.stepId === "dat-lich");
    expect(failedWait?.status).toBe("hong");
    expect(failedWait?.errorCode).toContain("le-tan-san-sang");
    expect(failedWait?.errorCode).toContain("le-tan");
    expect(failedWait?.errorCode).toContain(run.runId);
  });

  it("vai chưa cấu hình tài khoản → lần chạy hỏng, bước lỗi nêu rõ vai và lý do", async () => {
    const stack = await makeExecutionStack({
      ROLE_BAC_SI_USERNAME: "",
      ROLE_BAC_SI_PASSWORD: "",
    });
    const scenario = await seedSampleScenario(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("hong");
    const doctorStep = detail?.steps.find((s) => s.stepId === "phien-bac-si");
    expect(doctorStep?.status).toBe("hong");
    expect(doctorStep?.errorCode).toContain("bac-si");
    expect(doctorStep?.errorCode).toContain("Chưa cấu hình tài khoản");
  });

  it("worker không mở được phiên cho một vai → lần chạy hỏng, lỗi nêu vai", async () => {
    const stack = await makeExecutionStack();
    stack.worker.failCreateForRole = "bac-si";
    const scenario = await seedSampleScenario(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("hong");
    const doctorStep = detail?.steps.find((s) => s.stepId === "phien-bac-si");
    expect(doctorStep?.errorCode).toContain("bac-si");
  });

  it("chạy trùng một run_id bị từ chối", async () => {
    const stack = await makeExecutionStack();
    const scenario = await seedSampleScenario(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://uat.example.invalid",
      status: "dang-cho",
    });
    const first = stack.executor.startRun(run.runId);
    await expect(stack.executor.startRun(run.runId)).rejects.toThrow(/đang được thực thi/);
    await first;
  });

  it("đích ngoài allowlist bị chặn ngay trước khi cấp phiên (AD-6): lần chạy kết thúc hỏng, không phiên nào được tạo", async () => {
    const stack = await makeExecutionStack();
    const scenario = await seedSampleScenario(stack);
    const run = await stack.runService.createRun({
      scenarioId: scenario.id,
      mode: "xem-truc-tiep",
      targetUrl: "https://production.example.invalid",
      status: "dang-cho",
    });
    await stack.executor.startRun(run.runId);
    const detail = await stack.runService.getRunWithSteps(run.runId);
    expect(detail?.run.status).toBe("hong");
    expect(stack.worker.sessions.size).toBe(0);
  });
});
