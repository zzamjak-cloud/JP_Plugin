// GUIDE 섹션 검증: 그리드 가이드(+번호), 제거, 복사/붙여넣기, 가장자리 오프셋, 9-patch
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving, getDocInfo, listDocuments } from "../../src/lib/lib_doc";
import { getLayerTree } from "../../src/lib/lib_layer";
import { getGuides } from "../../src/lib/lib_guide";
import { getLayerPixels, alphaBounds } from "../../src/lib/lib_pixels";
import { addAllGuides, addGuideFromEdge, clearGuides, copyGuides, pasteGuides } from "../../src/features/addGuide";
import { patchMaker } from "../../src/features/patchMaker";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}
const key = (gs: { position: number; orientation: string }[]) =>
  gs
    .map((g) => `${g.orientation[0]}${g.position}`)
    .sort()
    .join(",");

// 깨끗한 상태에서 시작
while ((await listDocuments()).documents.length) await docCloseWithoutSaving();

// 1) 그리드 가이드 (번호 없음)
await createDoc("g1", 200, 100, 72, "rgb", "white");
await addAllGuides(false, 2, 4);
const gs = await getGuides();
assert(key(gs) === "h50,v100,v150,v50", "grid guides " + key(gs));
assert(!(await getLayerTree()).some((l) => l.name === "Num"), "no Num layer");

// 2) 번호 포함
await exec("view.clearGuides", {});
await addAllGuides(true, 2, 2);
const tree = await getLayerTree();
const num = tree.find((l) => l.name === "Num");
assert(num, "Num layer exists");
const px = await getLayerPixels(num!.id);
const b = alphaBounds(px);
assert(b, "Num has pixels");
// 셀 0(좌상단) 중앙 근처에 픽셀이 있어야 함: (50,25)
const alphaAt = (x: number, y: number) => px.data[(y * px.width + x) * 4 + 3];
let found = 0;
for (let y = 10; y < 40; y++) for (let x = 35; x < 65; x++) if (alphaAt(x, y)) found++;
assert(found > 20, "digit 0 drawn in cell 0: " + found);
assert(key(await getGuides()) === "h50,v100", "guides 2x2");

// 3) 제거
await clearGuides();
assert(!(await getLayerTree()).some((l) => l.name === "Num"), "Num removed");
assert((await getGuides()).length === 0, "guides cleared");

// 4) 가장자리 오프셋 — 문서 기준
for (const d of ["top", "bottom", "left", "right"] as const) await addGuideFromEdge(d, 30, false);
assert(key(await getGuides()) === "h30,h70,v170,v30", "edge doc " + key(await getGuides()));
await exec("view.clearGuides", {});
// 레이어 기준
await exec("layer.new.layer", { name: "box" });
await exec("select.rect", { x: 20, y: 10, width: 60, height: 40 });
await exec("edit.fill", { contents: "color", color: "#ff0000" });
await exec("select.deselect", {});
for (const d of ["top", "bottom", "left", "right"] as const) await addGuideFromEdge(d, 5, true);
assert(key(await getGuides()) === "h15,h45,v25,v75", "edge layer " + key(await getGuides()));

// 5) 복사/붙여넣기
assert((await copyGuides()) === 4, "copied 4");
await createDoc("g2", 200, 100);
await exec("view.newGuide", { orientation: "horizontal", position: 15 });
assert((await pasteGuides()) === 3, "pasted 3 (1 duplicate skipped)");
assert(key(await getGuides()) === "h15,h45,v25,v75", "pasted guides");
await docCloseWithoutSaving();
await docCloseWithoutSaving();

// 6) 9-patch: 좌 빨강 30 / 중 파랑 40 / 우 초록 30, 세로 60
async function stripeDoc() {
  await createDoc("p", 100, 60);
  await exec("select.rect", { x: 0, y: 0, width: 30, height: 60 });
  await exec("edit.fill", { contents: "color", color: "#ff0000" });
  await exec("select.rect", { x: 30, y: 0, width: 40, height: 60 });
  await exec("edit.fill", { contents: "color", color: "#0000ff" });
  await exec("select.rect", { x: 70, y: 0, width: 30, height: 60 });
  await exec("edit.fill", { contents: "color", color: "#00ff00" });
  await exec("select.deselect", {});
}
await stripeDoc();
await exec("view.newGuide", { orientation: "vertical", position: 30 });
await exec("view.newGuide", { orientation: "vertical", position: 70 });
await exec("view.newGuide", { orientation: "horizontal", position: 20 });
await exec("view.newGuide", { orientation: "horizontal", position: 40 });
await patchMaker();
let info = await getDocInfo();
let ls = await getLayerTree();
assert(info!.width === 60 && info!.height === 40, `ALL size ${info!.width}x${info!.height}`);
assert(ls.length === 1 && ls[0].name === "Source", "single Source layer " + ls.map((l) => l.name));
assert((await getGuides()).length === 0, "guides cleared after patch");
let sp = await getLayerPixels(ls[0].id);
const rgb = (x: number, y: number) => Array.from(sp.data.slice((y * sp.width + x) * 4, (y * sp.width + x) * 4 + 3)).join(",");
assert(rgb(29, 5) === "255,0,0" && rgb(30, 5) === "0,255,0", `seam ${rgb(29, 5)} | ${rgb(30, 5)}`);
await docCloseWithoutSaving();

// 대칭(수직 1개): 30 → [30,70] → 폭 60
await stripeDoc();
await exec("view.newGuide", { orientation: "vertical", position: 30 });
await patchMaker();
info = await getDocInfo();
assert(info!.width === 60 && info!.height === 60, `v_sym size ${info!.width}x${info!.height}`);
await docCloseWithoutSaving();

// 대칭(수평 1개, 가이드가 중앙 아래): 45 → [15,45] → 높이 30
await stripeDoc();
await exec("view.newGuide", { orientation: "horizontal", position: 45 });
await patchMaker();
info = await getDocInfo();
assert(info!.width === 100 && info!.height === 30, `h_sym size ${info!.width}x${info!.height}`);
await docCloseWithoutSaving();

// 가이드 없음 / 잘못된 구성 → 오류
await stripeDoc();
let err = "";
await patchMaker().catch((e) => (err = String(e.message)));
assert(err.startsWith("가이드가 없습니다"), "no guide error: " + err);
for (const p of [10, 20, 30]) await exec("view.newGuide", { orientation: "vertical", position: p });
err = "";
await patchMaker().catch((e) => (err = String(e.message)));
assert(err.startsWith("유효하지 않은 가이드 구성입니다"), "invalid guide error: " + err);
await docCloseWithoutSaving();
console.log("GUIDE OK");
