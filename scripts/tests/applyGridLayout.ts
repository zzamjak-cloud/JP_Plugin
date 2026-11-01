// Arrange in grid 검증: 이름순, 셀 중심 = (col*W+W/2, row*H+H/2), 선택 없으면 알림
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving } from "../../src/lib/lib_doc";
import { newLayer, getAllLayers, selectLayers, selectNoLayers } from "../../src/lib/lib_layer";
import { selectSize, SIZE_PRESETS } from "../../src/features/sizePresets";
import { applyGridLayout } from "../../src/features/applyGridLayout";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
await createDoc("grid", 300, 300);
const ids: number[] = [];
for (const [n, x, y, w, h] of [["c", 200, 200, 20, 10], ["a", 5, 5, 10, 10], ["b", 100, 30, 30, 30]] as const) {
  ids.push(await newLayer(n));
  await exec("select.rect", { x, y, width: w, height: h });
  await exec("edit.fill", { contents: "color", color: "#336699" });
}
await exec("select.deselect");
selectSize(SIZE_PRESETS.arrayGridSize, { width: 100, height: 50 });
selectSize(SIZE_PRESETS.arrayColumns, { width: 2, height: 2 });
await selectLayers(ids);
await applyGridLayout();
const ls = await getAllLayers();
const b = (n: string) => JSON.stringify(ls.find((l) => l.name === n)!.bounds);
console.log(b("a"), b("b"), b("c"));
assert(b("a") === "[45,20,10,10]", "a → 셀(0,0) 중심 50,25");
assert(b("b") === "[135,10,30,30]", "b → 셀(1,0) 중심 150,25");
assert(b("c") === "[40,70,20,10]", "c → 셀(0,1) 중심 50,75");

await selectNoLayers();
(globalThis as any).__JP_LOG__.length = 0;
await applyGridLayout();
assert((globalThis as any).__JP_LOG__[0] === "Please select layers to arrange in grid layout.", "선택 없음 알림");
await docCloseWithoutSaving();
console.log("GRID OK");
