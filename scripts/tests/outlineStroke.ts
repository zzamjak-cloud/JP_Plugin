// Outline Stroke / Expand Path: 실제 PhotoCraft 렌더 결과를 원본 stroke 렌더와 비교
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving, getDocInfo } from "../../src/lib/lib_doc";
import { getAllLayers } from "../../src/lib/lib_layer";
import { getDocumentPixels, type RGBAImage } from "../../src/lib/lib_pixels";
import { getShapeInfo } from "../../src/lib/lib_shape";
import { outlineStroke, expandPath } from "../../src/features/outlineStroke";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("ASSERT: " + m); };
// 알파 마스크 IoU
function iou(a: RGBAImage, b: RGBAImage) {
  let inter = 0, uni = 0;
  for (let i = 3; i < a.data.length; i += 4) {
    const x = a.data[i] > 127, y = b.data[i] > 127;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return inter / Math.max(1, uni);
}
async function check(name: string, shape: Record<string, unknown>, minIou: number) {
  await createDoc(name, 300, 300);
  const r = await exec<any>("shape.create", shape);
  const before = await getDocumentPixels();
  const h0 = (await getDocInfo())!.history.length;
  await outlineStroke();
  const h1 = (await getDocInfo())!.history.length;
  assert(h1 - h0 === 1, `${name}: Undo 1단계 (${h1 - h0})`);
  const after = await getDocumentPixels();
  const layers = await getAllLayers();
  assert(!layers.some((l) => l.id === r.layer), `${name}: 원본 삭제`);
  const shapes = layers.filter((l) => l.kind === "Shape");
  assert(shapes.length === 1, `${name}: Shape 1개 (${shapes.length})`);
  const info = await getShapeInfo(shapes[0].id);
  assert(info.fill === (shape.stroke as any).color && info.stroke === null, `${name}: stroke색 채우기/stroke 없음 ${info.fill}`);
  const v = iou(before, after);
  console.log(`${name}: IoU=${v.toFixed(4)} subpaths=${info.path.subpaths.length}`);
  assert(v >= minIou, `${name}: IoU ${v} < ${minIou}`);
  await docCloseWithoutSaving();
}

// 닫힌 사각형 + 중앙 정렬 + miter
await check("rect_center", { kind: "path", fill: null, stroke: { width: 12, color: "#ff0000", align: "center", cap: "butt", join: "miter" },
  path: { subpaths: [{ closed: true, knots: [[50, 50], [250, 50], [250, 200], [50, 200]] }] } }, 0.97);
// 닫힌 원(베지어) + 바깥 정렬 + round
await check("circle_outer", { kind: "ellipse", rect: [60, 60, 180, 180], fill: null, stroke: { width: 10, color: "#00ff00", align: "outside", cap: "butt", join: "round" } }, 0.97);
// 안쪽 정렬
await check("ellipse_inner", { kind: "ellipse", rect: [40, 80, 220, 140], fill: null, stroke: { width: 16, color: "#0000ff", align: "inside", cap: "butt", join: "round" } }, 0.96);
// 열린 커브 + round cap
await check("open_round", { kind: "path", fill: null, stroke: { width: 14, color: "#123456", align: "center", cap: "round", join: "round" },
  path: { subpaths: [{ closed: false, knots: [{ anchor: [40, 250], in: [40, 250], out: [80, 40], smooth: false }, { anchor: [260, 250], in: [220, 40], out: [260, 250], smooth: false }] }] } }, 0.95);
// 열린 직선 + square cap
await check("open_square", { kind: "path", fill: null, stroke: { width: 20, color: "#abcdef", align: "center", cap: "square", join: "miter" },
  path: { subpaths: [{ closed: false, knots: [[50, 150], [250, 150]] }] } }, 0.97);

// stroke 없는 Shape → 오류
await createDoc("nostroke", 100, 100);
await exec("shape.create", { kind: "rect", rect: [10, 10, 50, 50], fill: "#000000" });
let err = "";
try { await outlineStroke(); } catch (e) { err = String(e); }
assert(err.includes("Stroke가 활성화되지 않았거나 두께가 0입니다."), "stroke 없음 오류: " + err);
await docCloseWithoutSaving();

// Expand Path: 사각형(구멍 포함) +4 / -4
const answers: string[] = [];
(globalThis as any).window = { prompt: () => answers.shift() ?? null };
for (const v of [4, -4]) {
  await createDoc("expand", 300, 300);
  const r = await exec<any>("shape.create", { kind: "path", fill: "#ff8800",
    path: { subpaths: [{ closed: true, knots: [[50, 50], [250, 50], [250, 250], [50, 250]] }, { closed: true, op: "subtract", knots: [[120, 120], [180, 120], [180, 180], [120, 180]] }] } });
  answers.push(String(v));
  await expandPath();
  const layers = (await getAllLayers()).filter((l) => l.kind === "Shape");
  assert(layers.length === 2 && layers.some((l) => l.id === r.layer), `expand ${v}: 원본 유지 + 새 레이어`);
  const nl = layers.find((l) => l.id !== r.layer)!;
  const info = await getShapeInfo(nl.id);
  console.log(`expand ${v}: bounds=${JSON.stringify(nl.bounds)} fill=${info.fill} subpaths=${info.path.subpaths.map((s: any) => s.op).join(",")}`);
  assert(info.fill === "#ff8800", "원본 채우기 색");
  const b = nl.bounds!;
  assert(Math.abs(b[0] - (50 - v)) <= 1 && Math.abs(b[2] - (200 + 2 * v)) <= 1, `expand ${v} bounds`);
  // 구멍이 반대로 줄거나 늘어났는지: 구멍 경계 바로 안쪽 픽셀 확인
  await exec("layer.setProps", { layer: r.layer, visible: false });
  const img = await getDocumentPixels();
  const a = (x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
  // v>0: 구멍이 작아짐 → (122,150)은 채워짐, v<0: 구멍 커짐 → (118,150)은 비어있음
  if (v > 0) assert(a(122, 150) > 127 && a(150, 150) < 128, "구멍 축소");
  else assert(a(118, 150) < 128 && a(112, 150) > 127, "구멍 확대");
  await docCloseWithoutSaving();
}
// 취소/0 → 아무것도 안 함
answers.push("0");
await createDoc("expand0", 50, 50);
await exec("shape.create", { kind: "rect", rect: [10, 10, 20, 20], fill: "#000000" });
await expandPath();
assert((await getAllLayers()).filter((l) => l.kind === "Shape").length === 1, "0 입력 무시");
await docCloseWithoutSaving();
console.log("OUTLINE_STROKE OK");
