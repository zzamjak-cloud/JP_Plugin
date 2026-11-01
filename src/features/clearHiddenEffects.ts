// Clear hidden effects (CAT clearHiddenEffects.js 대응): 선택 레이어에서 꺼진(숨김) 레이어 효과만 삭제
import { executeWithHistoryGrouping, showAlert } from "../lib/lib";
import { getSelectedLayers, getLayerDetail, removeLayerEffect, selectNoLayers } from "../lib/lib_layer";

/** 숨김 효과 인덱스 (document.inspect effects.items 순서) */
export function hiddenEffectIndices(detail: any): number[] {
  const items: any[] = detail?.effects?.items ?? [];
  return items.flatMap((it, i) => (it && it.enabled === false ? [i] : []));
}

/** → 효과를 정리한 레이어 수 */
export async function clearHiddenEffects(): Promise<number> {
  const layers = await getSelectedLayers();
  if (!layers.length) {
    await showAlert("선택된 레이어가 없습니다.");
    return 0;
  }
  let cleaned = 0;
  await executeWithHistoryGrouping(async () => {
    for (const l of layers) {
      const hidden = hiddenEffectIndices(await getLayerDetail(l.id));
      // 뒤에서부터 지워야 앞쪽 인덱스가 유지된다
      for (const i of hidden.reverse()) await removeLayerEffect(l.id, i);
      if (hidden.length) cleaned++;
    }
    await selectNoLayers().catch(() => {});
  });
  return cleaned;
}
