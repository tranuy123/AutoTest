/**
 * Kho cau hinh khai bao qua giao dien (S5.5) - cung mau thiet ke voi
 * run-store/scenario-store: moi truy cap qua SettingsRepository, co ban
 * PostgreSQL (bang app_settings, migration 007) va ban in-memory cho test.
 *
 * SettingsService nam tren repository: doc view da CHE (khong bao gio tra
 * gia tri mat khau) va ghi co validate fail-closed - URL dich hieu luc
 * sau khi gop gia tri moi + cu PHAI nam trong allowlist hieu luc thi moi
 * duoc luu (AD-6 ap dung ngay tu luc khai bao, khong chi luc chay).
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { ROLE_DEFINITIONS, type AppConfig } from "./config.js";
import {
  SETTING_KEY_TARGET_ALLOWLIST,
  SETTING_KEY_TARGET_BASE_URL,
  SETTING_KEY_TARGET_TENANT,
  resolveRoleAccount,
  resolveTarget,
  rolePasswordKey,
  roleUsernameKey,
} from "./effective-config.js";
import { evaluateTarget } from "./target-guard.js";

export interface SettingsRepository {
  init(): Promise<void>;
  getAll(): Promise<Map<string, string>>;
  setMany(entries: ReadonlyArray<readonly [string, string]>): Promise<void>;
  close(): Promise<void>;
}

export class PgSettingsRepository implements SettingsRepository {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const existing = await this.pool.query(
        "SELECT version FROM schema_migrations WHERE version = $1",
        [version],
      );
      if (existing.rowCount && existing.rowCount > 0) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async getAll(): Promise<Map<string, string>> {
    const result = await this.pool.query<{ key: string; value: string }>(
      "SELECT key, value FROM app_settings",
    );
    return new Map(result.rows.map((row) => [row.key, row.value]));
  }

  async setMany(entries: ReadonlyArray<readonly [string, string]>): Promise<void> {
    for (const [key, value] of entries) {
      await this.pool.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, value],
      );
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class InMemorySettingsRepository implements SettingsRepository {
  private readonly values = new Map<string, string>();

  async init(): Promise<void> {}

  async getAll(): Promise<Map<string, string>> {
    return new Map(this.values);
  }

  async setMany(entries: ReadonlyArray<readonly [string, string]>): Promise<void> {
    for (const [key, value] of entries) this.values.set(key, value);
  }

  async close(): Promise<void> {}
}

/** View cau hinh hieu luc dua ra API/giao dien - chi co hasPassword, khong co mat khau. */
export interface SettingsRoleView {
  roleId: string;
  username: string | null;
  hasPassword: boolean;
}

export interface SettingsView {
  targetBaseUrl: string;
  /** Allowlist dang chuoi, cac muc cach nhau bang ", " - dung lam gia tri o nhap tren form. */
  targetAllowlist: string;
  testTenant: string;
  roles: SettingsRoleView[];
}

export type SettingsUpdateResult =
  | { ok: true; view: SettingsView }
  | { ok: false; message: string };

function fail(message: string): SettingsUpdateResult {
  return { ok: false, message };
}

export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly config: AppConfig,
  ) {}

  /** Doc truc tiep tu kho - EffectiveConfigResolver dung method nay, khong cache. */
  async getAllSettings(): Promise<Map<string, string>> {
    return this.repo.getAll();
  }

  async getView(): Promise<SettingsView> {
    const settings = await this.repo.getAll();
    const target = resolveTarget(this.config, settings);
    return {
      targetBaseUrl: target.baseUrl,
      targetAllowlist: target.allowlist.join(", "),
      testTenant: target.tenant,
      roles: ROLE_DEFINITIONS.map((def) => {
        const account = resolveRoleAccount(this.config, settings, def.id);
        return {
          roleId: def.id,
          username: account?.username ?? null,
          hasPassword: account?.password != null,
        };
      }),
    };
  }

  /**
   * Ghi cau hinh khai bao (PUT /api/settings). Chi ghi cac truong duoc
   * gui len; mat khau rong/vang mat = giu nguyen mat khau cu, co gia tri
   * = thay moi. Truoc khi luu, cau hinh dich HIEU LUC (moi + cu gop lai)
   * phai qua cong chan allowlist - lech la tu choi luu va bao ro.
   */
  async update(raw: unknown): Promise<SettingsUpdateResult> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return fail("Dữ liệu cấu hình gửi lên không hợp lệ");
    }
    const body = raw as Record<string, unknown>;
    const entries: Array<readonly [string, string]> = [];

    if (body.targetBaseUrl !== undefined) {
      if (typeof body.targetBaseUrl !== "string" || body.targetBaseUrl.trim() === "") {
        return fail("URL đích UAT phải là một địa chỉ không rỗng");
      }
      const value = body.targetBaseUrl.trim();
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return fail(`URL đích không hợp lệ: ${value}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return fail(`URL đích phải dùng http hoặc https, đang là ${parsed.protocol}`);
      }
      if (parsed.username || parsed.password) {
        return fail("URL đích không được chứa thông tin đăng nhập");
      }
      entries.push([SETTING_KEY_TARGET_BASE_URL, value] as const);
    }

    if (body.targetAllowlist !== undefined) {
      if (typeof body.targetAllowlist !== "string") {
        return fail("Allowlist UAT phải là chuỗi, các địa chỉ cách nhau bằng dấu phẩy");
      }
      entries.push([SETTING_KEY_TARGET_ALLOWLIST, body.targetAllowlist.trim()] as const);
    }

    if (body.testTenant !== undefined) {
      if (typeof body.testTenant !== "string" || body.testTenant.trim() === "") {
        return fail("Tenant / chi nhánh test không được để trống");
      }
      entries.push([SETTING_KEY_TARGET_TENANT, body.testTenant.trim()] as const);
    }

    if (body.roles !== undefined) {
      if (typeof body.roles !== "object" || body.roles === null || Array.isArray(body.roles)) {
        return fail("Danh sách tài khoản theo vai không hợp lệ");
      }
      for (const [roleId, patch] of Object.entries(body.roles as Record<string, unknown>)) {
        const def = ROLE_DEFINITIONS.find((d) => d.id === roleId);
        if (!def) {
          return fail(`Vai không tồn tại: '${roleId}'`);
        }
        if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
          return fail(`Cấu hình của vai '${def.label}' không hợp lệ`);
        }
        const { username, password } = patch as Record<string, unknown>;
        if (username !== undefined) {
          if (typeof username !== "string") {
            return fail(`Tên đăng nhập của vai '${def.label}' phải là chuỗi`);
          }
          entries.push([roleUsernameKey(roleId), username.trim()] as const);
        }
        if (password !== undefined) {
          if (typeof password !== "string") {
            return fail(`Mật khẩu của vai '${def.label}' phải là chuỗi`);
          }
          // Mat khau rong = giu nguyen mat khau hien tai, khong ghi de.
          if (password.length > 0) {
            entries.push([rolePasswordKey(roleId), password] as const);
          }
        }
      }
    }

    // Cong chan AD-6 tren cau hinh hieu luc SAU khi gop: dich phai nam
    // trong allowlist thi moi luu - chan ca khai bao sai ngay tu dau.
    const merged = await this.repo.getAll();
    for (const [key, value] of entries) merged.set(key, value);
    const target = resolveTarget(this.config, merged);
    const evaluation = evaluateTarget(target.baseUrl, target.allowlist);
    if (!evaluation.allowed) {
      return fail(
        `Không lưu được: ${evaluation.reason}. URL đích hiệu lực phải nằm trong Allowlist UAT hiệu lực`,
      );
    }

    await this.repo.setMany(entries);
    return { ok: true, view: await this.getView() };
  }
}
