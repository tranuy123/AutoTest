/**
 * Schema kich ban AutoTest (S2.1, QD-2: YAML la chuan goc).
 * Khoa YAML dung tieng Viet khong dau de nguoi viet kich ban (tester VN)
 * doc/viet truc tiep; thong bao loi tra ve bang tieng Viet co dau.
 *
 * Nguyen tac:
 * - Kich ban la du lieu, khong phai code (AD-2): moi object deu .strict()
 *   de chan khoa la (ke ca khoa "script"/"eval").
 * - Diem dong bo theo su kien (AD-3): buoc phat su kien bang `phatSuKien`,
 *   buoc khac cho bang `choSuKien`; moi su kien duoc cho phai co buoc phat.
 * - Tang schemaVersion khi doi cau truc (Dev Notes S2.1).
 */
import { z } from "zod";

import { isKnownAction } from "./actions.js";
import { ROLE_IDS, type RoleId } from "./roles.js";

export const SCENARIO_SCHEMA_VERSION = 1;

const roleSchema = z.enum(ROLE_IDS as unknown as [RoleId, ...RoleId[]]);

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Phải là slug chữ thường, số và dấu gạch ngang");

export const dataGenSchema = z
  .object({
    benhNhan: z
      .object({ soLuong: z.number().int().min(0).max(200) })
      .strict()
      .optional(),
    dichVu: z
      .array(
        z
          .object({
            ma: z.string().min(1),
            ten: z.string().min(1),
            gia: z.number().int().min(0),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    lichHen: z
      .object({ soLuong: z.number().int().min(0).max(200) })
      .strict()
      .optional(),
    phuTro: z
      .array(
        z
          .object({
            loai: z.string().min(1),
            soLuong: z.number().int().min(0).max(200),
            truong: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();

export const stepSchema = z
  .object({
    id: slugSchema,
    vai: roleSchema,
    hanhDong: z.string().min(1),
    choSuKien: z.string().min(1).optional(),
    phatSuKien: z.string().min(1).optional(),
    duLieu: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    thoiGianChoGiay: z.number().int().min(1).max(3600).optional(),
  })
  .strict();

export const metricSchema = z
  .object({
    id: slugSchema,
    ten: z.string().min(1),
    nguon: z.array(z.enum(["ui", "api", "db"])).min(1),
    kyVong: z
      .object({
        tuDuLieuSinh: z.string().min(1).optional(),
        giaTri: z.number().optional(),
      })
      .strict()
      .refine((k) => k.tuDuLieuSinh !== undefined || k.giaTri !== undefined, {
        message: "Chỉ tiêu phải có kỳ vọng: hoặc 'tuDuLieuSinh' hoặc 'giaTri'",
      }),
    donVi: z.string().min(1).optional(),
  })
  .strict();

export const scenarioSchema = z
  .object({
    schemaVersion: z.literal(SCENARIO_SCHEMA_VERSION),
    id: slugSchema,
    ten: z.string().min(1),
    moTa: z.string().optional(),
    cacVai: z.array(roleSchema).min(1),
    sinhDuLieu: dataGenSchema.optional(),
    cacBuoc: z.array(stepSchema).min(1),
    kiemDem: z.array(metricSchema).optional(),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    // Vai khong duoc trung.
    const seenRoles = new Set<string>();
    scenario.cacVai.forEach((vai, index) => {
      if (seenRoles.has(vai)) {
        ctx.addIssue({
          code: "custom",
          path: ["cacVai", index],
          message: `Vai '${vai}' bị trùng trong cacVai`,
        });
      }
      seenRoles.add(vai);
    });

    // Id buoc khong duoc trung.
    const seenSteps = new Set<string>();
    scenario.cacBuoc.forEach((buoc, index) => {
      if (seenSteps.has(buoc.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cacBuoc", index, "id"],
          message: `Id bước '${buoc.id}' bị trùng`,
        });
      }
      seenSteps.add(buoc.id);
    });

    // Vai cua buoc phai nam trong cacVai (AC-4: thieu vai).
    scenario.cacBuoc.forEach((buoc, index) => {
      if (!scenario.cacVai.includes(buoc.vai)) {
        ctx.addIssue({
          code: "custom",
          path: ["cacBuoc", index, "vai"],
          message: `Vai '${buoc.vai}' của bước '${buoc.id}' không nằm trong cacVai của kịch bản`,
        });
      }
      // Hanh dong phai co trong thu vien buoc dung chung (AD-2, AC-4).
      if (!isKnownAction(buoc.hanhDong)) {
        ctx.addIssue({
          code: "custom",
          path: ["cacBuoc", index, "hanhDong"],
          message: `Hành động '${buoc.hanhDong}' không có trong thư viện bước dùng chung`,
        });
      }
    });

    // Diem dong bo: moi su kien duoc cho phai co buoc phat (AD-3, AC-4).
    const emitted = new Set(
      scenario.cacBuoc.map((b) => b.phatSuKien).filter((e): e is string => Boolean(e)),
    );
    scenario.cacBuoc.forEach((buoc, index) => {
      if (buoc.choSuKien && !emitted.has(buoc.choSuKien)) {
        ctx.addIssue({
          code: "custom",
          path: ["cacBuoc", index, "choSuKien"],
          message: `Bước '${buoc.id}' chờ sự kiện '${buoc.choSuKien}' nhưng không có bước nào phát sự kiện này`,
        });
      }
    });

    // Id chi tieu kiem dem khong trung.
    const seenMetrics = new Set<string>();
    (scenario.kiemDem ?? []).forEach((metric, index) => {
      if (seenMetrics.has(metric.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["kiemDem", index, "id"],
          message: `Id chỉ tiêu '${metric.id}' bị trùng`,
        });
      }
      seenMetrics.add(metric.id);
    });
  });

export type DataGenBlock = z.infer<typeof dataGenSchema>;
export type ScenarioStepDef = z.infer<typeof stepSchema>;
export type ScenarioMetric = z.infer<typeof metricSchema>;
export type ScenarioDefinition = z.infer<typeof scenarioSchema>;
