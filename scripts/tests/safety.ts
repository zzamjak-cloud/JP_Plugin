// 데이터 손실 방지 회귀 테스트: 저장 실패 시 원본 보존 / 이름 불일치 문서 닫기 거부 / 열린 문서 원본 덮어쓰기 거부
import fs from "node:fs";
import { createDoc, docCloseWithoutSaving, listDocuments } from "../../src/lib/lib_doc";
import { saveActiveDocAs, saveAsPSD, openFile } from "../../src/lib/lib_export";
import { getConfig } from "../../src/core/bridge";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error("ASSERT: " + m);
};
const root = (await getConfig()).root;

// 1) 이름이 다른 문서는 닫지 않는다
const a = await createDoc("safeA", 40, 40);
let refused = false;
try {
  await docCloseWithoutSaving(a, "다른이름");
} catch {
  refused = true;
}
assert(refused, "이름 불일치 시 닫기 거부");
assert((await listDocuments()).documents.some((d) => d.name === "safeA"), "safeA 문서 유지");

// 2) 저장 실패 시 기존 파일 보존 (PhotoCraft가 거부하는 확장자로 강제 실패)
const target = `${root}/keep.psd`;
await saveActiveDocAs(target);
const original = fs.readFileSync(target);
const bogus = `${root}/keep.notaformat`;
fs.writeFileSync(bogus, "ORIGINAL");
let failed = false;
try {
  await saveActiveDocAs(bogus);
} catch {
  failed = true;
}
assert(failed, "지원하지 않는 형식 저장은 실패해야 함");
assert(fs.readFileSync(bogus, "utf8") === "ORIGINAL", "저장 실패 시 기존 파일 보존");
assert(Buffer.compare(fs.readFileSync(target), original) === 0, "PSD 원본 유지");

// 3) 열린 문서의 원본 파일로 내보내기 거부
const opened = await openFile(target);
let guarded = false;
try {
  await saveAsPSD(target);
} catch (e) {
  guarded = String(e).includes("덮어쓰지 않았습니다");
}
assert(guarded, "열린 문서 원본 덮어쓰기 거부");
await docCloseWithoutSaving(opened);
await docCloseWithoutSaving(undefined);
console.log("SAFETY OK");
