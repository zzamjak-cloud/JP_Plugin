// E4: Market screenshot 검증 (최상위 국가코드 그룹/SO만, 이름 그대로, 끝나면 모두 숨김)
import fs from "node:fs";
import { exportMarketScreenshot, isCountryCode } from "../../src/features/exportMarketScreenshot";
import { saveActiveDocAs } from "../../src/lib/lib_export";
import { getAllLayers, selectByLayerID, convertToSmartObject, makeGroupFromSelectLayers } from "../../src/lib/lib_layer";
import { assert, newTestDoc, rectLayer, groupWith, closeAll } from "./_exportUtil";

const root = process.env.PCROOT!;
const log = (globalThis as any).__JP_LOG__ as string[];
assert(isCountryCode(" KR ") && isCountryCode("jpn") && isCountryCode("uk") && !isCountryCode("xx") && !isCountryCode("korea"), "국가코드 판정");

fs.rmSync(`${root}/e4`, { recursive: true, force: true });
await newTestDoc("market", 100, 60);
await rectLayer("bg", 0, 0, 100, 60, "#ffffff");
await groupWith("kr", "k", 0, 0, 30, 30, "#ff0000");
await groupWith("JPN", "j", 40, 0, 30, 30, "#00ff00");
await groupWith("notcode", "n", 0, 30, 30, 30, "#0000ff");
const usSrc = await rectLayer("us", 70, 30, 30, 30, "#00ffff");
await selectByLayerID(usSrc);
await convertToSmartObject(usSrc);
// 중첩된 국가코드 그룹은 대상 아님
const nestedInner = await groupWith("fr", "f", 50, 50, 5, 5);
await selectByLayerID(nestedInner);
await makeGroupFromSelectLayers("wrapper");
// 국가코드 이름의 픽셀 레이어도 대상 아님
await rectLayer("de", 90, 0, 5, 5);
await saveActiveDocAs(`${root}/e4/Shot.psd`);

const n = await exportMarketScreenshot();
assert(n === 3, "3개 내보냄: " + n + " " + log.at(-1));
assert(log.at(-1) === "3개 JPG 내보내기가 완료되었습니다.", "완료 알림");
for (const c of ["kr", "JPN", "us"]) assert(fs.existsSync(`${root}/e4/Shot_${c}.jpg`), `Shot_${c}.jpg`);
assert(!fs.existsSync(`${root}/e4/Shot_fr.jpg`) && !fs.existsSync(`${root}/e4/Shot_de.jpg`), "비대상 제외");
const ls = await getAllLayers();
for (const c of ["kr", "JPN", "us"]) assert(ls.find((l) => l.name === c && l.depth === 0)?.visible === false, `${c} 숨김`);
assert(ls.find((l) => l.name === "notcode")?.visible === true, "비대상 표시 유지");

// 국가코드 레이어 없음
await newTestDoc("none", 50, 50);
await rectLayer("x", 0, 0, 5, 5);
assert((await exportMarketScreenshot()) === 0 && log.at(-1) === "국가코드 레이어가 존재하지 않습니다.", "없음 알림");
await closeAll();
console.log("MARKET SCREENSHOT OK");
