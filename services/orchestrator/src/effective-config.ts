/**
 * Cau hinh HIEU LUC (S5.5): gop cau hinh khai bao qua giao dien (bang
 * app_settings, migration 007) len tren cau hinh .env cua S1.2.
 * Nguyen tac: settings (neu co) ghi de env; thieu settings thi fallback
 * ve env. Moi diem dung PHAI doc settings truc tiep tai thoi diem dung
 * (khong cache) de gia tri vua luu ap dung ngay, khong can khoi dong lai.
 * Co sandbox kenh ngoai (channelsSandbox) KHONG nam o day - no chi doc
 * tu env, khong sua duoc qua giao dien (bao ve khach hang that, S5.3).
 */
import {
  ROLE_DEFINITIONS,
  type AppConfig,
  type EnvironmentStatus,
  type RoleAccount,
} from "./config.js";

export const SETTING_KEY_TARGET_BASE_URL = "target.baseUrl";
export const SETTING_KEY_TARGET_ALLOWLIST = "target.allowlist";
export const SETTING_KEY_TARGET_TENANT = "target.tenant";

export function roleUsernameKey(roleId: string): string {
  return `role.${roleId}.username`;
}

export function rolePasswordKey(roleId: string): string {
  return `role.${roleId}.password`;
}

/** Nguon doc settings toi thieu - SettingsService (settings-store.ts) thoa man. */
export interface SettingsReader {
  getAllSettings(): Promise<Map<string, string>>;
}

function settingValue(
  settings: ReadonlyMap<string, string>,
  key: string,
): string | null {
  const raw = settings.get(key);
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function parseAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export interface EffectiveTarget {
  baseUrl: string;
  allowlist: string[];
  tenant: string;
}

export function resolveTarget(
  config: AppConfig,
  settings: ReadonlyMap<string, string>,
): EffectiveTarget {
  const allowlistRaw = settingValue(settings, SETTING_KEY_TARGET_ALLOWLIST);
  return {
    baseUrl: settingValue(settings, SETTING_KEY_TARGET_BASE_URL) ?? config.targetBaseUrl,
    allowlist: allowlistRaw !== null ? parseAllowlist(allowlistRaw) : [...config.allowlist],
    tenant: settingValue(settings, SETTING_KEY_TARGET_TENANT) ?? config.testTenant,
  };
}

/**
 * Tai khoan hieu luc cua mot vai. Ten dang nhap: khoa settings ton tai
 * (ke ca rong) thi thang env - rong nghia la chu du an da xoa khai bao.
 * Mat khau: chi ghi de khi settings co gia tri khong rong; khong co cach
 * xoa mat khau qua giao dien (de trong khi luu = giu nguyen).
 */
export function resolveRoleAccount(
  config: AppConfig,
  settings: ReadonlyMap<string, string>,
  roleId: string,
): RoleAccount | null {
  const def = ROLE_DEFINITIONS.find((d) => d.id === roleId);
  if (!def) return null;
  const envAccount = config.roles.find((r) => r.id === roleId);
  const usernameKey = roleUsernameKey(roleId);
  const username = settings.has(usernameKey)
    ? settingValue(settings, usernameKey)
    : (envAccount?.username ?? null);
  const password =
    settingValue(settings, rolePasswordKey(roleId)) ?? envAccount?.password ?? null;
  return {
    id: def.id,
    label: def.label,
    username,
    password,
    configured: username !== null && password !== null,
  };
}

/** Trang thai moi truong hieu luc (cho GET /api/environment) - khong chua mat khau. */
export function resolveEnvironmentStatus(
  config: AppConfig,
  settings: ReadonlyMap<string, string>,
): EnvironmentStatus {
  const target = resolveTarget(config, settings);
  return {
    targetBaseUrl: target.baseUrl,
    allowlist: target.allowlist,
    testTenant: target.tenant,
    channelsSandbox: config.channelsSandbox,
    roles: ROLE_DEFINITIONS.map((def) => {
      const account = resolveRoleAccount(config, settings, def.id);
      return {
        id: def.id,
        label: def.label,
        username: account?.username ?? null,
        configured: account?.configured ?? false,
      };
    }),
  };
}

/**
 * Bo giai cau hinh hieu luc dung cho server + executor: moi method doc
 * settings truc tiep tu kho (khong cache) - luu xong la ap dung ngay.
 * settings = null (chua noi kho) thi moi gia tri fallback ve env.
 */
export class EffectiveConfigResolver {
  constructor(
    private readonly config: AppConfig,
    private readonly settings: SettingsReader | null,
  ) {}

  private async readSettings(): Promise<Map<string, string>> {
    if (!this.settings) return new Map();
    return this.settings.getAllSettings();
  }

  async getTarget(): Promise<EffectiveTarget> {
    return resolveTarget(this.config, await this.readSettings());
  }

  async getRoleAccount(roleId: string): Promise<RoleAccount | null> {
    return resolveRoleAccount(this.config, await this.readSettings(), roleId);
  }

  async getEnvironmentStatus(): Promise<EnvironmentStatus> {
    return resolveEnvironmentStatus(this.config, await this.readSettings());
  }
}
