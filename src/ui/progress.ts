// 전역 진행률 표시 상태 (UXP의 #exportProgressContainer 대응)
type Listener = (p: Progress | null) => void;
export interface Progress {
  label: string;
  /** 0~100 */
  percent: number;
}
let current: Progress | null = null;
const listeners = new Set<Listener>();

export function setProgress(label: string, percent: number) {
  current = { label, percent: Math.max(0, Math.min(100, percent)) };
  listeners.forEach((l) => l(current));
}
export function clearProgress() {
  current = null;
  listeners.forEach((l) => l(null));
}
export function subscribeProgress(l: Listener): () => void {
  listeners.add(l);
  l(current);
  return () => listeners.delete(l);
}
