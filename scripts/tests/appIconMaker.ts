// B1: App icon maker 검증 (플랫폼별 폴더, 크기, 적응형 f/b, 원본 문서 유지)
import fs from "node:fs";
import { decode } from "fast-png";
import { appIconMaker, APP_ICONS } from "../../src/features/appIconMaker";
import { listDocuments } from "../../src/lib/lib_doc";
import { getLayerTree } from "../../src/lib/lib_layer";
import { assert, outDir, newTestDoc, groupWith, pngSize, closeAll } from "./_exportUtil";

await newTestDoc("Origin", 2048, 2048);
await groupWith("b", "bg", 0, 0, 2048, 2048, "#3366ff");
await groupWith("f", "fg", 700, 700, 648, 648, "#ffffff");
const out = outDir("icons");
(globalThis as any).__JP_DIALOG_ANSWERS__ = [out];
const log = (globalThis as any).__JP_LOG__ as string[];
const t0 = Date.now();
await appIconMaker();
console.log("소요", Date.now() - t0, "ms");
assert(log.at(-1) === "앱 아이콘 생성이 완료되었습니다!", "완료 알림");

for (const p of [APP_ICONS.IOS, APP_ICONS.ANDROID]) {
  for (const n of p.sizes) {
    const s = pngSize(`${out}/${p.name}/${p.name}_${n}.png`);
    assert(s[0] === n && s[1] === n, `${p.name}_${n} 크기 ${s}`);
  }
}
for (const n of APP_ICONS.ANDROID_ADAPTIVE.sizes) {
  for (const l of ["f", "b"]) {
    const s = pngSize(`${out}/android(Adaptive)/android_${n}_${l}.png`);
    assert(s[0] === n && s[1] === n, `adaptive ${n}_${l} 크기 ${s}`);
  }
}
// 적응형 f: 배경 투명 + 중앙 흰색, b: 전체 파란색
const px = (f: string, x: number, y: number) => {
  const i = decode(fs.readFileSync(`${out}/android(Adaptive)/${f}`));
  const o = (y * i.width + x) * i.channels;
  return Array.from(i.data.slice(o, o + i.channels));
};
assert(px("android_108_f.png", 0, 0).at(-1) === 0 && px("android_108_f.png", 54, 54)[0] === 255, "f 레이어만 표시");
assert(px("android_108_b.png", 0, 0)[2] === 255 && px("android_108_b.png", 54, 54)[0] === 51, "b 레이어만 표시");
const total = fs.readdirSync(`${out}/iOS`).length + fs.readdirSync(`${out}/android`).length + fs.readdirSync(`${out}/android(Adaptive)`).length;
assert(total === 17 + 13 + 12, "파일 개수 " + total);
assert((await listDocuments()).documents.length === 1, "복제 문서 정리");
assert((await getLayerTree()).every((l) => l.visible), "원본 레이어 표시 상태 유지");
await closeAll();
console.log("APP ICON MAKER OK");
