// Auto Paste PNG (CAT autoPastePng.js 대응).
// CAT은 Photoshop placeEvent(PNG 드래그/Place)를 받아 스마트 오브젝트를 1:1 픽셀 레이어로 바꾼다.
// PhotoCraft 제어 채널엔 이벤트 구독이 없으므로 주기적으로 document.inspect(revision)를 비교해
// 새로 생긴 PNG 스마트 오브젝트 레이어를 감지하고 같은 변환을 수행한다.
import { tryRunExclusive } from "../core/bridge";
import * as fsx from "../core/fs";
import { executeWithHistoryGrouping } from "../lib/lib";
import { getDocInfo, listDocuments, activateDoc, docCloseWithoutSaving, docNameAt } from "../lib/lib_doc";
import {
  editSmartObjectContents,
  selectAllLayers,
  copyLayersToDocument,
  getLayerBounds,
  moveLayerOffset,
  renameLayer,
  deleteLayer,
  selectByLayerID,
  isSmartObject,
} from "../lib/lib_layer";

const ENABLED_KEY = "autoPastePngEnabledV1";

/** 기본 활성. "false"만 비활성으로 본다 */
export function isAutoPastePngEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}
export function setAutoPastePngEnabled(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    /* 저장 실패 무시 */
  }
}

/** document.inspect 레이어 트리 평탄화 */
function flatten(layers: any[] | undefined, out: any[] = []): any[] {
  for (const l of layers ?? []) {
    out.push(l);
    flatten(l.children ?? l.layers, out);
  }
  return out;
}

/** 원본 파일이 PNG인 스마트 오브젝트인지 (smartSource.fileName 기준) */
export const isPlacedPng = (layer: any) => /\.png$/i.test(layer?.smartSource?.fileName ?? "");

/**
 * 스마트 오브젝트를 원본 해상도 픽셀 레이어로 교체 → 새 레이어 ID.
 * 내용 편집 문서를 열어 레이어를 대상 문서로 복사하고, 원래 중심에 정수 좌표로 맞춘 뒤 원본 SO를 삭제한다.
 */
export async function convertPlacedPngLayer(layerId: number, fileName: string): Promise<number | null> {
  const { active: target, documents } = await listDocuments();
  if (target === null) return null;
  const targetName = documents.find((d) => d.index === target)?.name ?? "";
  const b = await getLayerBounds(layerId);
  if (!b) return null;
  const cx = b[0] + b[2] / 2;
  const cy = b[1] + b[3] / 2;

  return executeWithHistoryGrouping(async () => {
    const { document: contents } = await editSmartObjectContents(layerId);
    const contentsName = (await docNameAt(contents)) ?? "";
    let newId: number | null = null;
    try {
      await selectAllLayers();
      const r = await copyLayersToDocument(target, undefined, { source: contents });
      newId = r?.layers?.[0] ?? r?.layer ?? null;
    } finally {
      await docCloseWithoutSaving(contents, contentsName);
      await activateDoc(target).catch(() => {});
    }
    if (newId === null) return null;
    // 그사이 사용자가 다른 문서로 전환했다면 다른 문서의 레이어를 건드리지 않도록 중단
    if ((await docNameAt(target)) !== targetName || (await listDocuments()).active !== target) return null;
    const nb = await getLayerBounds(newId);
    if (nb) {
      const tx = Math.round(cx - nb[2] / 2);
      const ty = Math.round(cy - nb[3] / 2);
      if (tx !== nb[0] || ty !== nb[1]) await moveLayerOffset(newId, tx - nb[0], ty - nb[1]);
    }
    await renameLayer(newId, fsx.stem(fileName));
    await deleteLayer(layerId);
    await selectByLayerID(newId);
    return newId;
  });
}

export interface AutoPasteState {
  docKey: string | null;
  revision: number;
  /** 이미 본 스마트 오브젝트 레이어 ID */
  known: Set<number>;
  busy: boolean;
}

export const newAutoPasteState = (): AutoPasteState => ({ docKey: null, revision: -1, known: new Set(), busy: false });

/**
 * 폴링 1회: 활성 문서의 revision이 바뀌었으면 새 스마트 오브젝트를 찾아 accept 조건(기본: PNG 원본)을 만족하면 변환.
 * 처음 보는 문서는 기존 레이어만 기록한다. → 변환된 새 레이어 ID
 */
export async function autoPasteTick(state: AutoPasteState, accept: (layer: any) => boolean = isPlacedPng): Promise<number[]> {
  if (state.busy) return [];
  state.busy = true;
  try {
    // 문서가 없을 때 document.inspect를 부르면 PhotoCraft 상태바에 오류가 남으므로 먼저 문서 유무를 확인한다
    const d = (await listDocuments()).documents.length ? await getDocInfo() : null;
    if (!d) {
      state.docKey = null;
      return [];
    }
    const key = `${d.name}|${d.path ?? ""}`;
    const sos = flatten(d.layers).filter((l) => isSmartObject(l));
    if (key !== state.docKey) {
      state.docKey = key;
      state.revision = d.revision;
      state.known = new Set(sos.map((l) => l.id));
      return [];
    }
    if (d.revision === state.revision) return [];
    state.revision = d.revision;
    const fresh = sos.filter((l) => !state.known.has(l.id));
    for (const l of sos) state.known.add(l.id);
    const out: number[] = [];
    for (const l of fresh) {
      if (!accept(l)) continue;
      const id = await convertPlacedPngLayer(l.id, l.smartSource?.fileName ?? l.name);
      if (id !== null) out.push(id);
    }
    if (out.length) state.revision = (await getDocInfo())?.revision ?? state.revision;
    return out;
  } finally {
    state.busy = false;
  }
}

/** 주기적 감지 시작 → 중지 함수. 연결 끊김 등 오류는 조용히 무시한다 */
export function startAutoPastePngPolling(intervalMs = 1000): () => void {
  const state = newAutoPasteState();
  const timer = setInterval(() => {
    // 사용자가 실행한 기능이 진행 중이면 이번 주기는 건너뛴다
    tryRunExclusive(() => autoPasteTick(state)).catch(() => {
      state.busy = false;
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
