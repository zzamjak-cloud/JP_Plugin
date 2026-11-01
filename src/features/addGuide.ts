// 가이드: 그리드 가이드(+번호), 가이드 제거, 복사/붙여넣기, 가장자리 오프셋 가이드 (CAT addGuide.js 대응)
import { executeWithHistoryGrouping } from "../lib/lib";
import { requireDoc } from "../lib/lib_doc";
import { getSelectedLayers, deleteLayerByName } from "../lib/lib_layer";
import { putPixelsAsLayer, type RGBAImage } from "../lib/lib_pixels";
import { makeGuide, clearAllGuides, getGuides, type Guide } from "../lib/lib_guide";

// 0~9 숫자 5x7 비트맵 글리프 (텍스트 레이어 없이 픽셀로 직접 렌더링하기 위한 폰트)
const DIGIT_GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

/** 셀 번호(0..rows*cols-1, 행 우선)를 문서 크기 RGBA 버퍼에 검정 불투명 픽셀로 렌더링 */
export function renderGridNumbers(docW: number, docH: number, rows: number, cols: number): RGBAImage {
  const sectionWidth = docW / cols;
  const sectionHeight = docH / rows;
  let fontH = 18;
  if (rows < 10) fontH = 30;
  else if (rows > 30) fontH = 14;

  const maxChars = String(rows * cols - 1).length;
  let scale = Math.max(1, Math.round(fontH / 7));
  // 셀 안에 여유 있게 들어가도록 클램프 (글리프 폭 5 + 자간 1)
  while (scale > 1 && (maxChars * 6 - 1) * scale > sectionWidth * 0.9) scale--;
  while (scale > 1 && 7 * scale > sectionHeight * 0.9) scale--;

  const data = new Uint8Array(docW * docH * 4); // RGB=0(검정), 알파만 기록
  let number = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const text = String(number);
      const textW = (text.length * 6 - 1) * scale;
      let penX = Math.round((col + 0.5) * sectionWidth - textW / 2);
      const penY = Math.round((row + 0.5) * sectionHeight - (7 * scale) / 2);
      for (const ch of text) {
        const glyph = DIGIT_GLYPHS[ch];
        for (let gy = 0; gy < 7; gy++) {
          for (let gx = 0; gx < 5; gx++) {
            if (glyph[gy][gx] !== "1") continue;
            for (let sy = 0; sy < scale; sy++) {
              const py = penY + gy * scale + sy;
              if (py < 0 || py >= docH) continue;
              for (let sx = 0; sx < scale; sx++) {
                const px = penX + gx * scale + sx;
                if (px < 0 || px >= docW) continue;
                data[(py * docW + px) * 4 + 3] = 255;
              }
            }
          }
        }
        penX += 6 * scale;
      }
      number++;
    }
  }
  return { width: docW, height: docH, data };
}

/** rows x cols 그리드 가이드 추가 (withNumbers: 셀 번호 'Num' 픽셀 레이어 포함) */
export async function addAllGuides(withNumbers: boolean, rows: number, cols: number): Promise<void> {
  const doc = await requireDoc();
  await executeWithHistoryGrouping(async () => {
    // 수평 가이드 (행)
    const sectionHeight = doc.height / rows;
    for (let i = 1; i < rows; i++) await makeGuide(sectionHeight * i, "horizontal");
    // 수직 가이드 (열)
    const sectionWidth = doc.width / cols;
    for (let i = 1; i < cols; i++) await makeGuide(sectionWidth * i, "vertical");

    if (withNumbers) {
      const img = renderGridNumbers(Math.round(doc.width), Math.round(doc.height), rows, cols);
      await putPixelsAsLayer(img, "Num", 0, 0);
    }
  });
}

export type EdgeDirection = "top" | "bottom" | "left" | "right";

/** 가장자리 기준 오프셋 가이드 (useLayerBound: 선택 레이어 bounds 기준, 아니면 문서 기준) */
export async function addGuideFromEdge(direction: EdgeDirection, value: number, useLayerBound: boolean): Promise<void> {
  const doc = await requireDoc();
  let refTop = 0;
  let refLeft = 0;
  let refBottom = doc.height;
  let refRight = doc.width;
  if (useLayerBound) {
    const selected = await getSelectedLayers();
    // CAT과 동일: 선택 레이어가 없으면 아무 것도 하지 않음
    if (selected.length === 0 || !selected[0].bounds) return;
    const [x, y, w, h] = selected[0].bounds;
    refTop = y;
    refLeft = x;
    refBottom = y + h;
    refRight = x + w;
  }
  switch (direction) {
    case "top":
      await makeGuide(refTop + value, "horizontal");
      break;
    case "bottom":
      await makeGuide(refBottom - value, "horizontal");
      break;
    case "left":
      await makeGuide(refLeft + value, "vertical");
      break;
    case "right":
      await makeGuide(refRight - value, "vertical");
      break;
  }
}

/** 'Num' 레이어와 모든 가이드 제거 */
export async function clearGuides(): Promise<void> {
  await requireDoc();
  await executeWithHistoryGrouping(async () => {
    await deleteLayerByName("Num");
    await clearAllGuides();
  });
}

// 복사된 가이드 (세션 동안 메모리에 유지 — 문서 간 복사용)
let copiedGuides: Guide[] = [];

/** 현재 문서의 가이드 목록 (정수 좌표) */
async function getCurrentGuides(): Promise<Guide[]> {
  return (await getGuides()).map((g) => ({ position: Math.trunc(g.position), orientation: g.orientation }));
}

/** 현재 문서의 모든 가이드 복사 → 복사한 개수 */
export async function copyGuides(): Promise<number> {
  await requireDoc();
  copiedGuides = [...(await getCurrentGuides())];
  return copiedGuides.length;
}

/** 복사된 가이드를 현재 문서에 붙여넣기 (같은 위치·방향 가이드는 건너뜀) → 추가한 개수 */
export async function pasteGuides(): Promise<number> {
  if (copiedGuides.length === 0) return 0;
  await requireDoc();
  const existing = await getCurrentGuides();
  const newGuides = copiedGuides.filter((c) => !existing.some((e) => e.position === c.position && e.orientation === c.orientation));
  if (newGuides.length === 0) return 0;
  await executeWithHistoryGrouping(async () => {
    for (const g of newGuides) await makeGuide(g.position, g.orientation);
  });
  return newGuides.length;
}
