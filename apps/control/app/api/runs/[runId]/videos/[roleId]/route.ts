/**
 * Route proxy phat lai video theo vai (S5.1 AC-2): stream than phan
 * hoi tu Orchestrator ve trinh duyet de the <video> phat duoc ngay
 * tren trang ket qua, giu nguyen content-type/content-length.
 */
import { ORCHESTRATOR_URL } from "../../../../../../lib/orchestrator";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string; roleId: string }> },
) {
  const { runId, roleId } = await ctx.params;
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/videos/${encodeURIComponent(roleId)}`,
      { cache: "no-store" },
    );
    if (!res.ok || !res.body) {
      return new Response("Không có video của vai này", {
        status: res.status === 200 ? 404 : res.status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const headers = new Headers();
    headers.set("content-type", res.headers.get("content-type") ?? "video/webm");
    const length = res.headers.get("content-length");
    if (length) headers.set("content-length", length);
    return new Response(res.body, { status: 200, headers });
  } catch {
    return new Response("Chưa kết nối được Orchestrator", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
