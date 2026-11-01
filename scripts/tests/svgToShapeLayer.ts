// Import SVG as shape: 파일 선택 → 128px 신규 문서, 스타일 그룹별 Shape Layer, 커브/아크 렌더 검증
import fs from "node:fs";
import { createDoc, docCloseWithoutSaving, getDocInfo } from "../../src/lib/lib_doc";
import { getAllLayers } from "../../src/lib/lib_layer";
import { getDocumentPixels } from "../../src/lib/lib_pixels";
import { getShapeInfo, getStrokeSettings } from "../../src/lib/lib_shape";
import { importSvgToShape, parseSvg, parseSvgPathD, commandsToSubpaths } from "../../src/features/svgToShapeLayer";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("ASSERT: " + m); };
const root = process.env.PCROOT!;
fs.mkdirSync(`${root}/svg`, { recursive: true });

// 순수 파서 단위 검증: 상대좌표/암묵 반복/H/V/Z, Q→C, 아크
const sp = commandsToSubpaths(parseSvgPathD("m10 10 10 0 0 10z M0 0 Q 10 0 10 10 T 20 20 A 5 5 0 0 1 30 20"));
assert(sp.length === 2 && sp[0].closed && sp[0].points.length === 3 && sp[0].points[1].x === 20 && sp[0].points[2].y === 20, "상대 M 암묵 L");
assert(!sp[1].closed && sp[1].points.at(-1).x === 30, "Q/T/A 끝점");
assert(parseSvg('<svg width="48" height="32"><path d="M0 0L1 1"/></svg>').viewBox.width === 48, "viewBox 없을 때 width/height");

// 1) 단색: 원(아크) + 내부 사각형
fs.writeFileSync(`${root}/svg/circle_icon.svg`, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff0000" d="M12 2a10 10 0 1 0 0.001 0zM8 8h8v8H8z"/></svg>');
await createDoc("keep", 50, 50); // 기존 문서가 있어도 새 문서로 열리는지
(globalThis as any).__JP_DIALOG_ANSWERS__.push(`${root}/svg/circle_icon.svg`);
await importSvgToShape();
let d = await getDocInfo();
assert(d!.name.startsWith("circle_icon") && d!.width === 128 && d!.height === 128, "문서 이름/크기 " + d!.name);
let layers = (await getAllLayers()).filter((l) => l.kind === "Shape");
assert(layers.length === 1, "Shape 1개");
const info = await getShapeInfo(layers[0].id);
assert(info.fill === "#ff0000" && info.stroke === null, "채우기만");
let img = await getDocumentPixels();
let a = (x: number, y: number) => img.data[(y * 128 + x) * 4 + 3];
let rgb = (x: number, y: number) => Array.from(img.data.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 3)).join(",");
assert(a(64, 16) > 200 && rgb(64, 16) === "255,0,0", "원 위쪽 내부");
assert(a(64, 8) < 30 && a(8, 8) < 10 && a(30, 30) > 200, "원 바깥/안쪽 " + [a(64, 8), a(8, 8), a(30, 30)]);
// 원 반지름 53.33px — 경계 근처 커버리지 검사 (64±53)
assert(a(64 + 50, 64) > 200 && a(64 + 56, 64) < 30, "원 반지름");
await docCloseWithoutSaving();

// 2) 다색: 상속 fill + stroke만 있는 열린 path + fill+stroke
fs.writeFileSync(`${root}/svg/multi.svg`, `<svg viewBox="0 0 24 24"><g fill="#0000ff">
<path d="M2 2h8v8H2z"/>
<path d="M4 20 L20 20" stroke="#00ff00" stroke-width="2" fill="none"/>
<path d="M14 2h8v8h-8z" style="fill:#ffff00;stroke:#ff0000;stroke-width:1"/>
<path d="M0 0h1" fill="none"/>
</g></svg>`);
(globalThis as any).__JP_DIALOG_ANSWERS__.push(`${root}/svg/multi.svg`);
await importSvgToShape();
layers = (await getAllLayers()).filter((l) => l.kind === "Shape");
console.log(layers.map((l) => l.name).join(" | "));
assert(layers.length === 3, "그룹 3개 (fill none + stroke 없음 제외)");
// 먼저 등장한 그룹이 아래 → 목록(위→아래)은 역순
assert(layers[2].name === "#0000ff" && layers[1].name === "#00ff00" && layers[0].name === "#ffff00", "레이어 이름/순서");
const s1 = await getStrokeSettings(layers[1].id);
const i1 = await getShapeInfo(layers[1].id);
assert(i1.fill === null && s1!.enabled && s1!.width === 11 && s1!.color.g === 255 && s1!.cap === "round", "stroke only " + JSON.stringify(s1));
const i0 = await getShapeInfo(layers[0].id);
const s0 = await getStrokeSettings(layers[0].id);
assert(i0.fill === "#ffff00" && s0!.width === 5 && s0!.color.r === 255, "fill+stroke");
img = await getDocumentPixels();
a = (x: number, y: number) => img.data[(y * 128 + x) * 4 + 3];
rgb = (x: number, y: number) => Array.from(img.data.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 3)).join(",");
assert(rgb(32, 32) === "0,0,255", "파랑 사각형 " + rgb(32, 32));
assert(rgb(64, 107) === "0,255,0", "초록 선 " + rgb(64, 107));
assert(rgb(96, 26) === "255,255,0" && rgb(75, 26) === "255,0,0", "노랑 + 빨강 테두리 " + rgb(96, 26) + " / " + rgb(75, 26));
await docCloseWithoutSaving();

// 3) path 없는 SVG → 오류
fs.writeFileSync(`${root}/svg/empty.svg`, '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>');
(globalThis as any).__JP_DIALOG_ANSWERS__.push(`${root}/svg/empty.svg`);
let err = "";
try { await importSvgToShape(); } catch (e) { err = String(e); }
assert(err.includes("유효한 path"), "빈 SVG 오류");
// 취소
(globalThis as any).__JP_DIALOG_ANSWERS__.push(null);
await importSvgToShape();
await docCloseWithoutSaving(); // keep
console.log("SVG_TO_SHAPE OK");
