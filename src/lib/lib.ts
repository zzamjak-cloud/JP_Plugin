// 공용 유틸리티: 알림, 히스토리 그룹, 문서 존재 확인
import { transport } from "../core/transport";
import { withHistory } from "../core/bridge";

/** 알림 대화상자 (UXP showAlert 대응) */
export async function showAlert(text: string, title = "JP Plugin"): Promise<void> {
  await transport().dialog("message", { text, title });
}

/** 확인 대화상자 */
export function confirmDialog(text: string, title = "JP Plugin"): Promise<boolean> {
  return transport().dialog("ask", { text, title, kind: "warning" });
}

/** 여러 PhotoCraft 조작을 Undo 한 단계로 묶어 실행 (UXP executeWithHistoryGrouping 대응) */
export function executeWithHistoryGrouping<T>(fn: () => Promise<T>): Promise<T> {
  return withHistory(fn);
}

/** 오류를 알림으로 보여주는 실행 래퍼 */
export async function runSafe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    await showAlert(`${label} 실패:\n${e instanceof Error ? e.message : String(e)}`);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
