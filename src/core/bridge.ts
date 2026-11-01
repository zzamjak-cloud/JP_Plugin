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
export async function exec<T = any>(command: string, params: Record<string, unknown> = {}): Promise<T> {
  // file.*(문서 생성/닫기)·document.* 처럼 문서 히스토리 밖 명령은 coalesce를 거부하므로 붙이지 않는다
  const groupable = historyKey && params.coalesce === undefined && !/^(file|document|command|prefs|ui)\./.test(command);
  if (!groupable) return pcCall<T>("engine.execute", { command, params });
  try {
    return await pcCall<T>("engine.execute", { command, params: { ...params, coalesce: historyKey } });
  } catch (e) {
    // coalesce를 모르는 엄격 명령은 그룹 없이 재시도 (파라미터 검증은 실행 전이라 중복 실행 없음)
    if (String(e).includes("unknown parameter `coalesce`")) return pcCall<T>("engine.execute", { command, params });
    throw e;
  }
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

// 기능 실행 직렬화: 두 기능(또는 자동 붙여넣기 폴링)이 동시에 문서 인덱스·활성 문서를 바꾸며 서로를 깨뜨리지 않도록
// 한 번에 하나만 PhotoCraft 작업을 수행한다. (중첩 호출 금지 — 기능 내부에서 다시 runExclusive를 부르지 않는다)
let exclusiveChain: Promise<unknown> = Promise.resolve();
let exclusiveDepth = 0;

/** 다른 기능 작업이 끝난 뒤 순서대로 실행 */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  exclusiveDepth++;
  const next = exclusiveChain.then(fn).finally(() => {
    exclusiveDepth--;
  });
  exclusiveChain = next.catch(() => undefined);
  return next;
}

/** 실행 중이거나 대기 중인 기능 작업이 있으면 건너뛰고 null (폴링용) */
export function tryRunExclusive<T>(fn: () => Promise<T>): Promise<T | null> {
  if (exclusiveDepth > 0) return Promise.resolve(null);
  return runExclusive(fn);
}
