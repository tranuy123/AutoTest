/**
 * Cong chan dich den (S1.2, AD-6).
 * Moi lan chay deu phai qua evaluateTarget truoc khi cap phat bat ky tai
 * nguyen nao. Nguyen tac fail-closed: URL khong parse duoc, co thong tin
 * dang nhap ben trong, hoac khong khop allowlist -> chan.
 */

export interface TargetEvaluation {
  allowed: boolean;
  reason: string;
  /** Origin da chuan hoa cua URL dich (khong chua thong tin dang nhap). */
  origin: string | null;
}

function parseEntry(entry: string): URL | null {
  try {
    return new URL(entry);
  } catch {
    return null;
  }
}

export function evaluateTarget(targetUrl: string, allowlist: string[]): TargetEvaluation {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return { allowed: false, reason: "URL đích không hợp lệ", origin: null };
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return {
      allowed: false,
      reason: `Giao thức không được phép: ${target.protocol}`,
      origin: target.origin,
    };
  }

  if (target.username || target.password) {
    return {
      allowed: false,
      reason: "URL đích chứa thông tin đăng nhập — bị chặn",
      origin: target.origin,
    };
  }

  for (const entry of allowlist) {
    const allowed = parseEntry(entry);
    if (!allowed) continue;
    if (allowed.origin !== target.origin) continue;
    const allowedPath = allowed.pathname.endsWith("/")
      ? allowed.pathname
      : `${allowed.pathname}/`;
    const targetPath = `${target.pathname}/`;
    if (allowed.pathname === "/" || targetPath.startsWith(allowedPath)) {
      return { allowed: true, reason: "URL đích nằm trong allowlist", origin: target.origin };
    }
  }

  return {
    allowed: false,
    reason: "URL đích không nằm trong allowlist UAT — đã chặn (AD-6)",
    origin: target.origin,
  };
}

export class TargetBlockedError extends Error {
  readonly evaluation: TargetEvaluation;

  constructor(evaluation: TargetEvaluation) {
    super(evaluation.reason);
    this.name = "TargetBlockedError";
    this.evaluation = evaluation;
  }
}

export function assertTargetAllowed(targetUrl: string, allowlist: string[]): TargetEvaluation {
  const evaluation = evaluateTarget(targetUrl, allowlist);
  if (!evaluation.allowed) throw new TargetBlockedError(evaluation);
  return evaluation;
}
