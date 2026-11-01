// 레이어 CRUD/선택/이동/변환
import { exec, tryExec } from "../core/bridge";
import type { PcLayer, Bounds } from "./types";

/** 레이어 트리 (위→아래, 그룹은 children) */
export async function getLayerTree(document?: number): Promise<PcLayer[]> {
  const r = await exec<{ layers: PcLayer[] }>("layer.list", document === undefined ? {} : { document });
  return r.layers ?? [];
}

/** 모든 레이어를 평탄화한 목록 (위→아래, depth/parent 포함) */
export async function getAllLayers(document?: number): Promise<PcLayer[]> {
  const p: Record<string, unknown> = { flat: true };
  if (document !== undefined) p.document = document;
  const r = await exec<{ layers: PcLayer[] }>("layer.list", p);
  return r.layers ?? [];
}

/** 선택된 레이어 목록 (위→아래) */
export async function getSelectedLayers(): Promise<PcLayer[]> {
  return (await getAllLayers()).filter((l) => l.selected);
}

/** 활성 레이어 */
export async function getActiveLayer(): Promise<PcLayer | null> {
  return (await getAllLayers()).find((l) => l.active) ?? null;
}

/** 레이어 ID로 조회 */
export async function getLayerById(id: number): Promise<PcLayer | null> {
  return (await getAllLayers()).find((l) => l.id === id) ?? null;
}

/** 레이어 상세 속성 (document.inspect의 layers 항목: blend/opacity/fill/hasMask/effects 등) */
export async function getLayerDetail(id: number): Promise<any | null> {
  const d = await exec<any>("document.inspect");
  const walk = (ls: any[]): any | null => {
    for (const l of ls ?? []) {
      if (l.id === id) return l;
      const c = walk(l.children ?? l.layers);
      if (c) return c;
    }
    return null;
  };
  return walk(d.layers);
}

/** 레이어 ID로 선택 (add=true면 기존 선택에 추가) */
export function selectByLayerID(id: number, add = false) {
  return exec("layer.select", { layer: id, mode: add ? "add" : "replace" });
}

/** 여러 레이어 선택 */
export async function selectLayers(ids: number[]) {
  if (!ids.length) return;
  await selectByLayerID(ids[0]);
  for (const id of ids.slice(1)) await selectByLayerID(id, true);
}

/** 이름으로 레이어 선택 */
export function selectByName(name: string, occurrence?: number) {
  return exec("layer.select", occurrence === undefined ? { name } : { name, occurrence });
}

/** 레이어 복제 (같은 문서) → 새 레이어 ID */
export async function duplicateLayer(layerId?: number, name?: string): Promise<number> {
  const p: Record<string, unknown> = {};
  if (layerId !== undefined) p.layer = layerId;
  if (name) p.name = name;
  const r = await exec<{ layer: number }>("layer.duplicate", p);
  return r.layer;
}

/** 레이어를 다른 열린 문서로 복사 → 결과 */
export function copyLayersToDocument(document: number, layers?: number[], opts: { source?: number; center?: boolean; at?: [number, number] } = {}) {
  const p: Record<string, unknown> = { document, ...opts };
  if (layers) p.layers = layers;
  return exec<any>("layer.copyToDocument", p);
}

/** 레이어 삭제 (기본: 선택 레이어) */
export function deleteLayer(layerId?: number) {
  return exec("layer.delete", layerId === undefined ? {} : { layer: layerId });
}

/** 레이어 이름 변경 */
export function renameLayer(layerId: number, name: string) {
  return exec("layer.renameLayer", { layer: layerId, name });
}

/** 레이어 속성 변경 (opacity/fill: 0..1) */
export function setLayerProps(layerId: number | undefined, props: { name?: string; visible?: boolean; opacity?: number; fill?: number; blend?: string; locked?: boolean; clipped?: boolean }) {
  const p: Record<string, unknown> = { ...props };
  if (layerId !== undefined) p.layer = layerId;
  return exec("layer.setProps", p);
}

/** 표시/숨김 */
export const setVisible = (layerId: number, visible: boolean) => setLayerProps(layerId, { visible });

/** 새 픽셀 레이어 → ID */
export async function newLayer(name?: string, position: "above" | "below" = "above"): Promise<number> {
  const r = await exec<{ layer: number }>("layer.new.layer", { name, position });
  return r.layer;
}

/** 빈 그룹 생성 → ID */
export async function newGroup(name?: string): Promise<number> {
  const r = await exec<any>("layer.new.group", { name });
  return r?.layer ?? r?.group;
}

/** 선택 레이어 그룹화 → 그룹 ID (UXP makeGroupFromSelectLayers 대응) */
export async function makeGroupFromSelectLayers(groupName?: string): Promise<number> {
  const r = await exec<any>("layer.groupLayers", groupName ? { name: groupName } : {});
  return r?.layer ?? r?.group;
}

/** 그룹 해제 */
export const ungroup = (layerId?: number) => exec("layer.ungroupLayers", layerId === undefined ? {} : { layer: layerId });

/** 레이어를 대상 기준 위/아래/안으로 이동 */
export function moveLayerTo(layers: number[], target: number, position: "above" | "below" | "into" = "above") {
  return exec("layer.moveTo", { layers, target, position });
}

/** 레이어 픽셀 이동 (dx, dy) (UXP moveLayerOffset 대응) */
export function moveLayerOffset(layerId: number | undefined, dx: number, dy: number) {
  const p: Record<string, unknown> = { offset: [dx, dy] };
  if (layerId !== undefined) p.layer = layerId;
  return exec("layer.translate", p);
}

/** 레이어 bounds [x,y,w,h] */
export async function getLayerBounds(layerId: number): Promise<Bounds | null> {
  return (await getLayerById(layerId))?.bounds ?? null;
}

/** 레이어 퍼센트 스케일 (UXP layTransform 대응) */
export function layTransform(scaleX: number, scaleY: number, interpolation = "bicubic", layerId?: number) {
  const p: Record<string, unknown> = { scaleX, scaleY, interpolation };
  if (layerId !== undefined) p.layer = layerId;
  return exec("edit.transform", p);
}

/** 레이어를 지정 사각형으로 변형 (rect → quad) */
export function transformToRect(layerId: number, from: Bounds, to: Bounds, interpolation = "bicubic") {
  const [x, y, w, h] = to;
  return exec("edit.transform", {
    layer: layerId,
    rect: [from[0], from[1], from[0] + from[2], from[1] + from[3]],
    quad: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    interpolation,
  });
}

/** 래스터화 */
export const rasterizeLayer = (layerId?: number) => exec("layer.rasterize.layer", layerId === undefined ? {} : { layer: layerId });

/** 아래 레이어와 병합 */
export const mergeDown = (layerId?: number) => exec("layer.mergeDown", layerId === undefined ? {} : { layer: layerId });

/** 선택 레이어 병합 */
export const mergeLayers = () => exec("layer.mergeLayers", {});

/** 레이어 스타일 제거 */
export const clearLayerStyle = (layerId?: number) => tryExec("layer.layerStyle.clear", layerId === undefined ? {} : { layer: layerId });

/** 선택 영역을 새 레이어로 복사 → ID */
export async function layerViaCopy(): Promise<number | null> {
  const r = await exec<any>("layer.new.layerViaCopy", {});
  return r?.layer ?? null;
}

/** 영역 잘라내기 + 이름 부여 (UXP cutRegion 대응): 선택 레이어에서 t,l,b,r 영역을 새 레이어로 복사 */
export async function cutRegion(top: number, left: number, bottom: number, right: number, name: string): Promise<number | null> {
  await exec("select.rect", { x: left, y: top, width: right - left, height: bottom - top });
  const id = await layerViaCopy();
  await exec("select.deselect", {});
  if (id !== null) await renameLayer(id, name);
  return id;
}

/** 스마트 오브젝트로 변환 */
export const convertToSmartObject = (layerId?: number) => exec("layer.smartObjects.convertToSmartObject", layerId === undefined ? {} : { layer: layerId });

/** 범용 명령 실행 (UXP actionCommands 대응) */
export const actionCommands = (command: string, params: Record<string, unknown> = {}) => exec(command, params);

/** 트리 순회 (위→아래, 깊이 우선) */
export function walkLayers(tree: PcLayer[], fn: (l: PcLayer, parent: PcLayer | null) => void, parent: PcLayer | null = null) {
  for (const l of tree) {
    fn(l, parent);
    if (l.children) walkLayers(l.children, fn, l);
  }
}

export const isGroup = (l: PcLayer) => l.kind === "Group" || !!l.children;
