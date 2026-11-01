// E3: Save GIF / JPG / PNG 검증 (PSD 폴더·같은 이름, 루트 안/밖, 미저장 문서 다이얼로그)
import fs from "node:fs";
import { speedSave } from "../../src/features/exportSpeedSave";
import { saveActiveDocAs } from "../../src/lib/lib_export";
import { assert, outDir, newTestDoc, rectLayer, pngSize, exists, closeAll } from "./_exportUtil";

const root = process.env.PCROOT!;
await newTestDoc("e3doc", 120, 80);
await rectLayer("A", 10, 10, 50, 40);

// 루트 안에 저장된 PSD
fs.rmSync(`${root}/e3`, { recursive: true, force: true });
await saveActiveDocAs(`${root}/e3/speed.psd`);
for (const ext of ["png", "jpg", "gif"] as const) await speedSave(ext);
const s = pngSize(`${root}/e3/speed.png`);
assert(s[0] === 120 && s[1] === 80, "PNG 크기 " + s);
exists(`${root}/e3/speed.jpg`);
exists(`${root}/e3/speed.gif`);
assert(fs.readFileSync(`${root}/e3/speed.jpg`).subarray(0, 2).toString("hex") === "ffd8", "JPG 시그니처");
assert(fs.readFileSync(`${root}/e3/speed.gif`).subarray(0, 3).toString() === "GIF", "GIF 시그니처");

// 미저장 문서 → 폴더 다이얼로그, 문서 이름 사용 (루트 밖)
await newTestDoc("unsaved", 64, 32);
await rectLayer("B", 0, 0, 10, 10);
const out = outDir("e3");
(globalThis as any).__JP_DIALOG_ANSWERS__ = [out];
await speedSave("png");
const s2 = pngSize(`${out}/unsaved.png`);
assert(s2[0] === 64 && s2[1] === 32, "미저장 PNG " + s2);
await closeAll();
console.log("SPEED SAVE OK");
