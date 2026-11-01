// Clear empty layers (CAT clearEmptyLayers.js 대응): 비어 있는 픽셀 레이어와 빈 그룹을 삭제
import { executeWithHistoryGrouping, showAlert } from "../lib/lib";
import { getDocInfo } from "../lib/lib_doc";
import { getLayerTree, getAllLayers, deleteLayer, isGroup } from "../lib/lib_layer";
import { isBackgroundLayer } from "./splitToLayers";
import type { PcLayer } from "../lib/types";

const isEmptyPixel = (l: PcLayer) => l.kind === "Pixel" && (!l.bounds || l.bounds[2] === 0 || l.bounds[3] === 0);

/**
 * 그룹 내부의 빈 레이어·빈 하위 그룹을 삭제 목록에 넣고, 그룹 자체가 비었는지 반환.
 * 픽셀 레이어 외 종류(텍스트·스마트 오브젝트·셰이프·조정 등)는 유효한 콘텐츠로 본다.
 */
function collectGroup(group: PcLayer, out: number[], all: PcLayer[]): boolean {
  const children = group.children ?? [];
  let hasContent = false;
  for (const l of children) {
    if (isGroup(l)) {
      if (collectGroup(l, out, all)) out.push(l.id);
      else hasContent = true;
    } else if (isEmptyPixel(l) && !isBackgroundLayer(l, all)) {
      out.push(l.id);
    } else {
      hasContent = true;
    }
  }
  return !hasContent;
}

/** 삭제 대상 수집 → { layers, groups } ID 목록 (그룹 안 항목이 그룹보다 먼저) */
export function collectEmptyLayers(tree: PcLayer[], all: PcLayer[]): { layers: number[]; groups: number[] } {
  const ids: number[] = [];
  const groups = new Set<number>();
  for (const l of tree) {
    if (isGroup(l)) {
      const inner: number[] = [];
      const empty = collectGroup(l, inner, all);
      ids.push(...inner);
      if (empty) ids.push(l.id);
    } else if (isEmptyPixel(l) && !isBackgroundLayer(l, all)) {
      ids.push(l.id);
    }
  }
  const groupIds = new Set(all.filter(isGroup).map((l) => l.id));
  for (const id of ids) if (groupIds.has(id)) groups.add(id);
  return { layers: ids.filter((id) => !groups.has(id)), groups: [...groups] };
}

export async function clearEmptyLayers(): Promise<void> {
  if (!(await getDocInfo())) {
    await showAlert("문서가 열려있어야 합니다.");
    return;
  }
  const tree = await getLayerTree();
  if (tree.length <= 1) {
    await showAlert("문서에 최소 2개 이상의 레이어가 필요합니다.");
    return;
  }
  const all = await getAllLayers();
  const { layers, groups } = collectEmptyLayers(tree, all);
  if (!layers.length && !groups.length) {
    await showAlert("삭제할 빈 레이어가 없습니다.");
    return;
  }
  try {
    await executeWithHistoryGrouping(async () => {
      // 레이어를 먼저 지운 뒤 그룹을 지운다 (그룹 삭제 시 하위 ID가 사라지므로)
      for (const id of [...layers, ...groups]) await deleteLayer(id).catch(() => {});
    });
  } catch (e) {
    await showAlert(`레이어 삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}
