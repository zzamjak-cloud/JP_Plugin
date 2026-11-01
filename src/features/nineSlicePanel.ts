// 9-Slice 이미지 레지스트리·삽입 (CAT nineSlicePanel.js의 UI 외 로직 대응)
// 이미지 파일은 앱 데이터 폴더(9slice_images/)에 복사되어 원본 이동/삭제와 무관하게 유지된다.
import * as fsx from "../core/fs";
import { loadJSON, saveJSON } from "../ui/storage";
import { listDocuments, getDocInfo, docCloseWithoutSaving, activateDoc } from "../lib/lib_doc";
import { getLayerTree, backgroundToLayer, selectByLayerID } from "../lib/lib_layer";
import { openFileEx } from "../lib/lib_export";
import { deselectAll, selectRect, getSelectionBounds } from "../lib/lib_select";
import { nineSliceCore, adjustAndValidateSliceValues } from "./nineSliceResize";

export interface NineSliceImage {
  id: string;
  name: string;
  /** 보관 폴더 안 파일명 (<id>.<ext>) */
  file: string;
  t: number;
  b: number;
  l: number;
  r: number;
  project: string;
}

export const NS_IMAGES_KEY = "nineSliceImagesV1";
export const NS_PROJECTS_KEY = "nineSliceProjectsV1";
export const NS_CURRENT_PROJECT_KEY = "nineSliceCurrentProjectV1";
export const DEFAULT_PROJECT = "default";
export const NS_FOLDER_NAME = "9slice_images";
export const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

// ===== 메타데이터 =====

export function loadImageMeta(): NineSliceImage[] {
  const list = loadJSON<NineSliceImage[]>(NS_IMAGES_KEY, []);
  // 기존 데이터 마이그레이션: project 필드가 없으면 default 소속
  return Array.isArray(list) ? list.map((m) => ({ ...m, project: m.project || DEFAULT_PROJECT })) : [];
}
export const saveImageMeta = (list: NineSliceImage[]) => saveJSON(NS_IMAGES_KEY, list);

export function loadProjects(): string[] {
  const list = loadJSON<string[]>(NS_PROJECTS_KEY, []);
  return Array.isArray(list) ? list.filter((p) => p && p !== DEFAULT_PROJECT) : [];
}
export const saveProjects = (list: string[]) => saveJSON(NS_PROJECTS_KEY, list);

/** 저장된 현재 프로젝트 (없는 프로젝트면 default) */
export function loadCurrentProject(): string {
  let cur: string = DEFAULT_PROJECT;
  try {
    cur = localStorage.getItem(NS_CURRENT_PROJECT_KEY) || DEFAULT_PROJECT;
  } catch {
    /* 무시 */
  }
  return cur === DEFAULT_PROJECT || loadProjects().includes(cur) ? cur : DEFAULT_PROJECT;
}
export function saveCurrentProject(name: string) {
  try {
    localStorage.setItem(NS_CURRENT_PROJECT_KEY, name);
  } catch {
    /* 무시 */
  }
}

/** 프로젝트 추가 (중복·default면 오류 메시지 반환, 성공 시 null) */
export function addProject(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  const list = loadProjects();
  if (n === DEFAULT_PROJECT || list.includes(n)) return "이미 존재하는 프로젝트 이름입니다.";
  saveProjects([...list, n]);
  return null;
}

/** 프로젝트 제거: 소속 이미지는 default로 이동 (파일은 유지) */
export function removeProject(name: string) {
  saveImageMeta(loadImageMeta().map((m) => (m.project === name ? { ...m, project: DEFAULT_PROJECT } : m)));
  saveProjects(loadProjects().filter((p) => p !== name));
}

// ===== 파일 =====

/** 이미지 보관 폴더 (없으면 생성) */
export async function getImageFolder(): Promise<string> {
  const dir = fsx.join(await fsx.appDataDir(), NS_FOLDER_NAME);
  await fsx.mkdir(dir);
  return dir;
}

export async function imagePath(meta: NineSliceImage): Promise<string> {
  return fsx.join(await getImageFolder(), meta.file);
}

const thumbnailCache = new Map<string, string>();

/** 등록 이미지의 base64 데이터 URL (캐시 우선) */
export async function getImageDataUrl(meta: NineSliceImage): Promise<string> {
  const cached = thumbnailCache.get(meta.id);
  if (cached) return cached;
  const p = await imagePath(meta);
  const e = fsx.ext(p);
  const mime = e === "jpg" || e === "jpeg" ? "image/jpeg" : e === "webp" ? "image/webp" : "image/png";
  const url = `data:${mime};base64,${await fsx.readBase64(p)}`;
  thumbnailCache.set(meta.id, url);
  return url;
}

/** 파일들을 보관 폴더에 복사하고 레지스트리에 추가 → {added, skipped} (건너뜀이 있으면 호출자가 알림) */
export async function registerFiles(paths: string[], project: string): Promise<{ added: NineSliceImage[]; skipped: number }> {
  const folder = await getImageFolder();
  const list = loadImageMeta();
  const added: NineSliceImage[] = [];
  let skipped = 0;
  for (const p of paths) {
    const e = fsx.ext(p);
    if (!ALLOWED_EXTENSIONS.includes(e)) {
      skipped++;
      continue;
    }
    const id = `ns_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const file = `${id}.${e}`;
    try {
      await fsx.copy(p, fsx.join(folder, file));
      const meta: NineSliceImage = { id, name: fsx.stem(p), file, t: 0, b: 0, l: 0, r: 0, project };
      list.push(meta);
      added.push(meta);
    } catch {
      skipped++;
    }
  }
  if (added.length) saveImageMeta(list);
  return { added, skipped };
}

export const skippedMessage = (n: number) => `${n}개 파일을 건너뛰었습니다. (지원 형식: ${ALLOWED_EXTENSIONS.join(", ")})`;

/** 이미지 삭제 (파일이 이미 없어도 메타는 제거) */
export async function deleteImage(id: string): Promise<void> {
  const list = loadImageMeta();
  const meta = list.find((m) => m.id === id);
  if (!meta) return;
  try {
    await fsx.remove(await imagePath(meta));
  } catch {
    /* 파일이 이미 없어도 무시 */
  }
  thumbnailCache.delete(id);
  saveImageMeta(list.filter((m) => m.id !== id));
}

/** 슬라이스 값 저장 */
export function updateSliceValues(id: string, v: { l: number; r: number; t: number; b: number }) {
  saveImageMeta(loadImageMeta().map((m) => (m.id === id ? { ...m, ...v } : m)));
}

// ===== 삽입 =====

/** 열린 문서가 있고 마퀴 선택 영역이 있으면 그 위치·크기로 9-slice 이미지를 삽입 → 삽입 여부 */
export async function insertIfSelection(meta: NineSliceImage): Promise<boolean> {
  if ((await listDocuments()).documents.length === 0) return false;
  const bounds = await getSelectionBounds();
  if (!bounds) return false;
  await insertImageAtSelection(meta, bounds);
  return true;
}

/** 마퀴 선택 영역 위치/크기로 9-slice 이미지를 신규 레이어로 삽입 → 결과 레이어 ID */
export async function insertImageAtSelection(
  meta: NineSliceImage,
  bounds: { left: number; top: number; right: number; bottom: number },
): Promise<number | null> {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (width <= 0 || height <= 0) return null;

  const path = await imagePath(meta);
  if (!(await fsx.exists(path))) throw new Error("등록된 이미지 파일을 찾을 수 없습니다. 이미지를 다시 등록해주세요.");

  const before = await listDocuments();
  const originalDoc = before.active ?? 0;
  const baseCount = before.documents.length;
  let srcName: string | null = null;
  // CAT과 동일하게 히스토리 그룹 없이 실행 (file.new 등 문서 생성 명령은 coalesce 키를 받지 않는다)
  try {
    // 마퀴 선택 영역이 남아있으면 이후 조작이 선택 영역에 적용되므로 먼저 해제
    await deselectAll();
    // 1. 이미지 파일을 임시 문서로 열기
    const opened = await openFileEx(path);
    srcName = opened.name;
    const srcDoc = opened.index;
    await backgroundToLayer();
    const srcLayer = (await getLayerTree())[0];
    const info = await getDocInfo();
    if (!srcLayer || !info) throw new Error("이미지를 열 수 없습니다.");

    // 2. 9-slice 값 보정/검증
    const adjusted = adjustAndValidateSliceValues({
      top: meta.t,
      bottom: meta.b,
      left: meta.l,
      right: meta.r,
      width,
      height,
      srcW: info.width,
      srcH: info.height,
    });

    // 3. 9-slice 스케일링 → 결과 레이어를 원본 문서의 선택 영역 좌표에 생성
    const resultId = await nineSliceCore({
      srcDoc,
      srcName: opened.name,
      layerId: srcLayer.id,
      resultName: `${meta.name}_${width}x${height}`,
      ...adjusted,
      width,
      height,
      destLeft: bounds.left,
      destTop: bounds.top,
      originalDoc,
    });

    // 4. 결과 레이어 선택, 연속 삽입을 위해 마퀴 선택 영역 복원
    if (resultId !== null) await selectByLayerID(resultId);
    await selectRect(bounds.left, bounds.top, width, height);
    return resultId;
  } catch (e) {
    // 실패 시 새로 열린 임시 문서 정리 후 원본 문서로 복귀
    const now = await listDocuments().catch(() => null);
    // 이 작업이 연 문서(소스 이미지, 9slice_target)만 이름을 확인해 닫는다 — 그사이 사용자가 연 문서는 건드리지 않음
    if (now)
      for (const d of [...now.documents].reverse())
        if (d.index >= baseCount && (d.name === srcName || d.name === "9slice_target"))
          await docCloseWithoutSaving(d.index, d.name).catch(() => {});
    await activateDoc(originalDoc).catch(() => {});
    await selectRect(bounds.left, bounds.top, width, height).catch(() => {});
    throw e;
  }
}
