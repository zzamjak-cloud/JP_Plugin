// Animation match layers (CAT animationMatchLayers.js 대응).
// Photoshop은 프레임 애니메이션의 프레임마다 레이어 위치를 따로 저장하므로, 각 프레임의 보이는 레이어를 골라
// "Match Layer Across Frames(위치)"로 모든 프레임 위치를 통일한다.
// PhotoCraft 타임라인은 레이어 위치를 프레임별로 저장하지 않아(문서 단일 위치) 위치는 항상 모든 프레임에서 일치한다.
// 따라서 프레임을 순회하며 각 프레임의 대상 레이어를 선택·확인하고, 위치 매칭 자체는 별도 조작 없이 충족된다.
import { showAlert } from "../lib/lib";
import { getTimelineInfo, setTimelineFrame } from "../lib/lib_doc";
import { getLayerTree, selectByLayerID, selectNoLayers } from "../lib/lib_layer";

/** → 처리한 프레임 수 */
export async function animationMatchLayers(): Promise<number> {
  try {
    const info = await getTimelineInfo();
    if (!info) throw new Error("타임라인이 없습니다.");
    const frames = Math.max(0, Math.round(info.duration));
    const original = info.current;
    let matched = 0;
    for (let f = 0; f < frames; f++) {
      try {
        await setTimelineFrame(f);
        await selectNoLayers().catch(() => {});
        // "Layer 1"을 제외한 첫 번째 보이는 최상위 레이어
        const target = (await getLayerTree()).find((l) => l.name !== "Layer 1" && l.visible);
        if (target) {
          await selectByLayerID(target.id);
          matched++;
        }
      } catch {
        // 오류 프레임은 건너뛴다
        continue;
      }
    }
    await setTimelineFrame(original).catch(() => {});
    return matched;
  } catch {
    await showAlert("애니메이션 레이어 매칭 중 오류가 발생했습니다.");
    return 0;
  }
}
