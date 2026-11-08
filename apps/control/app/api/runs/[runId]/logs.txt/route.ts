/**
 * Route proxy tai file nhat ky .txt cua lan chay (S5.6): dinh dang gui
 * di ho tro. Chuyen nguyen van ban text tu Orchestrator, ep header tai
 * xuong voi ten file nhat-ky-<runId>.txt.
 */
import { ORCHESTRATOR_URL } from "../../../../../lib/orchestrator";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/logs.txt`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return new Response("Không tải được nhật ký của lần chạy này", {
        status: res.status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const text = await res.text();
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="nhat-ky-${runId}.txt"`,
      },
    });
  } catch {
    return new Response("Chưa kết nối được Orchestrator", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
