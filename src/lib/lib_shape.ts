// Shape/Path 생성·읽기 (CAT lib_shape.js 대응)
// CAT(Photoshop) pathContents 포맷과 PhotoCraft path 포맷을 상호 변환한다.
//  - CAT:  pathComponents[{shapeOperation, subpathListKey[{closedSubpath, points[{anchor, forward, backward, smooth}]}]}]
//  - PhotoCraft: {subpaths:[{closed, op, knots:[{anchor:[x,y], in:[x,y], out:[x,y], smooth}]}]}
//  forward(다음 점으로 나가는 핸들) = out, backward(이전 점에서 들어오는 핸들) = in.
//  CAT의 컴포넌트 하나(여러 subpath)는 PhotoCraft에서 첫 subpath op + 나머지 "join"으로 표현한다
//  ("join" subpath는 같은 컴포넌트로 함께 채워져 역방향 내부 루프가 구멍이 된다).
import { exec, tryExec } from "../core/bridge";

export type Vec2 = [number, number];
export interface PcKnot {
  anchor: Vec2;
  in: Vec2;
  out: Vec2;
  smooth?: boolean;
}
export type PcPathOp = "combine" | "subtract" | "intersect" | "exclude" | "join";
export interface PcSubpath {
  closed: boolean;
  op?: PcPathOp;
  knots: (PcKnot | Vec2)[];
}
export interface PcPath {
  subpaths: PcSubpath[];
  fillRule?: "nonzero" | "evenodd";
  inverted?: boolean;
}

/** CAT pathContents (batchPlay pathClass) — 구조가 느슨해 any로 다룬다 */
export type CatPathContents = any;

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ShapeOptions {
  fillEnabled?: boolean;
  strokeEnabled?: boolean;
  fillColor?: RGB;
  strokeColor?: RGB;
  strokeWidth?: number;
  name?: string;
}

export interface StrokeSettings {
  enabled: boolean;
  width: number;
  align: "inner" | "outer" | "center";
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  miterLimit: number;
  color: RGB;
}

const CAT_TO_PC_OP: Record<string, PcPathOp> = {
  add: "combine",
  subtract: "subtract",
  xor: "exclude",
  interfaceIconFrameDimmed: "intersect",
  intersect: "intersect",
};
const PC_TO_CAT_OP: Record<string, string> = {
  combine: "add",
  subtract: "subtract",
  exclude: "xor",
  intersect: "interfaceIconFrameDimmed",
};

// ==================== 색상 유틸 ====================

export function rgbToHex(c: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** "#rrggbb" | [r,g,b,a] → RGB (해석 불가면 null) */
export function parsePcColor(v: unknown): RGB | null {
  if (typeof v === "string" && /^#[0-9a-f]{6}/i.test(v)) {
    return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16) };
  }
  if (Array.isArray(v) && v.length >= 3) return { r: Math.round(v[0]), g: Math.round(v[1]), b: Math.round(v[2]) };
  return null;
}

// ==================== 포맷 변환 ====================

// batchPlay 좌표값({_unit,_value} 또는 숫자) → 숫자
function unitVal(o: any): number {
  if (o === undefined || o === null) return 0;
  if (typeof o === "number") return o;
  if (o._value !== undefined) return o._value;
  return 0;
}

function catPt(x: number, y: number) {
  return { _obj: "paint", horizontal: { _unit: "pixelsUnit", _value: x }, vertical: { _unit: "pixelsUnit", _value: y } };
}

/** CAT pathContents → PhotoCraft path */
export function catPathToPcPath(pathContents: CatPathContents): PcPath {
  const subpaths: PcSubpath[] = [];
  for (const comp of pathContents?.pathComponents ?? []) {
    const op = CAT_TO_PC_OP[comp.shapeOperation?._value ?? "add"] ?? "combine";
    (comp.subpathListKey ?? []).forEach((sp: any, i: number) => {
      const knots: PcKnot[] = (sp.points ?? []).map((p: any) => {
        const ax = unitVal(p.anchor?.horizontal);
        const ay = unitVal(p.anchor?.vertical);
        return {
          anchor: [ax, ay] as Vec2,
          out: (p.forward ? [unitVal(p.forward.horizontal), unitVal(p.forward.vertical)] : [ax, ay]) as Vec2,
          in: (p.backward ? [unitVal(p.backward.horizontal), unitVal(p.backward.vertical)] : [ax, ay]) as Vec2,
          smooth: !!p.smooth,
        };
      });
      subpaths.push({ closed: sp.closedSubpath ?? false, op: i === 0 ? op : "join", knots });
    });
  }
  return { subpaths };
}

/** PhotoCraft path → CAT pathContents ("join" subpath는 이전 컴포넌트에 합친다) */
export function pcPathToCatPath(path: PcPath): CatPathContents {
  const comps: any[] = [];
  for (const sp of path?.subpaths ?? []) {
    const points = sp.knots.map((k) => {
      const kk: PcKnot = Array.isArray(k) ? { anchor: k, in: k, out: k, smooth: false } : k;
      return {
        _obj: "pathPoint",
        anchor: catPt(kk.anchor[0], kk.anchor[1]),
        forward: catPt(kk.out[0], kk.out[1]),
        backward: catPt(kk.in[0], kk.in[1]),
        smooth: !!kk.smooth,
      };
    });
    const sub = { _obj: "subpathsList", closedSubpath: sp.closed !== false, points };
    if (sp.op === "join" && comps.length) {
      comps[comps.length - 1].subpathListKey.push(sub);
    } else {
      const op = PC_TO_CAT_OP[sp.op ?? "combine"] ?? "add";
      comps.push({ _obj: "pathComponent", shapeOperation: { _enum: "shapeOperation", _value: op }, subpathListKey: [sub] });
    }
  }
  return { _obj: "pathClass", pathComponents: comps };
}

// CAT/PhotoCraft 어느 포맷이든 PhotoCraft path로
function toPcPath(p: CatPathContents | PcPath): PcPath {
  return p && Array.isArray((p as PcPath).subpaths) ? (p as PcPath) : catPathToPcPath(p);
}

// ==================== Shape 생성/편집 ====================

/**
 * pathContents(CAT 포맷 또는 PhotoCraft path)로 Shape Layer 생성 → 새 레이어 ID.
 * 기본: 검정 채우기만 활성. stroke는 CAT과 같이 round cap/round join/center 정렬.
 */
export async function createShapeFromPathContents(pathContents: CatPathContents | PcPath, options: ShapeOptions = {}): Promise<number> {
  const opts = {
    fillEnabled: true,
    strokeEnabled: false,
    fillColor: { r: 0, g: 0, b: 0 },
    strokeColor: { r: 0, g: 0, b: 0 },
    strokeWidth: 1,
    ...options,
  };
  const params: Record<string, unknown> = {
    kind: "path",
    path: toPcPath(pathContents),
    fill: opts.fillEnabled ? rgbToHex(opts.fillColor) : null,
    stroke: opts.strokeEnabled
      ? { width: opts.strokeWidth, color: rgbToHex(opts.strokeColor), opacity: 100, align: "center", cap: "round", join: "round" }
      : null,
  };
  if (opts.name) params.name = opts.name;
  const r = await exec<{ layer: number }>("shape.create", params);
  return r.layer;
}

/** 기존 Shape Layer에 path를 추가 (op: combine/subtract/intersect/exclude) */
export function addPathToShape(layerId: number, path: CatPathContents | PcPath, op: Exclude<PcPathOp, "join"> = "combine") {
  return exec("shape.create", { kind: "path", path: toPcPath(path), addTo: layerId, op });
}

/** Shape Layer의 path 교체 */
export function setShapePath(path: CatPathContents | PcPath, layerId?: number) {
  const p: Record<string, unknown> = { path: toPcPath(path) };
  if (layerId !== undefined) p.layer = layerId;
  return exec("shape.edit", p);
}

/** Shape Layer 채우기 색상 변경 (기본: 활성 레이어) */
export function setShapeColor(r: number, g: number, b: number, layerId?: number) {
  const p: Record<string, unknown> = { fill: rgbToHex({ r, g, b }) };
  if (layerId !== undefined) p.layer = layerId;
  return exec("shape.edit", p);
}

/** Shape Layer stroke 설정 (null이면 제거) */
export function setShapeStroke(
  stroke: { width?: number; color?: RGB; align?: "inside" | "center" | "outside"; cap?: string; join?: string } | null,
  layerId?: number,
) {
  const p: Record<string, unknown> = {
    stroke: stroke && { ...stroke, color: stroke.color ? rgbToHex(stroke.color) : undefined },
  };
  if (layerId !== undefined) p.layer = layerId;
  return exec("shape.edit", p);
}

// ==================== Shape 읽기 ====================

/** shape.info 원본 응답 ({layer,name,kind,path,fill,stroke,live,bounds}). Shape가 아니면 null */
export function getShapeInfo(layerId?: number): Promise<any | null> {
  return tryExec<any>("shape.info", layerId === undefined ? {} : { layer: layerId });
}

/** Shape Layer 채우기 색상 (단색이 아니거나 읽기 실패 시 흰색) */
export async function getShapeFillColor(layerId?: number): Promise<RGB> {
  const info = await getShapeInfo(layerId);
  return parsePcColor(info?.fill) ?? { r: 255, g: 255, b: 255 };
}

/** Shape/Vector Mask의 PhotoCraft path (없으면 null) */
export async function getShapePath(layerId?: number): Promise<PcPath | null> {
  const info = await getShapeInfo(layerId);
  if (info?.path?.subpaths) return info.path as PcPath;
  const vm = await tryExec<any>("layer.vectorMask.info", layerId === undefined ? {} : { layer: layerId });
  return vm?.path?.subpaths ? (vm.path as PcPath) : null;
}

/** Shape Layer의 Vector Mask path 데이터 (CAT pathContents 포맷, 없으면 null) */
export async function getShapePathData(layerId?: number): Promise<CatPathContents | null> {
  const p = await getShapePath(layerId);
  return p ? pcPathToCatPath(p) : null;
}

/** Shape Layer의 Stroke 설정 (Shape가 아니면 null, stroke 없으면 enabled=false) */
export async function getStrokeSettings(layerId?: number): Promise<StrokeSettings | null> {
  const info = await getShapeInfo(layerId);
  if (!info) return null;
  const s = info.stroke;
  if (!s) return { enabled: false, width: 0, align: "center", cap: "butt", join: "miter", miterLimit: 100, color: { r: 255, g: 255, b: 255 } };
  const align = s.align === "inside" ? "inner" : s.align === "outside" ? "outer" : "center";
  const cap = s.cap === "round" || s.cap === "square" ? s.cap : "butt";
  const join = s.join === "round" || s.join === "bevel" ? s.join : "miter";
  return {
    enabled: (s.width ?? 0) > 0,
    width: s.width ?? 1,
    align,
    cap,
    join,
    miterLimit: s.miterLimit ?? 100,
    color: parsePcColor(s.fill ?? s.color) ?? { r: 255, g: 255, b: 255 },
  };
}

// ==================== Work Path ====================

/** 선택 영역 → Work Path (tolerance 0.5~10 px) */
export function makeWorkPath(tolerance = 2) {
  return exec("select.toWorkPath", { tolerance: Math.max(0.5, Math.min(10, tolerance)) });
}

/** Work Path 데이터 (PhotoCraft path, 없으면 null) */
export async function getWorkPath(): Promise<PcPath | null> {
  // path.info "work"는 Work Path가 없으면 활성 레이어 path를 돌려주므로 path.list로 존재부터 확인
  const list = await tryExec<any>("path.list", {});
  if (!list?.workPath) return null;
  const r = await tryExec<any>("path.info", { name: "work" });
  return r?.path?.subpaths ? (r.path as PcPath) : null;
}

/** 이름으로 path 데이터를 CAT pathContents 포맷으로 (기본: Work Path) */
export async function getWorkPathContents(name = "work"): Promise<CatPathContents | null> {
  if (name === "work") {
    const p = await getWorkPath();
    return p ? pcPathToCatPath(p) : null;
  }
  const r = await tryExec<any>("path.info", { name });
  return r?.path?.subpaths ? pcPathToCatPath(r.path) : null;
}

/** Work Path(또는 이름 지정 path) 설정 */
export function setWorkPath(path: CatPathContents | PcPath, name = "work") {
  return exec("path.set", { name, path: toPcPath(path) });
}

/** Work Path 삭제 */
export function deleteWorkPath() {
  return tryExec("path.delete", { name: "work" });
}

/** Work Path → 단색 Shape Layer (CAT makeLayerFromPath 대응) → 새 레이어 ID (Work Path 없으면 null) */
export async function makeLayerFromPath(r: number, g: number, b: number): Promise<number | null> {
  const p = await getWorkPath();
  if (!p) return null;
  return createShapeFromPathContents(p, { fillColor: { r, g, b } });
}

/** 선택 영역 → Work Path → Shape Layer (CAT convertPathToShape 대응) → 새 레이어 ID */
export async function convertPathToShape(r: number, g: number, b: number, tolerance = 2): Promise<number | null> {
  await makeWorkPath(tolerance);
  const id = await makeLayerFromPath(r, g, b);
  await deleteWorkPath();
  return id;
}
