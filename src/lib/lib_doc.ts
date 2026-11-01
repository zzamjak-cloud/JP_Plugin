// 문서 생성/관리
import { exec, pcCall, tryExec } from "../core/bridge";
import type { PcDocInfo } from "./types";

/** 활성 문서 정보 (document.inspect). 문서가 없으면 null */
export async function getDocInfo(document?: number): Promise<PcDocInfo | null> {
  try {
    return await exec<PcDocInfo>("document.inspect", document === undefined ? {} : { document });
  } catch {
    return null;
  }
}

/** 활성 문서가 없으면 예외 */
export async function requireDoc(): Promise<PcDocInfo> {
  const d = await getDocInfo();
  if (!d) throw new Error("열린 문서가 없습니다.");
  return d;
}

/** 열린 문서 목록 */
export async function listDocuments(): Promise<{ active: number | null; documents: { index: number; name: string; path?: string | null }[] }> {
  const ui = await pcCall<any>("ui.inspect");
  const docs = ui.documents ?? ui.session?.documents ?? [];
  const active = ui.activeDocument ?? ui.session?.active ?? null;
  return { active, documents: docs.map((d: any, i: number) => ({ index: d.index ?? i, name: d.name, path: d.path })) };
}

/** 새 문서 생성 → 문서 인덱스 */
export async function createDoc(
  name: string,
  width: number,
  height: number,
  resolution = 72,
  mode: "rgb" | "gray" | "cmyk" | "lab" = "rgb",
  background: "white" | "black" | "transparent" | "background" | string = "transparent",
): Promise<number> {
  const r = await exec<{ document: number }>("file.new", { name, width, height, resolution, mode, depth: 8, background });
  return r.document;
}

/** 선택 레이어들을 새 문서로 복제 (UXP createDocCopyLayers 대응) → 새 문서 인덱스 */
export async function createDocCopyLayers(docName: string, layerId?: number): Promise<number> {
  const params: Record<string, unknown> = { document: "new", documentName: docName };
  if (layerId !== undefined) params.layer = layerId;
  const r = await exec<{ document?: number }>("layer.duplicate", params);
  if (typeof r?.document !== "number") throw new Error("레이어 복제 문서를 만들지 못했습니다.");
  return r.document;
}

/** 문서 활성화 */
export const activateDoc = (document: number) => exec("document.activate", { document });

// PSD/pcraft로 저장하면 PhotoCraft가 문서 이름을 저장 파일명으로 바꾼다. 닫기 전 이름 확인에서
// 원래 이름으로도 찾을 수 있도록 "저장 후 이름 → 저장 전 이름"을 기록한다.
const renamedBySave = new Map<string, string>();
export function noteDocRenamed(before: string, after: string) {
  if (before && after && before !== after) renamedBySave.set(after, before);
}
function nameMatches(actual: string, expected: string): boolean {
  let n: string | undefined = actual;
  for (let i = 0; n !== undefined && i < 8; i++) {
    if (n === expected) return true;
    n = renamedBySave.get(n);
  }
  return false;
}

/** 인덱스의 문서 이름 (없으면 null) */
export async function docNameAt(index: number): Promise<string | null> {
  const { documents } = await listDocuments();
  return documents.find((d) => d.index === index)?.name ?? null;
}

/**
 * 저장하지 않고 문서 닫기 (기본: 활성 문서).
 * 주의: 제어 채널의 file.close는 미저장 문서도 확인 없이 닫는다. 그래서 대상 문서가 존재하는지,
 * expectedName이 주어지면 이름이 일치하는지 확인한 뒤에만 닫는다(인덱스가 밀려 사용자 문서를 닫는 사고 방지).
 */
export async function docCloseWithoutSaving(document?: number, expectedName?: string): Promise<void> {
  const { active, documents } = await listDocuments();
  const idx = document ?? active;
  if (idx === null || idx === undefined) return;
  const doc = documents.find((d) => d.index === idx);
  if (!doc) throw new Error(`닫을 문서(${idx})를 찾을 수 없습니다.`);
  if (expectedName !== undefined && !nameMatches(doc.name, expectedName)) {
    throw new Error(`문서 순서가 바뀌어 "${doc.name}" 문서를 닫지 않았습니다 (예상: "${expectedName}").`);
  }
  await exec("file.close", { document: idx });
}

/** 작업용 임시 문서 닫기: 생성 직후 기록한 이름과 일치할 때만 닫는다 */
export const closeTempDoc = (index: number, name: string) => docCloseWithoutSaving(index, name);

/** 이미지 크기 변경 */
export function docResize(width: number, height: number, resample = "bicubic") {
  return exec("image.imageSize", { width: Math.round(width), height: Math.round(height), resample });
}

/** 퍼센트로 이미지 크기 변경 */
export function docResizePercent(percent: number, resample = "bicubic") {
  return exec("image.imageSize", { percent, resample });
}

/** 캔버스 크기 변경 */
export function canvasSize(width: number, height: number, anchor = "center", extensionColor = "transparent") {
  return exec("image.canvasSize", { width: Math.round(width), height: Math.round(height), anchor, extensionColor });
}

/** 투명 영역 트림 */
export function trimTransparent() {
  return tryExec("image.trim", { basedOn: "transparent" });
}

/** 자르기 */
export function cropDoc(x: number, y: number, width: number, height: number) {
  return exec("image.crop", { x, y, width, height, deleteCroppedPixels: true });
}

/** 이미지 복제 → 새 문서 인덱스 */
export async function duplicateDoc(name: string, mergedOnly = false): Promise<number> {
  const r = await exec<any>("image.duplicate", { name, mergedOnly });
  if (typeof r?.document !== "number") throw new Error("문서 복제에 실패했습니다.");
  return r.document;
}

/** 모든 레이어 병합 */
export const flatten = () => exec("layer.flattenImage", {});

/** 타임라인 정보 ({current, duration, fps, …}). 타임라인이 없거나 실패하면 null */
export async function getTimelineInfo(): Promise<{ current: number; duration: number; fps: number } | null> {
  const r = await tryExec<any>("timeline.info", {});
  return r?.timeline ?? null;
}

/** 타임라인 현재 프레임 지정 */
export const setTimelineFrame = (frame: number) => exec("timeline.setFrame", { frame });
