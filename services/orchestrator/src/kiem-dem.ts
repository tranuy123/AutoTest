/**
 * Dich vu kiem dem cua lan chay (S4.2): noi Oracle (S4.1) voi Reconciler.
 * Executor goi sau khi cac vai chay xong: tinh bo ky vong tu du lieu da
 * sinh + ket qua buoc, doc 3 nguon, tra bang doi chieu de executor gan
 * vao ket qua lan chay (ket-qua.json + trang thai lan chay).
 */
import { ngaySaigon } from "@autotest/oracle";
import type { ScenarioDefinition } from "@autotest/scenario-schema";

import type { AppConfig } from "./config.js";
import type { GeneratedRunData } from "./data-generator.js";
import { tinhBoKyVong } from "./ky-vong.js";
import {
  ApiNguonSoLieu,
  DbNguonSoLieu,
  PgDbExecutor,
  UiNguonSoLieu,
  type NguonSoLieu,
} from "./nguon-so-lieu.js";
import { Reconciler, type BangDoiChieu } from "./reconciler.js";
import type { RunRecord } from "./run-store.js";
import type { WorkerSessionResult } from "./worker-client.js";

export interface KiemDemDeps {
  /** Nguon API (doc theo lan chay qua targetBaseUrl cua lan chay). */
  api: NguonSoLieu;
  /** Nguon DB (chi doc). */
  db: NguonSoLieu;
  /** Tenant/chi nhanh test - moi truy van nguon deu loc theo tenant nay. */
  tenant: string;
}

/** Ngay nghiep vu tu run_id AUTOTEST_YYYYMMDD_NNN; sai dinh dang thi lay ngay Saigon hien tai. */
export function ngayTuRunId(runId: string): string {
  const match = /^AUTOTEST_(\d{4})(\d{2})(\d{2})_\d+$/.exec(runId);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return ngaySaigon(new Date().toISOString());
}

export class KiemDemService {
  constructor(private readonly deps: KiemDemDeps) {}

  async kiemDem(input: {
    run: RunRecord;
    scenario: ScenarioDefinition;
    generated: GeneratedRunData;
    sessionResults: readonly WorkerSessionResult[];
  }): Promise<BangDoiChieu> {
    const boKyVong = tinhBoKyVong({
      scenario: input.scenario,
      generated: input.generated,
      sessionResults: input.sessionResults,
    });
    const reconciler = new Reconciler([
      new UiNguonSoLieu(input.sessionResults),
      this.deps.api,
      this.deps.db,
    ]);
    return reconciler.doiChieu({
      runId: input.run.runId,
      ngay: ngayTuRunId(input.run.runId),
      nhanDienTest: `AUTOTEST_${input.run.runId}`,
      tenant: this.deps.tenant,
      targetBaseUrl: input.run.targetUrl,
      metrics: input.scenario.kiemDem ?? [],
      boKyVong,
      generated: input.generated,
    });
  }
}

/** Dung dich vu kiem dem tu cau hinh moi truong (index.ts goi khi khoi dong). */
export function taoKiemDemService(config: AppConfig): KiemDemService {
  const api = new ApiNguonSoLieu({ path: config.crmBaoCao.apiPath });
  const db = new DbNguonSoLieu(
    config.crmBaoCao.dbReadonlyUrl ? new PgDbExecutor(config.crmBaoCao.dbReadonlyUrl) : null,
    {
      ...(config.crmBaoCao.dbSql.tongDoanhThu
        ? { tongDoanhThu: config.crmBaoCao.dbSql.tongDoanhThu }
        : {}),
      ...(config.crmBaoCao.dbSql.doanhThuKhach
        ? { doanhThuKhach: config.crmBaoCao.dbSql.doanhThuKhach }
        : {}),
      ...(config.crmBaoCao.dbSql.soCheckIn
        ? { soCheckIn: config.crmBaoCao.dbSql.soCheckIn }
        : {}),
      ...(config.crmBaoCao.dbSql.soLichHen
        ? { soLichHen: config.crmBaoCao.dbSql.soLichHen }
        : {}),
    },
  );
  return new KiemDemService({ api, db, tenant: config.testTenant });
}
