// Split to layers (CAT SplitToLayers.js 대응): 선택 레이어를 알파 기준 연결 요소별로 개별 레이어로 분할
import { executeWithHistoryGrouping } from "../lib/lib";
import { getAllLayers, selectByLayerID, rasterizeLayer, applyLayerMask, renameLayer, setVisible } from "../lib/lib_layer";
import { getLayerPixels, putPixelsAsLayer, type RGBAImage } from "../lib/lib_pixels";
import type { PcLayer } from "../lib/types";
import { setProgress, clearProgress } from "../ui/progress";

const CONFIG = {
  suffix: "_",
  /** 이 값 미만의 알파는 배경으로 간주 (AA 찌꺼기로 인한 과분할 방지) */
  alphaThreshold: 8,
  /** 이 거리(px) 이내로 떨어진 조각은 같은 이미지로 병합 */
  mergeGap: 3,
  /** 이 픽셀 수 미만의 고립 조각은 무시 */
  minRegionPixels: 8,
};

export interface SplitRegion {
  labelId: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

/** 배경 레이어 판정: PhotoCraft에는 플래그가 없어 최하단 최상위 "Background" 픽셀 레이어로 판단 */
export function isBackgroundLayer(layer: PcLayer, all: PcLayer[]): boolean {
  const top = all.filter((l) => (l.depth ?? 0) === 0);
  return layer.name === "Background" && layer.kind === "Pixel" && top[top.length - 1]?.id === layer.id;
}

/** 분리 정사각 팽창 (가로 → 세로) */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let k = x0; k <= x1; k++) tmp[row + k] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!tmp[y * w + x]) continue;
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let k = y0; k <= y1; k++) out[k * w + x] = 1;
    }
  }
  return out;
}

/**
 * 연결 요소 라벨링: 팽창 마스크에서 8-연결 라벨을 매기고, 영역 통계(bbox·픽셀 수)는 원본 픽셀로만 계산.
 * 반환 영역은 읽기 순서(minY → minX)로 정렬된다.
 */
export function labelRegions(img: RGBAImage, cfg = CONFIG): { labels: Int32Array; regions: SplitRegion[] } {
  const { width: w, height: h, data } = img;
  const orig = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) orig[i] = data[i * 4 + 3] >= cfg.alphaThreshold ? 1 : 0;
  const mask = dilate(orig, w, h, cfg.mergeGap);
  const labels = new Int32Array(w * h);
  const stats: SplitRegion[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = ++next;
    const reg: SplitRegion = { labelId: id, minX: w, minY: h, maxX: -1, maxY: -1, count: 0 };
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w, py = (p - px) / w;
      if (orig[p]) {
        reg.count++;
        if (px < reg.minX) reg.minX = px;
        if (px > reg.maxX) reg.maxX = px;
        if (py < reg.minY) reg.minY = py;
        if (py > reg.maxY) reg.maxY = py;
      }
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = id;
            stack.push(q);
          }
        }
      }
    }
    stats.push(reg);
  }
  const regions = stats.filter((r) => r.count >= cfg.minRegionPixels && r.maxX >= 0);
  regions.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  return { labels, regions };
}

/** 영역 bbox 크기의 RGBA 버퍼에 같은 라벨 픽셀만 복사 */
function extractRegion(img: RGBAImage, labels: Int32Array, reg: SplitRegion): RGBAImage {
  const rw = reg.maxX - reg.minX + 1;
  const rh = reg.maxY - reg.minY + 1;
  const out = new Uint8Array(rw * rh * 4);
  for (let y = reg.minY; y <= reg.maxY; y++) {
    for (let x = reg.minX; x <= reg.maxX; x++) {
      const idx = y * img.width + x;
      if (labels[idx] !== reg.labelId) continue;
      out.set(img.data.subarray(idx * 4, idx * 4 + 4), ((y - reg.minY) * rw + (x - reg.minX)) * 4);
    }
  }
  return { width: rw, height: rh, data: out };
}

const layerName = (base: string, n: number) => `${base}${CONFIG.suffix}${String(n).padStart(2, "0")}`;

/** 선택 레이어(활성 레이어)를 연결 요소별 레이어로 분할하고 원본은 숨긴다 → 생성된 레이어 ID */
export async function splitToLayers(): Promise<number[]> {
  const all = await getAllLayers();
  const base = all.find((l) => l.active) ?? all.find((l) => l.selected);
  if (!base) throw new Error("레이어를 선택해주세요.");
  if (base.kind === "Group" || isBackgroundLayer(base, all)) throw new Error("지원되는 레이어 타입이 아닙니다.");

  const created: number[] = [];
  try {
    await executeWithHistoryGrouping(async () => {
      await selectByLayerID(base.id);
      // 래스터화(실패 무시) → 마스크 적용 후 제거
      await rasterizeLayer(base.id).catch(() => {});
      await applyLayerMask(base.id);
      // 숨김 레이어는 합성 결과에 픽셀이 나오지 않으므로 잠시 표시
      if (!base.visible) await setVisible(base.id, true);

      setProgress("레이어 분할: 픽셀 분석", 0);
      const img = await getLayerPixels(base.id);
      const { labels, regions } = labelRegions(img);
      if (!regions.length) throw new Error("분할할 영역을 찾을 수 없습니다.");

      await selectByLayerID(base.id);
      for (let i = 0; i < regions.length; i++) {
        setProgress(`레이어 분할 ${i + 1}/${regions.length}`, ((i + 1) / regions.length) * 100);
        const reg = regions[i];
        const name = layerName(base.name, i + 1);
        const id = await putPixelsAsLayer(extractRegion(img, labels, reg), name, reg.minX, reg.minY);
        await renameLayer(id, name);
        created.push(id);
      }
      await setVisible(base.id, false);
    });
  } finally {
    clearProgress();
  }
  return created;
}
