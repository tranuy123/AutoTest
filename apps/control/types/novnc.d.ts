/**
 * Khai bao kieu toi thieu cho @novnc/novnc (S3.2 - AD-9).
 * Goi nay khong kem type chinh thuc; chi khai bao dung phan API ma
 * OStreamNoVnc su dung. Ban cai dat that lay qua pnpm install.
 */
declare module "@novnc/novnc" {
  export default class RFB {
    constructor(
      target: HTMLElement,
      url: string,
      options?: { wsProtocols?: string[]; credentials?: Record<string, string> },
    );
    viewOnly: boolean;
    scaleViewport: boolean;
    clipViewport: boolean;
    background: string;
    addEventListener(type: string, listener: (event: CustomEvent) => void): void;
    removeEventListener(type: string, listener: (event: CustomEvent) => void): void;
    disconnect(): void;
    sendCredentials(credentials: Record<string, string>): void;
  }
}
