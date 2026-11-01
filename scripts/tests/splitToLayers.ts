// Split to layers 검증: 2px 간격 조각은 병합, 먼 조각은 분리, 4px 조각은 무시, 원본 숨김, 이름 _NN
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving } from "../../src/lib/lib_doc";
import { getAllLayers, renameLayer } from "../../src/lib/lib_layer";
import { splitToLayers } from "../../src/features/splitToLayers";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
await createDoc("split", 160, 100);
const base = (await getAllLayers()).find((l) => l.active)!;
await renameLayer(base.id, "icon");
const fill = async (x: number, y: number, w: number, h: number, c: string) => {
  await exec("select.rect", { x, y, width: w, height: h });
  await exec("edit.fill", { contents: "color", color: c });
};
await fill(100, 10, 30, 20, "#ff0000"); // 위쪽 오른편 → 01
await fill(10, 50, 20, 20, "#00ff00"); // 아래 왼쪽 A
await fill(32, 50, 10, 20, "#0000ff"); // A와 2px 간격 → 병합 → 02 (minY 50)
await fill(140, 90, 2, 2, "#ffffff"); // 4px → 무시
await exec("select.deselect");
const ids = await splitToLayers();
const ls = await getAllLayers();
console.log(ls.map((l) => `${l.id}:${l.name}:${l.visible}:${JSON.stringify(l.bounds)}`).join(" | "));
assert(ids.length === 2, `2개 영역 기대, 실제 ${ids.length}`);
const a = ls.find((l) => l.name === "icon_01");
const b = ls.find((l) => l.name === "icon_02");
assert(a && JSON.stringify(a.bounds) === "[100,10,30,20]", "icon_01 bounds");
assert(b && JSON.stringify(b.bounds) === "[10,50,32,20]", "icon_02 bounds");
assert(ls.find((l) => l.id === base.id)?.visible === false, "원본 숨김");
await docCloseWithoutSaving();
console.log("SPLIT OK");
