// Clear empty layers 검증: 빈 픽셀 레이어·빈 그룹(중첩 포함) 삭제, 텍스트/내용 있는 레이어 유지, 배경 유지, 알림
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving } from "../../src/lib/lib_doc";
import { newLayer, newGroup, getAllLayers, moveLayerTo, selectByLayerID } from "../../src/lib/lib_layer";
import { clearEmptyLayers } from "../../src/features/clearEmptyLayers";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
const log = (globalThis as any).__JP_LOG__ as string[];
await createDoc("empty", 80, 80, 72, "rgb", "white");
await newLayer("empty1");
const full = await newLayer("full");
await exec("select.rect", { x: 1, y: 1, width: 5, height: 5 });
await exec("edit.fill", { contents: "color", color: "#000000" });
await exec("select.deselect");
// G_empty: 빈 레이어 + 빈 하위 그룹 → 그룹째 삭제
const ge = await newGroup("G_empty");
const e2 = await newLayer("empty2");
const sub = await newGroup("G_sub");
await moveLayerTo([e2], ge, "into");
await moveLayerTo([sub], ge, "into");
// G_text: 텍스트만 → 유지 (CAT 버그 수정)
await selectByLayerID(full);
const gt = await newGroup("G_text");
const t = (await exec<any>("type.create", { text: "hi", x: 10, y: 30 })).layer;
await moveLayerTo([t], gt, "into");
// G_mix: 내용 + 빈 레이어 → 빈 레이어만 삭제
await selectByLayerID(full);
const gm = await newGroup("G_mix");
const e3 = await newLayer("empty3");
await moveLayerTo([e3], gm, "into");
await exec("layer.duplicate", { layer: full, name: "full_copy" });
const fc = (await getAllLayers()).find((l) => l.name === "full_copy")!.id;
await moveLayerTo([fc], gm, "into");

await clearEmptyLayers();
const names = (await getAllLayers()).map((l) => l.name).sort().join(",");
console.log(names);
assert(names === ["Background", "G_mix", "G_text", "full", "full_copy", "hi"].sort().join(","), `남은 레이어: ${names}`);
log.length = 0;
await clearEmptyLayers();
assert(log[0] === "삭제할 빈 레이어가 없습니다.", "삭제할 것 없음 알림");
await docCloseWithoutSaving();

await createDoc("one", 10, 10);
log.length = 0;
await clearEmptyLayers();
assert(log[0] === "문서에 최소 2개 이상의 레이어가 필요합니다.", "레이어 1개 알림");
await docCloseWithoutSaving();
console.log("CLEAR EMPTY OK");
