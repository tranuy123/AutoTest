/**
 * @autotest/scenario-schema
 * S1.1: kieu nen tang (vai, che do chay) - giu nguyen de tuong thich.
 * S2.1: schema kich ban YAML day du + validate loi co cau truc (dong/truong,
 * tieng Viet) + bo chuyen doi Excel -> YAML (QD-2).
 */
export * from "./roles.js";
export * from "./actions.js";
export * from "./schema.js";
export * from "./validate.js";
export * from "./excel.js";

import type { RoleId } from "./roles.js";

/** Che do chay: xem truc tiep (co stream) hoac chay nhanh (headless). */
export type RunMode = "xem-truc-tiep" | "chay-nhanh";

/**
 * Mot buoc trong kich ban (khai bao khung cua S1.1).
 * @deprecated Dung ScenarioStepDef trong schema.ts (S2.1) cho kich ban that.
 */
export interface ScenarioStep {
  /** Ma buoc duy nhat trong kich ban, vi du "dat-lich". */
  id: string;
  /** Vai thuc hien buoc. */
  role: RoleId;
  /** Ten hanh dong trong thu vien buoc dung chung (AD-2). */
  action: string;
  /** Ten su kien dong bo phai cho truoc khi chay buoc nay (AD-3), neu co. */
  syncEvent?: string;
}

/**
 * Khai bao mot kich ban kiem thu (dang khung S1.1).
 * @deprecated Dung ScenarioDefinition trong schema.ts (S2.1).
 */
export interface Scenario {
  id: string;
  name: string;
  roles: RoleId[];
  steps: ScenarioStep[];
}
