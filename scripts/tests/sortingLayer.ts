// Sort all / Sort selected 검증: 일반 레이어 A→Z(위→아래), 그룹 A→Z는 그 위, 그룹 내부 재귀 정렬
import { createDoc, docCloseWithoutSaving } from "../../src/lib/lib_doc";
import { newLayer, newGroup, getLayerTree, getAllLayers, selectByLayerID, selectLayers, moveLayerTo } from "../../src/lib/lib_layer";
import { sortAllLayers, sortSelectedLayers } from "../../src/features/sortingLayer";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
const names = (ls: { name: string }[]) => ls.map((l) => l.name).join(",");

await createDoc("sort", 50, 50, 72, "rgb", "white");
for (const n of ["c", "a", "b"]) await newLayer(n);
const g2 = await newGroup("G2");
const inner = [await newLayer("z"), await newLayer("x"), await newLayer("y")];
await moveLayerTo(inner, g2, "into");
await selectByLayerID((await getAllLayers()).find((l) => l.name === "a")!.id);
await newGroup("G1");
await newLayer("only");

await sortAllLayers();
let tree = await getLayerTree();
console.log("all:", names(tree), "| G2:", names(tree.find((l) => l.name === "G2")?.children ?? []));
assert(names(tree) === "G1,G2,a,b,c,Background", `최상위 순서: ${names(tree)}`);
assert(names(tree.find((l) => l.name === "G2")!.children!) === "x,y,z", "G2 내부 순서");

// 선택 정렬: b, c만 역순으로 바꾼 뒤 선택 정렬
const all = await getAllLayers();
const id = (n: string) => all.find((l) => l.name === n)!.id;
await moveLayerTo([id("c")], id("a"), "above");
await selectLayers([id("b"), id("c")]);
await sortSelectedLayers();
tree = await getLayerTree();
console.log("selected:", names(tree));
assert(names(tree) === "G1,G2,b,c,a,Background", `선택 정렬 순서: ${names(tree)}`);
await docCloseWithoutSaving();
console.log("SORT OK");
