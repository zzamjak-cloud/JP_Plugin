// 파일 열기/저장/내보내기. PhotoCraft는 자동화 루트 밖 경로를 거부하므로
// 루트 밖 경로는 루트 안 임시 폴더를 거쳐 복사/이동한다.
import { exec, pcCall, getConfig } from "../core/bridge";
import * as fsx from "../core/fs";
import { listDocuments } from "./lib_doc";

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
  return path === root || path.startsWith(root + "/");
}

/** 파일 이동 (다른 볼륨이면 복사 후 삭제) */
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

/** 활성 문서를 경로에 저장/내보내기 (확장자로 포맷 결정: png/jpg/gif/psd/pcraft/webp/tif …) */
export async function saveActiveDocAs(path: string, opts: SaveOptions = {}): Promise<void> {
  const params: Record<string, unknown> = {};
  if (opts.quality !== undefined) params.quality = Math.max(0, Math.min(12, Math.round((opts.quality / 100) * 12)));
  if (opts.jpegFormat) params.jpegFormat = opts.jpegFormat;
  if (opts.tgaBits) params.tgaBits = opts.tgaBits;
  await fsx.mkdir(fsx.dirname(path));
  if (await insideRoot(path)) {
    if (await fsx.exists(path)) await fsx.remove(path);
    await pcCall("app.save", { ...params, path });
    return;
  }
  const tmp = await tempFile(fsx.ext(path) || "png");
  await pcCall("app.save", { ...params, path: tmp });
  if (await fsx.exists(path)) await fsx.remove(path);
  await moveFile(tmp, path);
}

/** PNG-24 저장 (UXP saveForWebPNG 대응) */
export const saveForWebPNG = (folder: string, name: string) => saveActiveDocAs(fsx.join(folder, `${name}.png`));
/** JPG 저장, 기본 품질 60 (UXP saveForWebJPG 대응) */
export const saveForWebJPG = (folder: string, name: string, quality = 60) =>
  saveActiveDocAs(fsx.join(folder, `${name}.jpg`), { quality, jpegFormat: "optimized" });
/** GIF 저장 (UXP saveForWebGIF 대응) */
export const saveForWebGIF = (folder: string, name: string) => saveActiveDocAs(fsx.join(folder, `${name}.gif`));
/** PSD 저장 (UXP saveAsPSD 대응) */
export const saveAsPSD = (path: string) => saveActiveDocAs(path.endsWith(".psd") ? path : `${path}.psd`);

/** 파일 열기 → 열린 문서 인덱스 (루트 밖이면 임시 복사본을 연다) */
export async function openFile(path: string): Promise<number> {
  let p = path;
  if (!(await insideRoot(path))) {
    p = await tempFile(fsx.ext(path) || "png");
    await fsx.copy(path, p);
  }
  await pcCall("app.open", { path: p });
  const { active } = await listDocuments();
  return active ?? 0;
}

/** 이미지 파일을 대상 문서에 레이어로 가져오기 → 새 레이어 ID 목록. 기본 위치: 원본 좌표(0,0) */
export async function importImageAsLayer(
  path: string,
  targetDoc: number,
  opts: { name?: string; center?: boolean; at?: [number, number]; offset?: [number, number] } = {},
): Promise<number[]> {
  const src = await openFile(path);
  await exec("select.allLayers", {});
  const p: Record<string, unknown> = { document: targetDoc, source: src };
  if (opts.center) p.center = true;
  if (opts.at) p.at = opts.at;
  if (opts.offset) p.offset = opts.offset;
  if (opts.name) p.name = opts.name;
  const r = await exec<any>("layer.copyToDocument", p);
  await exec("file.close", { document: src });
  await exec("document.activate", { document: targetDoc > src ? targetDoc - 1 : targetDoc }).catch(() => {});
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
