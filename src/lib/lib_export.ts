// 파일 열기/저장/내보내기. PhotoCraft는 자동화 루트 밖 경로를 거부하므로
// 루트 밖 경로는 루트 안 임시 폴더를 거쳐 복사/이동한다.
import { exec, pcCall, getConfig } from "../core/bridge";
import * as fsx from "../core/fs";
import { listDocuments, closeTempDoc, noteDocRenamed } from "./lib_doc";

let tmpCounter = 0;

/** 자동화 루트 안의 임시 폴더 */
export async function workTempDir(): Promise<string> {
  const cfg = await getConfig();
  return fsx.tempDir(cfg.root);
}

/** 루트 안의 고유 임시 파일 경로 */
export async function tempFile(extension: string): Promise<string> {
  return fsx.join(await workTempDir(), `t${Date.now()}_${tmpCounter++}.${extension}`);
}

async function insideRoot(path: string): Promise<boolean> {
  const root = (await getConfig()).root.replace(/\/+$/, "");
  // 상위 경로 이동이 섞인 경로는 PhotoCraft가 거부하므로 루트 밖으로 취급(임시 폴더 경유)
  if (path.includes("/../") || path.includes("/./")) return false;
  return path === root || path.startsWith(root + "/");
}

/** 파일 이동 — 대상이 있으면 덮어쓴다 (다른 볼륨이면 복사 후 삭제) */
async function moveFile(from: string, to: string) {
  try {
    await fsx.rename(from, to);
  } catch {
    await fsx.copy(from, to);
    await fsx.remove(from);
  }
}

export interface SaveOptions {
  /** JPG 품질 0~100 (UXP Save for Web 기준). PhotoCraft 0~12 스케일로 변환 */
  quality?: number;
  jpegFormat?: "baseline" | "optimized" | "progressive";
  tgaBits?: 24 | 32;
}

const LAYERED = new Set(["psd", "psb", "pcraft"]);

async function activeDocName(): Promise<string> {
  const { active, documents } = await listDocuments();
  return documents.find((d) => d.index === active)?.name ?? "";
}

/**
 * 활성 문서를 경로에 저장/내보내기 (확장자로 포맷 결정: png/jpg/gif/psd/pcraft/webp/tif …).
 * 기존 파일은 저장이 성공한 뒤에만 교체한다(실패 시 원본 보존).
 * - 평탄 포맷: 루트 안 임시 파일로 저장 → 대상 위치로 이동(덮어쓰기). 문서 경로는 바뀌지 않는다.
 * - 레이어 포맷(psd/pcraft)이고 루트 안: PhotoCraft가 문서 경로를 저장 위치로 바꾸므로 대상에 직접 저장하되,
 *   기존 파일은 백업으로 옮겨 두었다가 성공하면 삭제, 실패하면 복원한다.
 */
export async function saveActiveDocAs(path: string, opts: SaveOptions = {}): Promise<void> {
  const params: Record<string, unknown> = {};
  if (opts.quality !== undefined) params.quality = Math.max(0, Math.min(12, Math.round((opts.quality / 100) * 12)));
  if (opts.jpegFormat) params.jpegFormat = opts.jpegFormat;
  if (opts.tgaBits) params.tgaBits = opts.tgaBits;
  await fsx.mkdir(fsx.dirname(path));
  const extension = fsx.ext(path) || "png";
  if (LAYERED.has(extension) && (await insideRoot(path))) {
    const before = await activeDocName();
    const backup = (await fsx.exists(path)) ? `${path}.jpbak-${Date.now()}` : null;
    if (backup) await fsx.rename(path, backup);
    try {
      await pcCall("app.save", { ...params, path });
    } catch (e) {
      if (backup) {
        if (await fsx.exists(path)) await fsx.remove(path).catch(() => {});
        await fsx.rename(backup, path);
      }
      throw e;
    }
    if (backup) await fsx.remove(backup).catch(() => {});
    noteDocRenamed(before, await activeDocName());
    return;
  }
  const before = LAYERED.has(extension) ? await activeDocName() : "";
  const tmp = await tempFile(extension);
  await pcCall("app.save", { ...params, path: tmp });
  if (before) noteDocRenamed(before, await activeDocName());
  await moveFile(tmp, path);
}

/** 열린 문서들의 파일 경로(절대) */
export async function openDocumentPaths(): Promise<string[]> {
  const root = (await getConfig()).root;
  const { documents } = await listDocuments();
  return documents.filter((d) => d.path).map((d) => (d.path!.startsWith("/") ? d.path! : fsx.join(root, d.path!)));
}

/** 내보내기 대상이 열린 문서의 원본 파일이면 거부 (예: Button.psd 안의 "Button" 그룹을 같은 폴더로 내보낼 때) */
export async function ensureNotOpenDocumentPath(path: string): Promise<void> {
  if ((await openDocumentPaths()).includes(path)) {
    throw new Error(`"${fsx.basename(path)}"은(는) 열려 있는 문서의 원본 파일이라 덮어쓰지 않았습니다. 다른 내보내기 폴더를 선택하세요.`);
  }
}

/** PNG-24 저장 (UXP saveForWebPNG 대응) */
export async function saveForWebPNG(folder: string, name: string) {
  const path = fsx.join(folder, `${name}.png`);
  await ensureNotOpenDocumentPath(path);
  await saveActiveDocAs(path);
}
/** JPG 저장, 기본 품질 60 (UXP saveForWebJPG 대응) */
export async function saveForWebJPG(folder: string, name: string, quality = 60) {
  const path = fsx.join(folder, `${name}.jpg`);
  await ensureNotOpenDocumentPath(path);
  await saveActiveDocAs(path, { quality, jpegFormat: "optimized" });
}
/** GIF 저장 (UXP saveForWebGIF 대응) */
export async function saveForWebGIF(folder: string, name: string) {
  const path = fsx.join(folder, `${name}.gif`);
  await ensureNotOpenDocumentPath(path);
  await saveActiveDocAs(path);
}
/** PSD 저장 (UXP saveAsPSD 대응). 열린 다른 문서의 원본은 덮어쓰지 않는다 */
export async function saveAsPSD(path: string) {
  const p = path.endsWith(".psd") ? path : `${path}.psd`;
  await ensureNotOpenDocumentPath(p);
  await saveActiveDocAs(p);
}

export interface OpenedFile {
  index: number;
  name: string;
  /** 루트 밖 파일을 열기 위해 만든 임시 복사본 (없으면 null) */
  tempCopy: string | null;
}

/** 파일 열기 → 새로 열린 문서 정보. 루트 밖이면 임시 복사본을 연다 */
export async function openFileEx(path: string): Promise<OpenedFile> {
  let p = path;
  let tempCopy: string | null = null;
  if (!(await insideRoot(path))) {
    p = await tempFile(fsx.ext(path) || "png");
    await fsx.copy(path, p);
    tempCopy = p;
  }
  const before = (await listDocuments()).documents.length;
  try {
    await pcCall("app.open", { path: p });
  } catch (e) {
    if (tempCopy) await fsx.remove(tempCopy).catch(() => {});
    throw e;
  }
  const { active, documents } = await listDocuments();
  if (documents.length !== before + 1 || active === null) throw new Error(`파일을 새 문서로 열지 못했습니다: ${path}`);
  const name = documents.find((d) => d.index === active)?.name ?? "";
  return { index: active, name, tempCopy };
}

/** 파일 열기 → 열린 문서 인덱스 (루트 밖이면 임시 복사본을 연다) */
export async function openFile(path: string): Promise<number> {
  return (await openFileEx(path)).index;
}

/** 이미지 파일을 대상 문서에 레이어로 가져오기 → 새 레이어 ID 목록. 기본 위치: 원본 좌표(0,0) */
export async function importImageAsLayer(
  path: string,
  targetDoc: number,
  opts: { name?: string; center?: boolean; at?: [number, number]; offset?: [number, number] } = {},
): Promise<number[]> {
  const src = await openFileEx(path);
  let r: any;
  try {
    // 배경 레이어만 있는 문서(흰 배경 PNG 등)는 select.allLayers가 실패하므로 최상위 레이어 ID를 직접 지정
    const top = await exec<{ layers: { id: number }[] }>("layer.list", { document: src.index });
    const p: Record<string, unknown> = { document: targetDoc, source: src.index, layers: (top.layers ?? []).map((l) => l.id) };
    if (opts.center) p.center = true;
    if (opts.at) p.at = opts.at;
    if (opts.offset) p.offset = opts.offset;
    if (opts.name) p.name = opts.name;
    r = await exec<any>("layer.copyToDocument", p);
  } finally {
    await closeTempDoc(src.index, src.name);
    if (src.tempCopy) await fsx.remove(src.tempCopy).catch(() => {});
  }
  await exec("document.activate", { document: targetDoc > src.index ? targetDoc - 1 : targetDoc }).catch(() => {});
  return r?.layers ?? (r?.layer !== undefined ? [r.layer] : []);
}

/** 활성 문서 경로(저장된 파일). 없으면 null */
export async function activeDocPath(): Promise<string | null> {
  const d = await exec<any>("document.inspect", {});
  if (!d?.path) return null;
  const p: string = d.path;
  if (p.startsWith("/")) return p;
  return fsx.join((await getConfig()).root, p);
}
