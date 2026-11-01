// Clear hidden effects 검증: 꺼진 효과만 삭제, 켜진 효과 유지, 선택 없음 알림
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving } from "../../src/lib/lib_doc";
import { newLayer, getLayerDetail, selectLayers, selectNoLayers } from "../../src/lib/lib_layer";
import { clearHiddenEffects } from "../../src/features/clearHiddenEffects";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
await createDoc("fx", 60, 60);
const a = await newLayer("A");
await exec("layer.layerStyle.dropShadow", {});
await exec("layer.layerStyle.stroke", { add: true });
await exec("layer.layerStyle.colorOverlay", { color: "#ff0000", add: true });
await exec("layer.setEffectsVisible", { layer: a, index: 0, visible: false });
await exec("layer.setEffectsVisible", { layer: a, index: 2, visible: false });
const b = await newLayer("B");
await exec("layer.layerStyle.stroke", {});
const kinds = async (id: number) => ((await getLayerDetail(id))?.effects?.items ?? []).map((i: any) => `${i.kind}:${i.enabled}`).join(",");
console.log("before", await kinds(a), "|", await kinds(b));
await selectLayers([a, b]);
const n = await clearHiddenEffects();
console.log("after", await kinds(a), "|", await kinds(b));
assert(n === 1, "정리된 레이어 1개");
assert((await kinds(a)) === "Stroke:true", "A: 켜진 Stroke만 남음");
assert((await kinds(b)) === "Stroke:true", "B: 그대로");
await selectNoLayers();
(globalThis as any).__JP_LOG__.length = 0;
await clearHiddenEffects();
assert((globalThis as any).__JP_LOG__[0] === "선택된 레이어가 없습니다.", "선택 없음 알림");
await docCloseWithoutSaving();
console.log("CLEAR FX OK");
