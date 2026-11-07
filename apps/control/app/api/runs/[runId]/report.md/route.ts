/**
 * Route proxy tai bao cao Markdown cua lan chay (S5.1 AC-3): chuyen
 * nguyen van file .md tu Orchestrator kem header tai xuong.
 */
import { ORCHESTRATOR_URL } from "../../../../../lib/orchestrator";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/api/runs/${encodeURIComponent(runId)}/report.md`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return new Response("Không tải được báo cáo của lần chạy này", {
        status: res.status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const markdown = await res.text();
    return new Response(markdown, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition":
          res.headers.get("content-disposition") ??
          `attachment; filename="bao-cao-${runId}.md"`,
      },
    });
  } catch {
    return new Response("Chưa kết nối được Orchestrator", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
