// Sort all / Sort selected (CAT sortingLayer.js 대응): 레이어를 이름순(A→Z, 위→아래)으로 정렬, 그룹은 일반 레이어 위에 모은다
import { executeWithHistoryGrouping } from "../lib/lib";
import { getLayerTree, getAllLayers, moveLayerTo, isGroup, walkLayers } from "../lib/lib_layer";
import { isBackgroundLayer } from "./splitToLayers";
import type { PcLayer } from "../lib/types";

/** 목록 정렬: 일반 레이어 A→Z 블록, 그 위에 그룹 A→Z, 그룹 내부는 재귀 */
async function sortLayers(list: PcLayer[], all: PcLayer[]) {
  const layerBuffer = list.filter((l) => !isGroup(l) && !isBackgroundLayer(l, all));
  // 빈 그룹은 무시
  const groupBuffer = list.filter((l) => isGroup(l) && (l.children?.length ?? 0) > 0);
  const byName = (a: PcLayer, b: PcLayer) => a.name.localeCompare(b.name);
  layerBuffer.sort(byName);
  groupBuffer.sort(byName);

  // 각 레이어를 마지막 레이어 바로 위로 → 위에서부터 A→Z 연속 블록
  if (layerBuffer.length) {
    const last = layerBuffer[layerBuffer.length - 1];
    for (const l of layerBuffer) if (l.id !== last.id) await moveLayerTo([l.id], last.id, "above");
  }
  // 그룹을 첫 레이어 바로 위로 → 그룹 A→Z가 일반 레이어 위에 쌓임 (일반 레이어가 없으면 마지막 그룹 기준)
  const anchor = layerBuffer[0] ?? groupBuffer[groupBuffer.length - 1];
  if (anchor) for (const g of groupBuffer) if (g.id !== anchor.id) await moveLayerTo([g.id], anchor.id, "above");

  for (const g of groupBuffer) await sortLayers(g.children ?? [], all);
}

/** 문서 최상위 레이어 전체 정렬 */
export async function sortAllLayers(): Promise<void> {
  const tree = await getLayerTree();
  const all = await getAllLayers();
  await executeWithHistoryGrouping(() => sortLayers(tree, all));
}

/** 선택 레이어만 정렬 */
export async function sortSelectedLayers(): Promise<void> {
  const tree = await getLayerTree();
  const all = await getAllLayers();
  const selected: PcLayer[] = [];
  walkLayers(tree, (l) => {
    if (l.selected) selected.push(l);
  });
  if (!selected.length) throw new Error("선택된 레이어가 없습니다.");
  await executeWithHistoryGrouping(() => sortLayers(selected, all));
}
