/**
 * Cau hinh moi truong cua orchestrator (S1.2).
 * Nguon duy nhat la bien moi truong (.env tren may chay) - khong luu secret
 * vao DB, khong tra mat khau ra API/giao dien.
 * Nguyen tac fail-closed: thieu bien bat buoc -> tu choi khoi dong.
 */

export interface RoleDefinition {
  id: string;
  label: string;
  envPrefix: string;
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  { id: "benh-nhan", label: "Bệnh nhân", envPrefix: "BENH_NHAN" },
  { id: "le-tan", label: "Lễ tân", envPrefix: "LE_TAN" },
  { id: "bac-si", label: "Bác sĩ", envPrefix: "BAC_SI" },
  { id: "thu-ngan", label: "Thu ngân", envPrefix: "THU_NGAN" },
  { id: "quan-ly", label: "Quản lý", envPrefix: "QUAN_LY" },
] as const;

export interface RoleAccount {
  id: string;
  label: string;
  username: string | null;
  /** Chi de phuc vu logic noi bo (dang nhap o Epic 3) - khong bao gio dua vao trang thai API. */
  password: string | null;
  configured: boolean;
}

/**
 * Cau hinh nguon so lieu cho khoi kiem dem (S4.2) - doc tu he thong dich.
 * dbReadonlyUrl chua thong tin dang nhap DB nen KHONG bao gio dua vao
 * trang thai API/giao dien; thieu cau hinh thi nguon tu bao loi khi doc
 * (chi tieu thanh "khong kiem chung duoc" - AC-4), khong chan khoi dong.
 */
export interface CrmBaoCaoConfig {
  /** Duong dan API bao cao cua CRM tren dich, mac dinh "/api/bao-cao/doanh-thu". */
  apiPath: string;
  /** Connection string CHI DOC toi DB cua dich kiem thu (CRM_DB_READONLY_URL). */
  dbReadonlyUrl: string | null;
  /** Cau SQL chi doc theo loai chi tieu; null = chua cau hinh. */
  dbSql: {
    tongDoanhThu: string | null;
    doanhThuKhach: string | null;
    soCheckIn: string | null;
    soLichHen: string | null;
  };
}

export interface AppConfig {
  port: number;
  targetBaseUrl: string;
  allowlist: string[];
  testTenant: string;
  /** true = kenh ngoai dang o sandbox; false = khong phai sandbox; null = chua khai bao. */
  channelsSandbox: boolean | null;
  /**
   * Duong dan health cua dich kiem thu de S5.3 doc co sandbox kenh ngoai
   * tu chinh dich (tin hieu health). Mac dinh "/api/health"; phan hoi JSON
   * duoc doc cac khoa: sandbox / kenhNgoaiSandbox / channelsSandbox /
   * kenhNgoai.sandbox (boolean).
   */
  crmHealthPath: string;
  roles: RoleAccount[];
  databaseUrl: string | null;
  crmBaoCao: CrmBaoCaoConfig;
}

export class ConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[], message?: string) {
    super(message ?? `Thieu bien moi truong bat buoc: ${missing.join(", ")}`);
    this.name = "ConfigError";
    this.missing = missing;
  }
}

const REQUIRED_VARS = ["TARGET_BASE_URL", "TARGET_ALLOWLIST", "TEST_TENANT"] as const;

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const missing = REQUIRED_VARS.filter((name) => !nonEmpty(env[name]));
  if (missing.length > 0) {
    throw new ConfigError([...missing]);
  }

  const targetBaseUrl = nonEmpty(env.TARGET_BASE_URL) as string;
  try {
    // Chi chap nhan URL hop le; loi dinh dang cung la fail-closed.
    new URL(targetBaseUrl);
  } catch {
    throw new ConfigError([], `TARGET_BASE_URL khong phai URL hop le: ${targetBaseUrl}`);
  }

  const allowlist = (env.TARGET_ALLOWLIST ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const roles: RoleAccount[] = ROLE_DEFINITIONS.map((def) => {
    const username = nonEmpty(env[`ROLE_${def.envPrefix}_USERNAME`]);
    const password = nonEmpty(env[`ROLE_${def.envPrefix}_PASSWORD`]);
    return {
      id: def.id,
      label: def.label,
      username,
      password,
      configured: username !== null && password !== null,
    };
  });

  const sandboxRaw = nonEmpty(env.CHANNELS_SANDBOX)?.toLowerCase() ?? null;

  return {
    port: Number(env.PORT ?? 3101),
    targetBaseUrl,
    allowlist,
    testTenant: nonEmpty(env.TEST_TENANT) as string,
    channelsSandbox: sandboxRaw === null ? null : sandboxRaw === "true",
    crmHealthPath: nonEmpty(env.CRM_HEALTH_PATH) ?? "/api/health",
    roles,
    databaseUrl: nonEmpty(env.DATABASE_URL),
    crmBaoCao: {
      apiPath: nonEmpty(env.CRM_API_BAO_CAO_PATH) ?? "/api/bao-cao/doanh-thu",
      dbReadonlyUrl: nonEmpty(env.CRM_DB_READONLY_URL),
      dbSql: {
        tongDoanhThu: nonEmpty(env.CRM_DB_SQL_TONG_DOANH_THU),
        doanhThuKhach: nonEmpty(env.CRM_DB_SQL_DOANH_THU_KHACH),
        soCheckIn: nonEmpty(env.CRM_DB_SQL_SO_CHECK_IN),
        soLichHen: nonEmpty(env.CRM_DB_SQL_SO_LICH_HEN),
      },
    },
  };
}

/** Trang thai moi truong dua ra API/giao dien - tuyet doi khong chua mat khau. */
export interface EnvironmentStatus {
  targetBaseUrl: string;
  allowlist: string[];
  testTenant: string;
  channelsSandbox: boolean | null;
  roles: Array<{
    id: string;
    label: string;
    username: string | null;
    configured: boolean;
  }>;
}

export function toEnvironmentStatus(config: AppConfig): EnvironmentStatus {
  return {
    targetBaseUrl: config.targetBaseUrl,
    allowlist: [...config.allowlist],
    testTenant: config.testTenant,
    channelsSandbox: config.channelsSandbox,
    roles: config.roles.map((role) => ({
      id: role.id,
      label: role.label,
      username: role.username,
      configured: role.configured,
    })),
  };
}
