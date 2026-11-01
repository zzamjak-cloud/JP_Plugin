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
  const r = await exec<{ document: number }>("layer.duplicate", params);
  return r.document;
}

/** 문서 활성화 */
export const activateDoc = (document: number) => exec("document.activate", { document });

/** 저장하지 않고 문서 닫기 (기본: 활성 문서) */
export async function docCloseWithoutSaving(document?: number): Promise<void> {
  await exec("file.close", document === undefined ? {} : { document });
  // 저장 확인 창이 뜬 경우 '저장 안 함'으로 응답
  const ui = await pcCall<any>("ui.inspect").catch(() => null);
  if (ui?.dialogs?.some((d: any) => d.id === "discard")) {
    await pcCall("ui.dialog.confirm", { dialog: "discard", choice: "dontSave" });
  }
}

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
  return r?.document ?? (await listDocuments()).active ?? 0;
}

/** 모든 레이어 병합 */
export const flatten = () => exec("layer.flattenImage", {});
