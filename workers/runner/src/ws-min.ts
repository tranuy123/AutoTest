/**
 * WebSocket server toi thieu theo RFC 6455 - du cho Stream Gateway
 * (cau noi trinh duyet <-> VNC). Du an khong co san goi "ws" trong
 * workspace nen tu cai dat phan can thiet:
 * - Bat tay nang cap HTTP (Sec-WebSocket-Accept).
 * - Nhan khung cua client (co mat na, co phan manh) -> gop thanh message.
 * - Gui khung binary/text khong mat na; tra loi ping bang pong; dong sach.
 * Loi giao thuc chi dong ket noi do, khong nem ra ngoai (tinh than AD-7).
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export class MiniWebSocket {
  onMessage: ((data: Buffer) => void) | null = null;
  onClose: (() => void) | null = null;

  private buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private closed = false;

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk) => this.feed(chunk));
    socket.on("close", () => this.markClosed());
    socket.on("error", () => this.markClosed());
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send(data: Buffer): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame(0x2, data));
    } catch {
      this.markClosed();
    }
  }

  close(): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame(0x8, Buffer.alloc(0)));
      this.socket.end();
    } catch {
      // Socket da hong.
    }
    this.markClosed();
  }

  private feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = decodeFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.consumed);
      const { fin, opcode, payload } = frame;
      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        if (!this.closed) {
          try {
            this.socket.write(encodeFrame(0xa, payload));
          } catch {
            this.markClosed();
          }
        }
        continue;
      }
      if (opcode === 0xa) continue;
      // Khung du lieu (0 = tiep noi, 1 = text, 2 = binary).
      this.fragments.push(payload);
      if (fin) {
        const message = Buffer.concat(this.fragments);
        this.fragments = [];
        this.onMessage?.(message);
      }
    }
  }
}

interface DecodedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  consumed: number;
}

function decodeFrame(buffer: Buffer): DecodedFrame | null {
  if (buffer.length < 2) return null;
  const b0 = buffer[0] as number;
  const b1 = buffer[1] as number;
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let length = b1 & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Khung WS qua lon");
    length = Number(big);
    offset += 8;
  }
  let mask: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  let payload = buffer.subarray(offset, offset + length);
  if (mask) {
    const unmasked = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
      unmasked[i] = (payload[i] as number) ^ (mask[i % 4] as number);
    }
    payload = unmasked;
  }
  return { fin, opcode, payload, consumed: offset + length };
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Xu ly nang cap HTTP -> WebSocket. Tra false neu khong phai yeu cau WS hop le. */
export function acceptWebSocket(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): MiniWebSocket | null {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || req.headers.upgrade?.toLowerCase() !== "websocket") {
    return null;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const ws = new MiniWebSocket(socket);
  if (head.length > 0) {
    // Du lieu thua sau bat tay (hiem) - dua vao bo dem cua ws qua mot data event gia.
    socket.unshift(head);
  }
  return ws;
}
