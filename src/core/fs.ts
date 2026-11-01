// 로컬 파일 시스템 래퍼 (UXP localFileSystem 대체)
import { transport } from "./transport";
const invoke = <T>(cmd: string, args?: Record<string, unknown>) => transport().invoke<T>(cmd, args);
const open = (o: Record<string, unknown>) => transport().dialog("open", o);
const save = (o: Record<string, unknown>) => transport().dialog("save", o);

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number;
}

export const readText = (path: string) => invoke<string>("fs_read_text", { path });
export const readBase64 = (path: string) => invoke<string>("fs_read_base64", { path });
export const writeText = (path: string, text: string) => invoke<void>("fs_write_text", { path, text });
export const writeBase64 = (path: string, data: string) => invoke<void>("fs_write_base64", { path, data });
export const listDir = (path: string) => invoke<DirEntry[]>("fs_list_dir", { path });
export const mkdir = (path: string) => invoke<void>("fs_mkdir", { path });
export const exists = (path: string) => invoke<boolean>("fs_exists", { path });
export const remove = (path: string) => invoke<void>("fs_remove", { path });
export const rename = (from: string, to: string) => invoke<void>("fs_rename", { from, to });
export const copy = (from: string, to: string) => invoke<void>("fs_copy", { from, to });
export const tempDir = (root: string) => invoke<string>("fs_temp_dir", { root });
export const reveal = (path: string) => invoke<void>("reveal_path", { path });

/** 경로 결합 (POSIX) */
export function join(...parts: string[]): string {
  return parts
    .filter((p) => p !== "")
    .join("/")
    .replace(/\/+/g, "/");
}
export const basename = (p: string) => p.split("/").pop() ?? p;
export const dirname = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
export function stem(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}
export function ext(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

/** 파일 선택 다이얼로그 */
export async function pickFiles(extensions?: string[], multiple = true): Promise<string[]> {
  const r = await open({
    multiple,
    directory: false,
    filters: extensions ? [{ name: extensions.join(", "), extensions }] : undefined,
  });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

/** 폴더 선택 다이얼로그 */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const r = await open({ directory: true, multiple: false, defaultPath });
  return typeof r === "string" ? r : null;
}

/** 저장 경로 다이얼로그 */
export async function pickSavePath(defaultPath?: string, extensions?: string[]): Promise<string | null> {
  return save({ defaultPath, filters: extensions ? [{ name: extensions.join(", "), extensions }] : undefined });
}
