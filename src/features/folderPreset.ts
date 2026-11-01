// 내보내기 폴더 프리셋 + Keep doc size 상태 (CAT lib_folder_preset.js / exportSelectedLayers.js 대응)
// CAT은 선택 프리셋과 체크 상태를 데이터 폴더 텍스트 파일에 저장했지만 여기서는 localStorage를 쓴다.
import { loadJSON, saveJSON } from "../ui/storage";
import * as fsx from "../core/fs";
import { activeDocPath } from "../lib/lib_export";
import { requireDoc } from "../lib/lib_doc";

export interface FolderPreset {
  path: string;
  name: string;
  id: string;
}

const PRESETS_KEY = "exportFolderPresets";
const SELECTED_KEY = "selectedFolder";
const KEEP_DOC_SIZE_KEY = "keepDocSizeState";
const MAX_PRESETS = 10;

export const getFolderPresets = (): FolderPreset[] => loadJSON<FolderPreset[]>(PRESETS_KEY, []);

/** 프리셋 추가 (CAT FolderPresetManager.addPreset과 같은 검증·문구) */
export function addFolderPreset(folderPath: string, folderName: string): FolderPreset {
  const presets = getFolderPresets();
  if (presets.length >= MAX_PRESETS) throw new Error(`최대 ${MAX_PRESETS}개의 폴더 프리셋만 추가할 수 있습니다.`);
  if (!folderPath || !folderName) throw new Error("폴더 경로와 이름을 모두 입력해주세요.");
  if (presets.some((p) => p.path === folderPath)) throw new Error("이미 존재하는 폴더 경로입니다.");
  const preset: FolderPreset = { path: folderPath, name: folderName, id: `folder_${Date.now()}` };
  saveJSON(PRESETS_KEY, [...presets, preset]);
  return preset;
}

/** 프리셋 제거. 선택 중이던 프리셋이면 선택도 해제 */
export function removeFolderPreset(id: string) {
  saveJSON(
    PRESETS_KEY,
    getFolderPresets().filter((p) => p.id !== id),
  );
  if (getSelectedFolder()?.id === id) setSelectedFolder(null);
}

export const getSelectedFolder = (): FolderPreset | null => loadJSON<FolderPreset | null>(SELECTED_KEY, null);
export const setSelectedFolder = (preset: FolderPreset | null) => saveJSON(SELECTED_KEY, preset);

export const getKeepDocSize = (): boolean => !!loadJSON<{ isChecked: boolean } | null>(KEEP_DOC_SIZE_KEY, null)?.isChecked;
export const setKeepDocSize = (isChecked: boolean) => saveJSON(KEEP_DOC_SIZE_KEY, { isChecked });

/** custom...: 폴더 선택 다이얼로그로 새 프리셋을 등록하고 자동 선택 */
export async function addFolderPresetViaDialog(): Promise<FolderPreset> {
  const folder = await fsx.pickFolder();
  if (!folder) throw new Error("폴더가 선택되지 않았습니다.");
  const preset = addFolderPreset(folder, fsx.basename(folder.replace(/\/+$/, "")));
  setSelectedFolder(preset);
  return preset;
}

/** 활성 문서의 저장 폴더와 파일명(확장자 제외). 저장된 적 없으면 폴더 선택 다이얼로그로 대체 */
export async function docFolderAndName(): Promise<{ folder: string; name: string }> {
  const doc = await requireDoc();
  const path = await activeDocPath();
  // 루트 밖 파일은 임시 복사본(.jp_plugin_tmp)으로 열리므로 그 경로는 실제 저장 위치가 아니다
  if (path && !path.includes("/.jp_plugin_tmp/")) return { folder: fsx.dirname(path), name: fsx.stem(path) };
  const folder = await fsx.pickFolder();
  if (!folder) throw new Error("폴더가 선택되지 않았습니다.");
  return { folder, name: fsx.stem(doc.name) };
}

/** 내보내기 폴더: 선택된 프리셋 → 없으면 PSD 저장 폴더 → 저장 안 된 문서면 폴더 선택 다이얼로그 */
export async function resolveExportFolder(): Promise<string> {
  const preset = getSelectedFolder();
  if (preset?.path) return preset.path;
  return (await docFolderAndName()).folder;
}
