// lib_shape: CAT pathContents ↔ PhotoCraft path 변환, 커브 핸들 방향, 컴포넌트(join) 구멍, 색상/stroke 읽기 검증
import { createDoc, docCloseWithoutSaving } from "../../src/lib/lib_doc";
import { getDocumentPixels } from "../../src/lib/lib_pixels";
import {
  catPathToPcPath, pcPathToCatPath, createShapeFromPathContents, getShapePathData, getShapeFillColor,
  getStrokeSettings, setShapeColor, makeWorkPath, getWorkPath, deleteWorkPath,
} from "../../src/lib/lib_shape";
import { exec } from "../../src/core/bridge";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("ASSERT: " + m); };
const pt = (x: number, y: number) => ({ _obj: "paint", horizontal: { _unit: "pixelsUnit", _value: x }, vertical: { _unit: "pixelsUnit", _value: y } });
const P = (a: [number, number], f: [number, number], b: [number, number]) => ({ _obj: "pathPoint", anchor: pt(...a), forward: pt(...f), backward: pt(...b), smooth: true });

await createDoc("shape_test", 200, 200);
// 위로 볼록한 돔: 첫 점 forward(나가는 핸들)=위쪽, 둘째 점 backward(들어오는 핸들)=위쪽
const dome = {
  _obj: "pathClass",
  pathComponents: [{
    _obj: "pathComponent", shapeOperation: { _enum: "shapeOperation", _value: "add" },
    subpathListKey: [{ _obj: "subpathsList", closedSubpath: true, points: [P([20, 100], [20, 20], [20, 100]), P([180, 100], [180, 100], [180, 20])] }],
  }],
};
const pc = catPathToPcPath(dome);
assert(JSON.stringify(pc.subpaths[0].knots[0]) === JSON.stringify({ anchor: [20, 100], out: [20, 20], in: [20, 100], smooth: true }), "forward→out 변환");
const id = await createShapeFromPathContents(dome, { fillColor: { r: 255, g: 0, b: 0 } });
const back = await getShapePathData(id);
const p0 = back.pathComponents[0].subpathListKey[0].points[0];
assert(p0.forward.vertical._value === 20 && p0.backward.vertical._value === 100, "왕복 후 forward/backward 유지");
let img = await getDocumentPixels();
const px = (x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
assert(px(100, 60)[0] === 255 && px(100, 60)[1] === 0, "돔 위쪽(100,60) 빨강 = 커브가 위로 볼록");
assert(px(100, 120)[1] === 255 || px(100, 120)[3] === 0, "돔 아래(100,120) 비어있음");
assert(JSON.stringify(await getShapeFillColor(id)) === JSON.stringify({ r: 255, g: 0, b: 0 }), "fill 색 읽기");
await setShapeColor(0, 0, 255, id);
assert((await getShapeFillColor(id)).b === 255, "setShapeColor");
assert((await getStrokeSettings(id))!.enabled === false, "stroke 없음");

// 한 컴포넌트 안 역방향 내부 루프 = 구멍 (CAT 컴포넌트 의미 보존)
const sq = (x0: number, y0: number, x1: number, y1: number, rev = false) => {
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][];
  if (rev) pts.reverse();
  return { _obj: "subpathsList", closedSubpath: true, points: pts.map((p) => P(p, p, p)) };
};
const ring = { _obj: "pathClass", pathComponents: [{ _obj: "pathComponent", shapeOperation: { _value: "add" }, subpathListKey: [sq(20, 120, 100, 190), sq(40, 140, 80, 170, true)] }] };
const ringId = await createShapeFromPathContents(ring, { fillEnabled: false, strokeEnabled: true, strokeWidth: 3, strokeColor: { r: 0, g: 255, b: 0 }, fillColor: { r: 0, g: 0, b: 0 } });
const st = await getStrokeSettings(ringId);
assert(st!.enabled && st!.width === 3 && st!.color.g === 255 && st!.cap === "round" && st!.join === "round", "stroke 설정 " + JSON.stringify(st));
const ring2 = await createShapeFromPathContents(ring, { fillColor: { r: 0, g: 128, b: 0 }, name: "ring" });
img = await getDocumentPixels();
assert(px(30, 130)[1] === 128 && px(60, 155)[3] === 0, "구멍 유지");
const rd = pcPathToCatPath((await exec<any>("shape.info", { layer: ring2 })).path);
assert(rd.pathComponents.length === 1 && rd.pathComponents[0].subpathListKey.length === 2, "join → 단일 컴포넌트 복원");

// Work Path
await exec("select.rect", { x: 120, y: 120, width: 50, height: 40 });
await makeWorkPath(1);
const wp = await getWorkPath();
assert(wp && wp.subpaths.length === 1, "work path 생성");
await deleteWorkPath();
assert((await getWorkPath()) === null, "work path 삭제");
await exec("select.deselect", {});
await docCloseWithoutSaving();
console.log("LIB_SHAPE OK");
