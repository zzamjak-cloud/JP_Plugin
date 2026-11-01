// PhotoCraft 제어 채널 래퍼. 모든 PhotoCraft 조작은 lib/ 를 거쳐 이 파일의 함수로만 나간다.
import { transport } from "./transport";
const invoke = <T>(cmd: string, args?: Record<string, unknown>) => transport().invoke<T>(cmd, args);

export interface PcConfig {
  appPath: string;
  port: number;
  /** PhotoCraft 자동화 읽기/쓰기 루트. 이 폴더 밖 파일은 app.open/app.save로 접근 불가 */
  root: string;
}

export interface PcStatus {
  connected: boolean;
  running: boolean;
  config: PcConfig;
  error: string | null;
}

/** 제어 메서드 직접 호출 (app.open, app.save, ui.inspect …) */
export function pcCall<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>("pc_call", { method, params });
}

// 히스토리 그룹 키: 같은 coalesce 키를 가진 연속 명령은 PhotoCraft에서 Undo 한 단계로 합쳐진다.
let historyKey: string | null = null;

/** 엔진 명령 실행 (UXP batchPlay 대응) */
export function exec<T = any>(command: string, params: Record<string, unknown> = {}): Promise<T> {
  const p = historyKey && params.coalesce === undefined ? { ...params, coalesce: historyKey } : params;
  return pcCall<T>("engine.execute", { command, params: p });
}

/** 콜백 안의 모든 엔진 명령을 Undo 한 단계로 묶는다 (UXP executeAsModal + suspendHistory 대응) */
export async function withHistory<T>(fn: () => Promise<T>): Promise<T> {
  if (historyKey) return fn();
  historyKey = `jp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    return await fn();
  } finally {
    historyKey = null;
  }
}

/** 실패해도 예외를 던지지 않는 엔진 명령 실행 */
export async function tryExec<T = any>(command: string, params: Record<string, unknown> = {}): Promise<T | null> {
  try {
    return await exec<T>(command, params);
  } catch {
    return null;
  }
}

export const pcStatus = () => invoke<PcStatus>("pc_status");
export const pcLaunch = () => invoke<void>("pc_launch");
export const pcQuit = () => invoke<void>("pc_quit");
export const pcSetConfig = (config: PcConfig) => invoke<void>("pc_set_config", { config });

let cachedConfig: PcConfig | null = null;
/** 현재 설정(자동화 루트 등). 상태 조회 시 갱신된다 */
export async function getConfig(): Promise<PcConfig> {
  if (!cachedConfig) cachedConfig = (await pcStatus()).config;
  return cachedConfig;
}
export function setCachedConfig(c: PcConfig) {
  cachedConfig = c;
}
