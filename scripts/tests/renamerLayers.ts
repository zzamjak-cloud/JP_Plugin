// Layers rename 검증: 프리셋 저장(최대 10·중복·트림), 7가지 타입, 자리수, 선택 복원, Undo 1단계
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving, getDocInfo } from "../../src/lib/lib_doc";
import { newLayer, getAllLayers, getSelectedLayers, selectLayers } from "../../src/lib/lib_layer";
import {
  addTextPreset,
  getTextPresets,
  removeTextPreset,
  setSelectedText,
  getSelectedText,
  setDigitCount,
  renamerLayers,
  type RenameType,
} from "../../src/features/renamerLayers";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
// 프리셋
assert(addTextPreset("enter", "  pre_ ") === "pre_", "트림");
addTextPreset("enter", "pre_");
assert(getTextPresets("enter").length === 1, "중복 무시");
for (let i = 0; i < 9; i++) addTextPreset("enter", `p${i}`);
let err = "";
try {
  addTextPreset("enter", "overflow");
} catch (e: any) {
  err = e.message;
}
assert(err === "최대 10개의 프리셋만 추가할 수 있습니다.", "최대 10개");
setSelectedText("enter", "p0");
removeTextPreset("enter", "p0");
assert(getSelectedText("enter") === "", "선택 프리셋 삭제 시 선택 해제");
assert(localStorage.getItem("layerRenamerPresets")!.startsWith('["pre_"'), "localStorage 키");
for (let i = 1; i < 9; i++) removeTextPreset("enter", `p${i}`);
addTextPreset("enter", "X");

await createDoc("ren", 50, 50);
const ids = [await newLayer("L1"), await newLayer("L2"), await newLayer("L3")];
const sel = async () => selectLayers(ids);
const namesTopDown = async () => (await getSelectedLayers()).map((l) => l.name).join(",");
const run = async (t: RenameType) => {
  await sel();
  await renamerLayers(t);
  return namesTopDown();
};
addTextPreset("replace", "X");
setSelectedText("enter", "pre_");
assert((await run("prefix")) === "pre_L3,pre_L2,pre_L1", "prefix");
setSelectedText("replace", "X");
assert((await run("replace")) === "XL3,XL2,XL1", "replace 첫 일치");
setSelectedText("enter", "X");
assert((await run("remove")) === "L3,L2,L1", "remove");
addTextPreset("enter", "_s");
setSelectedText("enter", "_s");
assert((await run("suffix")) === "L3_s,L2_s,L1_s", "suffix");
setDigitCount(3);
assert((await run("number")) === "L3_s003,L2_s002,L1_s001", "number: 첫(위) 레이어가 가장 큰 번호");
setDigitCount(1);
assert((await run("reversenumber")) === "L3_s0031,L2_s0022,L1_s0013", "reversenumber");
addTextPreset("enter", "icon");
setSelectedText("enter", "icon");
assert((await run("rename")) === "icon,icon,icon", "rename");
// 선택 복원
assert((await getSelectedLayers()).length === 3, "선택 복원");
// Undo 1단계: 한 번 되돌리면 직전(reversenumber) 이름
await exec("edit.undo", {});
assert((await namesTopDown()) === "L3_s0031,L2_s0022,L1_s0013", `undo 1단계: ${await namesTopDown()}`);
// 텍스트 없이 prefix → 오류
setSelectedText("enter", "");
err = "";
await renamerLayers("prefix").catch((e) => (err = e.message));
assert(err === "변경할 텍스트를 입력해주세요.", "검증 오류");
console.log((await getDocInfo())?.history.slice(-3));
await docCloseWithoutSaving();
console.log("RENAME OK");
