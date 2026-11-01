// E2: Export PNG & link 검증 (그룹 → 스마트 오브젝트 변환, 내용 PNG/PSD 저장)
import * as fp from "../../src/features/folderPreset";
import { savePngAndLinkToPSD } from "../../src/features/exportSelectedAndLink";
import { selectLayers, getAllLayers, convertToSmartObject, selectByLayerID } from "../../src/lib/lib_layer";
import { listDocuments } from "../../src/lib/lib_doc";
import { assert, outDir, newTestDoc, rectLayer, groupWith, pngSize, exists, closeAll } from "./_exportUtil";

localStorage.clear();
const out = outDir("e2");
fp.setSelectedFolder(fp.addFolderPreset(out, "e2"));
const log = (globalThis as any).__JP_LOG__ as string[];

await newTestDoc("e2doc");
const a = await rectLayer("A", 10, 10, 50, 40);
const g = await groupWith("Grp", "inner", 120, 120, 30, 25);
const soSrc = await rectLayer("Sm", 60, 100, 16, 12, "#0000ff");
await selectByLayerID(soSrc);
const so = (await convertToSmartObject(soSrc))?.layer;
assert(typeof so === "number", "SO 생성");

// 픽셀만 선택 → 알림
await selectLayers([a]);
await savePngAndLinkToPSD();
assert(log.at(-1) === "스마트 오브젝트 또는 그룹 레이어를 선택해주세요.", "필터 알림: " + log.at(-1));

await selectLayers([g, so, a]);
const names = await savePngAndLinkToPSD();
assert(names.length === 2, "2개 내보냄: " + JSON.stringify(names) + " " + log.at(-1));
let s = pngSize(`${out}/Grp.png`);
assert(s[0] === 30 && s[1] === 25, "Grp.png " + s);
exists(`${out}/Grp.psd`);
s = pngSize(`${out}/Sm.png`);
assert(s[0] === 16 && s[1] === 12, "Sm.png " + s);
exists(`${out}/Sm.psd`);

const ls = await getAllLayers();
const grp = ls.find((l) => l.name === "Grp");
assert(grp?.kind === "Smart Object", "그룹이 스마트 오브젝트로 변환: " + grp?.kind);
assert(!ls.some((l) => l.selected), "선택 해제");
assert((await listDocuments()).documents.length === 1, "내용 문서 닫힘");
await closeAll();
localStorage.clear();
console.log("EXPORT PNG & LINK OK");
