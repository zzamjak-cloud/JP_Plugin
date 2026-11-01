// E0: 내보내기 폴더 프리셋 + Keep doc size 상태 검증
import * as fp from "../../src/features/folderPreset";
import { assert, outDir, newTestDoc, closeAll } from "./_exportUtil";
import { saveActiveDocAs } from "../../src/lib/lib_export";

localStorage.clear();
const d1 = outDir("presetA");
const d2 = outDir("presetB");
(globalThis as any).__JP_DIALOG_ANSWERS__ = [d1];
const p1 = await fp.addFolderPresetViaDialog();
assert(p1.name === "presetA" && p1.path === d1, "프리셋 이름/경로");
assert(fp.getSelectedFolder()?.id === p1.id, "추가 시 자동 선택");
assert(JSON.parse(localStorage.getItem("exportFolderPresets")!).length === 1, "exportFolderPresets 키");

let err = "";
try {
  fp.addFolderPreset(d1, "dup");
} catch (e: any) {
  err = e.message;
}
assert(err === "이미 존재하는 폴더 경로입니다.", "중복 경로 오류: " + err);

(globalThis as any).__JP_DIALOG_ANSWERS__ = [null];
err = "";
try {
  await fp.addFolderPresetViaDialog();
} catch (e: any) {
  err = e.message;
}
assert(err === "폴더가 선택되지 않았습니다.", "폴더 미선택 오류");

await new Promise((r) => setTimeout(r, 2));
const p2 = fp.addFolderPreset(d2, "presetB");
for (let i = 0; i < 8; i++) fp.addFolderPreset(`/tmp/x${i}`, `x${i}`);
err = "";
try {
  fp.addFolderPreset("/tmp/x99", "x99");
} catch (e: any) {
  err = e.message;
}
assert(err === "최대 10개의 폴더 프리셋만 추가할 수 있습니다.", "최대 개수 오류: " + err);

// 선택 중인 프리셋 삭제 → 선택 해제
fp.removeFolderPreset(p1.id);
assert(fp.getSelectedFolder() === null, "선택 프리셋 삭제 시 선택 해제");
assert(!fp.getFolderPresets().some((p) => p.id === p1.id), "프리셋 삭제");
fp.setSelectedFolder(p2);
assert((await fp.resolveExportFolder()) === d2, "선택 프리셋 폴더 사용");

// Keep doc size
assert(fp.getKeepDocSize() === false, "기본 false");
fp.setKeepDocSize(true);
assert(fp.getKeepDocSize() === true && localStorage.getItem("keepDocSizeState") === '{"isChecked":true}', "Keep doc size 저장");

// 프리셋 없음 → 저장된 문서 폴더, 저장 안 된 문서 → 폴더 다이얼로그
fp.setSelectedFolder(null);
await newTestDoc("unsaved");
(globalThis as any).__JP_DIALOG_ANSWERS__ = [d1];
assert((await fp.resolveExportFolder()) === d1, "미저장 문서 → 폴더 다이얼로그");
await saveActiveDocAs(`${process.env.PCROOT}/docs/saved.psd`);
assert((await fp.resolveExportFolder()) === `${process.env.PCROOT}/docs`, "저장된 문서 폴더(루트 안): " + (await fp.resolveExportFolder()));
await closeAll();
localStorage.clear();
console.log("FOLDER PRESET OK");
