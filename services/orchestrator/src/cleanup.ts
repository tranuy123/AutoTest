/**
 * Buoc don du lieu theo run_id (S2.4, AD-5).
 * - Chi don cac thuc the co trong so dang ky cua DUNG lan chay do va
 *   thuoc tenant test; du lieu lan chay khac/du lieu ngoai pham vi test
 *   khong bao gio bi cham toi (AC-2).
 * - Thu tu nguoc phu thuoc: hoa don -> lich hen -> ... (entity-registry).
 * - Loi khi don khong bi nuot: thuc the don khong duoc ghi vao bao cao
 *   kem ly do, va lan chay bi danh dau "dọn chưa sạch" (AC-3).
 * - Uu tien don qua API cua CRM (Dev Notes S2.4); duong xoa mac dinh la
 *   DELETE {baseUrl}/api/test-data/{type}/{id} kem header run_id + tenant,
 *   ghi de bang CRM_CLEANUP_PATH_TEMPLATE neu CRM dat khac.
 */
import { cleanupPriority, type EntityRegistry } from "./entity-registry.js";
import type { RunService } from "./run-store.js";

export interface CleanupDeleteInput {
  type: string;
  entityId: string;
  runId: string;
  tenant: string;
  baseUrl: string;
}

export type CleanupDeleteResult =
  | { ok: true; via: "api" }
  | { ok: false; reason: string };

export interface CrmCleanupClient {
  deleteEntity: (input: CleanupDeleteInput) => Promise<CleanupDeleteResult>;
}

export interface HttpCleanupOptions {
  /** Mau duong xoa, mac dinh "/api/test-data/{type}/{id}". */
  pathTemplate?: string;
  /** Token tuy chon cho endpoint don (khong bat buoc). */
  token?: string | null;
  fetchFn?: typeof fetch;
}

export class HttpCrmCleanupClient implements CrmCleanupClient {
  private readonly pathTemplate: string;
  private readonly token: string | null;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpCleanupOptions = {}) {
    this.pathTemplate = options.pathTemplate ?? "/api/test-data/{type}/{id}";
    this.token = options.token ?? null;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async deleteEntity(input: CleanupDeleteInput): Promise<CleanupDeleteResult> {
    const path = this.pathTemplate
      .replace("{type}", encodeURIComponent(input.type))
      .replace("{id}", encodeURIComponent(input.entityId));
    const url = `${input.baseUrl.replace(/\/$/, "")}${path}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "DELETE",
        headers: {
          "x-autotest-run-id": input.runId,
          "x-autotest-tenant": input.tenant,
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
      });
    } catch (error) {
      return {
        ok: false,
        reason: `Không gọi được CRM: ${error instanceof Error ? error.message : "lỗi mạng"}`,
      };
    }
    // 404 = thuc the da khong con tren CRM: coi nhu da don.
    if (res.ok || res.status === 404) return { ok: true, via: "api" };
    return { ok: false, reason: `CRM trả HTTP ${res.status} khi xoá ${input.type} ${input.entityId}` };
  }
}

export interface CleanupLeftover {
  type: string;
  entityId: string;
  lyDo: string;
}

export interface CleanupReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** So thuc the da don sach. */
  daDon: number;
  /** So thuc the con sot kem ly do (AC-3). */
  conSot: CleanupLeftover[];
  sach: boolean;
  /** Duong da dung de don (ghi ro theo Dev Notes): "api" khi don qua API. */
  duong: string;
}

export interface CleanupDeps {
  registry: EntityRegistry;
  client: CrmCleanupClient;
  runService: RunService;
  /** Lay URL dich cua lan chay (tu ban ghi lan chay). */
  targetBaseUrlOf: (runId: string) => Promise<string | null>;
  tenant: string;
}

export class CleanupService {
  private readonly reports = new Map<string, CleanupReport>();

  constructor(private readonly deps: CleanupDeps) {}

  /** Bao cao don gan nhat cua lan chay (neu da don). */
  getReport(runId: string): CleanupReport | null {
    return this.reports.get(runId) ?? null;
  }

  /**
   * Don toan bo thuc the cua lan chay. Idempotent: thuc the da don
   * (cleanedAt != null) bi bo qua nen goi lai chi don phan con sot.
   */
  async cleanupRun(runId: string): Promise<CleanupReport> {
    const startedAt = new Date().toISOString();
    const baseUrl = await this.deps.targetBaseUrlOf(runId);
    const entities = (await this.deps.registry.listByRun(runId))
      .filter((e) => e.cleanedAt === null)
      .sort((a, b) => cleanupPriority(b.type) - cleanupPriority(a.type));

    let daDon = 0;
    const conSot: CleanupLeftover[] = [];
    if (!baseUrl) {
      for (const entity of entities) {
        conSot.push({
          type: entity.type,
          entityId: entity.entityId,
          lyDo: "Không tìm thấy lần chạy để biết URL đích",
        });
      }
    } else {
      for (const entity of entities) {
        const result = await this.deps.client.deleteEntity({
          type: entity.type,
          entityId: entity.entityId,
          runId,
          tenant: this.deps.tenant,
          baseUrl,
        });
        if (result.ok) {
          daDon++;
          await this.deps.registry.markCleaned(runId, entity.type, entity.entityId);
        } else {
          conSot.push({ type: entity.type, entityId: entity.entityId, lyDo: result.reason });
        }
      }
    }

    const report: CleanupReport = {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      daDon,
      conSot,
      sach: conSot.length === 0,
      duong: "api",
    };
    this.reports.set(runId, report);
    // AC-3: con sot thi danh dau ro tren lan chay, khong im lang.
    await this.deps.runService
      .updateCleanupStatus(runId, report.sach ? "sach" : "chua-sach")
      .catch(() => undefined);
    return report;
  }
}
