// 9-patch 소스 만들기: 가이드 사이의 늘어나는 영역을 제거해 최소 9-patch 소스를 만든다 (CAT patchMaker.js 대응)
import { executeWithHistoryGrouping } from "../lib/lib";
import { requireDoc, trimTransparent } from "../lib/lib_doc";
import { getLayerTree, getActiveLayer, selectByLayerID, renameLayer, deleteLayer, moveLayerOffset, cutRegion, mergeVisible } from "../lib/lib_layer";
import { getGuides, clearAllGuides } from "../lib/lib_guide";

type PatchType = "vertical" | "horizontal" | "all" | "v_sym" | "h_sym" | "all_sym" | "mixed_v2h1" | "mixed_v1h2";

interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

// 패치 타입 분석
function analyzePatchType(vCount: number, hCount: number): PatchType {
  if (vCount === 2 && hCount === 2) return "all";
  if (vCount === 2 && hCount === 0) return "vertical";
  if (vCount === 0 && hCount === 2) return "horizontal";
  if (vCount === 1 && hCount === 0) return "v_sym";
  if (vCount === 0 && hCount === 1) return "h_sym";
  if (vCount === 1 && hCount === 1) return "all_sym";
  if (vCount === 2 && hCount === 1) return "mixed_v2h1";
  if (vCount === 1 && hCount === 2) return "mixed_v1h2";
  throw new Error(`유효하지 않은 가이드 구성입니다. 현재 가이드: 수직 ${vCount}개, 수평 ${hCount}개`);
}

// 대칭 가이드 계산
function calculateSymmetricGuides(guide: number, size: number): [number, number] {
  const center = size / 2;
  return guide < center ? [guide, size - guide] : [size - guide, guide];
}

/** 이름이 "Source"인 최상위 레이어 ID */
async function sourceId(): Promise<number> {
  const l = (await getLayerTree()).find((x) => x.name === "Source");
  if (!l) throw new Error("Source 레이어를 찾을 수 없습니다.");
  return l.id;
}

// Source 레이어에서 영역을 잘라 새 레이어로 만든다
async function createSelectionAndCut(top: number, left: number, bottom: number, right: number, layerName: string): Promise<number> {
  await selectByLayerID(await sourceId());
  const id = await cutRegion(top, left, bottom, right, layerName);
  if (id === null) throw new Error(`Failed to process ${layerName}`);
  return id;
}

// 병합 → 트림 → "Source"로 이름 변경
async function mergeTrimRename() {
  const merged = await mergeVisible();
  await trimTransparent();
  const id = merged ?? (await getActiveLayer())?.id;
  if (id !== undefined && id !== null) await renameLayer(id, "Source");
}

// 수직 패치
async function applyVerticalPatch(v1: number, v2: number, b: Rect) {
  await createSelectionAndCut(b.top, b.left, b.bottom, v1, "left");
  const right = await createSelectionAndCut(b.top, v2, b.bottom, b.right, "right");
  await deleteLayer(await sourceId());
  await moveLayerOffset(right, -(v2 - v1), 0);
  await mergeTrimRename();
}

// 수평 패치
async function applyHorizontalPatch(h1: number, h2: number, b: Rect) {
  await createSelectionAndCut(b.top, b.left, h1, b.right, "top");
  const bottom = await createSelectionAndCut(h2, b.left, b.bottom, b.right, "bottom");
  await deleteLayer(await sourceId());
  await moveLayerOffset(bottom, 0, -(h2 - h1));
  await mergeTrimRename();
}

// 최상위 레이어 bounds
async function topLayerRect(): Promise<Rect> {
  const top = (await getLayerTree())[0];
  if (!top?.bounds) throw new Error("레이어 영역을 읽을 수 없습니다.");
  const [x, y, w, h] = top.bounds;
  return { top: y, left: x, bottom: y + h, right: x + w };
}

// 수직 + 수평 패치
async function applyAllPatch(v1: number, v2: number, h1: number, h2: number, b: Rect) {
  await applyVerticalPatch(v1, v2, b);
  await applyHorizontalPatch(h1, h2, await topLayerRect());
}

/** 가이드 기준 9-patch 소스 생성 */
export async function patchMaker(): Promise<void> {
  await requireDoc();
  if ((await getGuides()).length === 0) {
    throw new Error("가이드가 없습니다. 패치 메이커를 실행하기 전에 가이드를 추가해주세요.");
  }

  // 초기 설정: 최상위 레이어 → "Source" 이름 변경 → 문서 트림 (히스토리 그룹 외부)
  const first = (await getLayerTree())[0];
  if (!first) throw new Error("레이어가 없습니다.");
  await selectByLayerID(first.id);
  await renameLayer(first.id, "Source");
  await trimTransparent();

  const bounds = await topLayerRect();
  // 트림 후 가이드 좌표 (트림으로 가이드도 함께 이동한다)
  const guides = await getGuides();
  const vg = guides.filter((g) => g.orientation === "vertical").map((g) => Math.trunc(g.position)).sort((a, b) => a - b);
  const hg = guides.filter((g) => g.orientation === "horizontal").map((g) => Math.trunc(g.position)).sort((a, b) => a - b);
  const type = analyzePatchType(vg.length, hg.length);
  const w = bounds.right - bounds.left;
  const h = bounds.bottom - bounds.top;

  // 모든 패치 작업을 하나의 히스토리로 그룹핑
  await executeWithHistoryGrouping(async () => {
    switch (type) {
      case "all":
        await applyAllPatch(vg[0], vg[1], hg[0], hg[1], bounds);
        break;
      case "vertical":
        await applyVerticalPatch(vg[0], vg[1], bounds);
        break;
      case "horizontal":
        await applyHorizontalPatch(hg[0], hg[1], bounds);
        break;
      case "v_sym": {
        const [v1, v2] = calculateSymmetricGuides(vg[0], w);
        await applyVerticalPatch(v1, v2, bounds);
        break;
      }
      case "h_sym": {
        const [h1, h2] = calculateSymmetricGuides(hg[0], h);
        await applyHorizontalPatch(h1, h2, bounds);
        break;
      }
      case "all_sym": {
        const [v1, v2] = calculateSymmetricGuides(vg[0], w);
        const [h1, h2] = calculateSymmetricGuides(hg[0], h);
        await applyAllPatch(v1, v2, h1, h2, bounds);
        break;
      }
      case "mixed_v2h1": {
        const [h1, h2] = calculateSymmetricGuides(hg[0], h);
        await applyAllPatch(vg[0], vg[1], h1, h2, bounds);
        break;
      }
      case "mixed_v1h2": {
        const [v1, v2] = calculateSymmetricGuides(vg[0], w);
        await applyAllPatch(v1, v2, hg[0], hg[1], bounds);
        break;
      }
    }
    // 가이드 제거
    await clearAllGuides();
  });
}
