// Arrange in grid (CAT applyGridLayout.js 대응): 선택 레이어를 이름순으로 셀 크기·열 수에 맞춰 격자 배치
import { executeWithHistoryGrouping, showAlert } from "../lib/lib";
import { getSelectedLayers, moveLayerOffset } from "../lib/lib_layer";
import { getArrayGridSize, getArrayColumns } from "./sizePresets";

export async function applyGridLayout(): Promise<void> {
  const layers = await getSelectedLayers();
  if (!layers.length) {
    await showAlert("Please select layers to arrange in grid layout.");
    return;
  }
  const { width: cellW, height: cellH } = getArrayGridSize();
  const cols = Math.max(1, getArrayColumns());
  layers.sort((a, b) => a.name.localeCompare(b.name));
  try {
    await executeWithHistoryGrouping(async () => {
      for (let i = 0; i < layers.length; i++) {
        const b = layers[i].bounds;
        if (!b) continue;
        const row = Math.floor(i / cols);
        const col = i % cols;
        // 셀 중심(문서 원점 기준)에 레이어 중심을 맞춘다. PhotoCraft 이동은 정수 픽셀
        const tx = col * cellW + cellW / 2;
        const ty = row * cellH + cellH / 2;
        const dx = Math.round(tx - (b[0] + b[2] / 2));
        const dy = Math.round(ty - (b[1] + b[3] / 2));
        if (dx || dy) await moveLayerOffset(layers[i].id, dx, dy);
      }
    });
  } catch (e) {
    await showAlert(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
