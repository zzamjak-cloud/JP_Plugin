// E5: Clean PSD 검증 (모든 레이어를 새 문서로 옮겨 원본 경로에 덮어쓰기, 이후 문서 없음)
import fs from "node:fs";
import { cleanPSD } from "../../src/features/cleanPSD";
import { saveActiveDocAs, openFile } from "../../src/lib/lib_export";
import { getAllLayers } from "../../src/lib/lib_layer";
import { listDocuments } from "../../src/lib/lib_doc";
import { assert, newTestDoc, rectLayer, groupWith, closeAll } from "./_exportUtil";

const root = process.env.PCROOT!;
const path = `${root}/e5/clean.psd`;
fs.rmSync(`${root}/e5`, { recursive: true, force: true });
await newTestDoc("clean", 120, 90);
await rectLayer("A", 10, 10, 50, 40);
await groupWith("G", "inner", 60, 50, 30, 25);
await rectLayer("C", 0, 0, 5, 5, "#0000ff");
await saveActiveDocAs(path);
const before = (await getAllLayers()).map((l) => `${l.depth}:${l.name}:${l.kind}`);
const mtime = fs.statSync(path).mtimeMs;
await new Promise((r) => setTimeout(r, 20));

assert((await cleanPSD()) === path, "원본 경로 반환");
assert((await listDocuments()).documents.length === 0, "문서가 모두 닫힘");
assert(fs.statSync(path).mtimeMs > mtime, "원본 경로에 다시 저장");

await openFile(path);
const after = (await getAllLayers()).map((l) => `${l.depth}:${l.name}:${l.kind}`);
assert(JSON.stringify(after) === JSON.stringify(before), `레이어 구조 동일\n${before}\n${after}`);
await closeAll();

// 미저장 문서 → 오류
await newTestDoc("unsaved", 10, 10);
let err = "";
try {
  await cleanPSD();
} catch (e: any) {
  err = e.message;
}
assert(err.startsWith("저장된 문서가 아닙니다"), "미저장 오류");
await closeAll();
console.log("CLEAN PSD OK");
