// Image Trace: 합성 이미지(빨강 사각형+구멍, 파랑 원, 초록 띠) → 색상별 Shape + 그룹, 렌더 비교
import { createDoc, docCloseWithoutSaving } from "../../src/lib/lib_doc";
import { getAllLayers, setVisible } from "../../src/lib/lib_layer";
import { getDocumentPixels, putPixelsAsLayer } from "../../src/lib/lib_pixels";
import { getShapeInfo } from "../../src/lib/lib_shape";
import { imageTrace } from "../../src/features/imageTrace";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("ASSERT: " + m); };
const W = 160, H = 120;
const data = new Uint8Array(W * H * 4);
// 4x4 수퍼샘플 커버리지로 안티에일리어싱된 도형 그리기
const inRed = (x: number, y: number) => x >= 10 && x < 80 && y >= 10 && y < 70 && !(x >= 30 && x < 50 && y >= 30 && y < 50);
const inBlue = (x: number, y: number) => (x - 115) ** 2 + (y - 60) ** 2 < 35 ** 2;
const inGreen = (x: number, y: number) => x >= 10 && x < 150 && y >= 100 && y < 112;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let r = 0, g = 0, b = 0, a = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
    if (inBlue(px, py)) { b += 255; a++; } else if (inRed(px, py)) { r += 255; a++; } else if (inGreen(px, py)) { g += 200; a++; }
  }
  const i = (y * W + x) * 4;
  if (a) { data[i] = r / a; data[i + 1] = g / a; data[i + 2] = b / a; data[i + 3] = (a / 16) * 255; }
}
await createDoc("trace", 200, 150);
const src = await putPixelsAsLayer({ width: W, height: H, data }, "art", 20, 10);
const before = await getDocumentPixels();
(globalThis as any).window = { prompt: (_t: string, d: string) => d }; // 기본값(10, 0.5) 그대로 확인
const t0 = Date.now();
await imageTrace();
console.log("trace ms", Date.now() - t0);
const layers = await getAllLayers();
const group = layers.find((l) => l.name === "art_trace");
assert(group && group.kind === "Group", "그룹 art_trace");
assert(layers.some((l) => l.id === src), "원본 유지");
const shapes = layers.filter((l) => l.parent === group!.id && l.kind === "Shape");
const fills: string[] = [];
for (const s of shapes) fills.push((await getShapeInfo(s.id)).fill);
console.log("shapes", shapes.length, fills.join(","));
assert(shapes.length === 3, "색상 3개");
for (const want of ["#ff0000", "#0000ff", "#00c800"]) assert(fills.includes(want), "색상 " + want);
await setVisible(src, false);
const after = await getDocumentPixels();
let inter = 0, uni = 0, colorErr = 0;
for (let i = 0; i < before.data.length; i += 4) {
  const x = before.data[i + 3] > 127, y = after.data[i + 3] > 127;
  if (x && y) { inter++; colorErr += Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1]) + Math.abs(before.data[i + 2] - after.data[i + 2]) > 60 ? 1 : 0; }
  if (x || y) uni++;
}
console.log(`IoU=${(inter / uni).toFixed(4)} colorMismatch=${(colorErr / inter).toFixed(4)}`);
assert(inter / uni > 0.97, "IoU");
assert(colorErr / inter < 0.03, "색 일치");
// 구멍(투명) 유지 확인: 원본 구멍 중앙 (20+40, 10+40)
assert(after.data[((10 + 40) * after.width + 20 + 40) * 4 + 3] < 128, "구멍 유지");
await docCloseWithoutSaving();
console.log("IMAGE_TRACE OK");
