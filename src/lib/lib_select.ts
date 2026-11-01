// 선택 영역 조작 (CAT lib_select.js 대응)
import { exec } from "../core/bridge";
import { getDocInfo } from "./lib_doc";

/** 선택 해제 */
export const deselectAll = () => exec("select.deselect", {});

/** 사각형 선택 (UXP setBoundsRegion('rectangle', {x,y,width,height}) 대응) */
export function selectRect(x: number, y: number, width: number, height: number) {
  return exec("select.rect", { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
}

/** 사각형 선택 (t, l, b, r) (UXP rectangularMarqueeTool 대응) */
export const rectangularMarquee = (top: number, left: number, bottom: number, right: number) => selectRect(left, top, right - left, bottom - top);

/** 현재 선택 영역 bounds (반올림, 없으면 null) (UXP getSelectionBounds 대응) */
export async function getSelectionBounds(): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
  const d = await getDocInfo();
  if (!d || !d.hasSelection || !d.selectionBounds) return null;
  const [x, y, w, h] = d.selectionBounds;
  return { left: Math.round(x), top: Math.round(y), right: Math.round(x + w), bottom: Math.round(y + h) };
}
