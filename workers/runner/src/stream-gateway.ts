/**
 * Stream Gateway (AD-9: noVNC) - cau noi WebSocket cua trinh duyet xem
 * (Control App, client @novnc/novnc) toi cong VNC cua tung phien worker.
 * Mau cau truc lay tu VncBridge cua spike S3.0 (spikes/stream/lib/servers.js)
 * nhung dung MiniWebSocket noi bo thay goi "ws".
 *
 * AD-7: stream la phu. Moi loi o gateway (VNC chet, viewer ngat, khung
 * hong) chi lam o stream chuyen trang thai "mat-tin-hieu" va dong ket noi
 * lien quan - khong nem loi vao engine thuc thi.
 */
import { createConnection, type Socket } from "node:net";

import { MiniWebSocket } from "./ws-min.js";

export type StreamState = "dang-phat" | "mat-tin-hieu";

export interface StreamInfo {
  sessionId: string;
  state: StreamState;
  viewers: number;
  bytesFromVnc: number;
  bytesToVnc: number;
  lastError: string | null;
}

interface SessionStream {
  info: StreamInfo;
  vncPort: number;
}

export class StreamGateway {
  private readonly sessions = new Map<string, SessionStream>();

  constructor(private readonly onEvent?: (message: string) => void) {}

  /** Dang ky mot phien co stream khi worker tao phien (che do xem). */
  register(sessionId: string, vncPort: number): void {
    this.sessions.set(sessionId, {
      vncPort,
      info: {
        sessionId,
        state: "dang-phat",
        viewers: 0,
        bytesFromVnc: 0,
        bytesToVnc: 0,
        lastError: null,
      },
    });
  }

  /** Huy dang ky khi phien dong - trang thai stream khong con y nghia. */
  unregister(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  status(): StreamInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  statusOf(sessionId: string): StreamInfo | null {
    const session = this.sessions.get(sessionId);
    return session ? { ...session.info } : null;
  }

  /**
   * Nhan mot ket noi WebSocket cua viewer cho phien va cau sang TCP/VNC.
   * Tra false neu phien khong co stream (viewer se nhan dong ket noi).
   */
  handleConnection(sessionId: string, ws: MiniWebSocket): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      ws.close();
      return false;
    }
    const info = session.info;
    info.viewers++;
    let tcp: Socket;
    try {
      tcp = createConnection({ port: session.vncPort, host: "127.0.0.1" });
    } catch (error) {
      info.state = "mat-tin-hieu";
      info.lastError = error instanceof Error ? error.message : "khong noi duoc VNC";
      info.viewers--;
      ws.close();
      return true;
    }
    let done = false;
    const finish = (reason: string | null) => {
      if (done) return;
      done = true;
      info.viewers = Math.max(0, info.viewers - 1);
      if (reason) {
        // Chi danh dau mat tin hieu neu phien van dang dang ky (lan chay
        // con tiep tuc) - viewer tu dong lai se tu xoa trang thai nay.
        if (this.sessions.has(sessionId)) {
          info.state = "mat-tin-hieu";
          info.lastError = reason;
        }
        this.onEvent?.(`stream ${sessionId}: mat tin hieu (${reason})`);
      }
      try {
        tcp.destroy();
      } catch {
        // Da dong.
      }
      ws.close();
    };
    ws.onMessage = (data) => {
      info.bytesToVnc += data.length;
      if (tcp.writable) tcp.write(data);
    };
    ws.onClose = () => finish(null);
    tcp.on("data", (data) => {
      info.bytesFromVnc += data.length;
      info.state = "dang-phat";
      ws.send(data);
    });
    tcp.on("close", () => finish("VNC đã đóng kết nối"));
    tcp.on("error", (error) => finish(`Lỗi VNC: ${error.message}`));
    return true;
  }
}
