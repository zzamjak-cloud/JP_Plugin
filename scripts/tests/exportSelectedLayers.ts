// E1: Export layers as PNG / PSD 검증 (트림, Keep doc size, 파일명 정리, 그룹 필터)
import * as fp from "../../src/features/folderPreset";
import { exportSelectedFile } from "../../src/features/exportSelectedLayers";
import { selectLayers, getAllLayers } from "../../src/lib/lib_layer";
import { listDocuments } from "../../src/lib/lib_doc";
import { assert, outDir, newTestDoc, rectLayer, groupWith, pngSize, exists, closeAll } from "./_exportUtil";

localStorage.clear();
const out = outDir("e1");
fp.setSelectedFolder(fp.addFolderPreset(out, "e1"));

await newTestDoc("e1doc");
const a = await rectLayer("A", 10, 10, 50, 40);
const bad = await rectLayer("bad:name", 100, 20, 20, 30, "#0000ff");
const g = await groupWith("G", "inner", 120, 120, 30, 25);
const docsBefore = (await listDocuments()).documents.length;

// PNG, 트림
await selectLayers([a, bad]);
let r = await exportSelectedFile("png");
assert(r.success === 2 && r.failed.length === 0, "PNG 2개 성공: " + JSON.stringify(r));
let s = pngSize(`${out}/A.png`);
assert(s[0] === 50 && s[1] === 40, "A.png 트림 크기 " + s);
s = pngSize(`${out}/bad_name.png`);
assert(s[0] === 20 && s[1] === 30, "bad_name.png 크기 " + s);
assert((await listDocuments()).documents.length === docsBefore, "임시 문서 정리");

// PNG, Keep doc size
fp.setKeepDocSize(true);
await selectLayers([a]);
await exportSelectedFile("png");
s = pngSize(`${out}/A.png`);
assert(s[0] === 200 && s[1] === 200, "Keep doc size 크기 " + s);
fp.setKeepDocSize(false);

// PSD: 픽셀 레이어만 선택 → 오류
let err = "";
await selectLayers([a]);
try {
  await exportSelectedFile("psd");
} catch (e: any) {
  err = e.message;
}
assert(err === "그룹 레이어 또는 스마트 오브젝트를 선택해주세요.", "PSD 필터 오류: " + err);

// PSD: 그룹 + 픽셀 → 그룹만 PNG+PSD
await selectLayers([g, a]);
r = await exportSelectedFile("psd");
assert(r.success === 1, "PSD 1개 " + JSON.stringify(r));
s = pngSize(`${out}/G.png`);
assert(s[0] === 30 && s[1] === 25, "G.png 크기 " + s);
exists(`${out}/G.psd`);

// 원본 문서 레이어는 그대로
const all = await getAllLayers();
assert(all.length >= 4, "원본 레이어 유지");
await closeAll();
localStorage.clear();
console.log("EXPORT SELECTED LAYERS OK");
