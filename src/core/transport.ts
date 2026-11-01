// Tauri invoke와 Node 테스트 하네스를 같은 인터페이스로 묶는다.
// 하네스(scripts/harness.ts)는 globalThis.__JP_TRANSPORT__ 를 주입해 실제 PhotoCraft에 직접 붙는다.
import { invoke } from "@tauri-apps/api/core";

export interface Transport {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** 다이얼로그: kind = open | save | message | ask */
  dialog(kind: string, options: Record<string, unknown>): Promise<any>;
}

const injected = (globalThis as any).__JP_TRANSPORT__ as Transport | undefined;

const tauriTransport: Transport = {
  invoke: (cmd, args) => invoke(cmd, args),
  async dialog(kind, options) {
    const d = await import("@tauri-apps/plugin-dialog");
    switch (kind) {
      case "open":
        return d.open(options as any);
      case "save":
        return d.save(options as any);
      case "message":
        return d.message(String(options.text), options as any);
      case "ask":
        return d.ask(String(options.text), options as any);
    }
    throw new Error(`unknown dialog ${kind}`);
  },
};

export function transport(): Transport {
  return ((globalThis as any).__JP_TRANSPORT__ as Transport | undefined) ?? injected ?? tauriTransport;
}
