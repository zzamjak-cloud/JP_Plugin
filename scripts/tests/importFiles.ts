// Import PNG/PSD files 검증: 폴더의 파일을 Imported_Assets 문서(선택 사이즈)에 중앙 배치된 스마트 오브젝트로 가져오고 초기 레이어 제거
import fs from "node:fs";
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving, getDocInfo } from "../../src/lib/lib_doc";
import { getAllLayers, newLayer } from "../../src/lib/lib_layer";
import { saveForWebPNG, saveAsPSD } from "../../src/lib/lib_export";
import { selectSize, SIZE_PRESETS } from "../../src/features/sizePresets";
import { importPNGFiles, importPSDFiles } from "../../src/features/importFiles";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
const dir = "/tmp/jp_import_7982";
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir + "/png", { recursive: true });
fs.mkdirSync(dir + "/psd", { recursive: true });

// 소스 파일 생성: PNG 2개(40x20, 10x10), 2레이어 PSD 1개
for (const [name, w, h] of [["alpha", 40, 20], ["beta", 10, 10]] as const) {
  await createDoc(name, w, h, 72, "rgb", "white");
  await saveForWebPNG(dir + "/png", name);
  await docCloseWithoutSaving();
}
await createDoc("multi", 30, 30);
await exec("select.rect", { x: 0, y: 0, width: 10, height: 10 });
await exec("edit.fill", { contents: "color", color: "#ff0000" });
await newLayer("top");
await exec("select.rect", { x: 20, y: 20, width: 10, height: 10 });
await exec("edit.fill", { contents: "color", color: "#00ff00" });
await exec("select.deselect");
await saveAsPSD(dir + "/psd/multi");
await docCloseWithoutSaving();
fs.writeFileSync(dir + "/png/readme.txt", "x");

selectSize(SIZE_PRESETS.importDocSize, { width: 256, height: 128 });
(globalThis as any).__JP_DIALOG_ANSWERS__.push(dir + "/png");
await importPNGFiles();
let d = await getDocInfo();
let ls = await getAllLayers();
console.log(d?.name, d?.width, d?.height, ls.map((l) => `${l.name}:${l.kind}:${JSON.stringify(l.bounds)}`).join(" | "));
assert(d?.name === "Imported_Assets" && d.width === 256 && d.height === 128, "문서 이름/크기");
assert(ls.length === 2, "레이어 2개 (초기 레이어 제거)");
const alpha = ls.find((l) => l.name === "alpha");
assert(alpha && /smart/i.test(alpha.kind) && JSON.stringify(alpha.bounds) === "[108,54,40,20]", "alpha 중앙 SO");
assert(ls.find((l) => l.name === "beta"), "beta 존재");
await docCloseWithoutSaving();

(globalThis as any).__JP_DIALOG_ANSWERS__.push(dir + "/psd");
await importPSDFiles();
ls = await getAllLayers();
console.log(ls.map((l) => `${l.name}:${l.kind}:${JSON.stringify(l.bounds)}`).join(" | "));
assert(ls.length === 1 && ls[0].name === "multi" && /smart/i.test(ls[0].kind), "PSD → 단일 SO 'multi'");
await docCloseWithoutSaving();

// 파일 없는 폴더 → 예외
(globalThis as any).__JP_DIALOG_ANSWERS__.push(dir + "/psd");
let err = "";
await importPNGFiles().catch((e) => (err = e.message));
assert(err === "선택한 폴더에 PNG 파일이 없습니다.", `오류 메시지: ${err}`);
console.log("IMPORT OK");
