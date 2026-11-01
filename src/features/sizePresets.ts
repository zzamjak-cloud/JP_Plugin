// 사이즈 프리셋 드롭다운 데이터 (CAT sizeDropdown.js 대응).
// 기본 프리셋 + 사용자 커스텀 사이즈를 localStorage에 유지한다. UI는 src/ui/SizePresetDropdown.tsx.
import { loadJSON, saveJSON } from "../ui/storage";

export interface Size {
  width: number;
  height: number;
}

export interface SizePresetConfig {
  /** 커스텀 사이즈 저장 키 (선택 상태는 `${storageKey}_selected`) */
  storageKey: string;
  defaultSize: number;
  /** 기본 프리셋 (정사각형) */
  sizes: number[];
  /** true면 항상 "AxB" 형식으로 표시 */
  pairFormat?: boolean;
  /** true면 단일 값 모드 (width = height) */
  single?: boolean;
  /** 커스텀 입력 다이얼로그 placeholder */
  placeholders?: string[];
  /** 툴팁 */
  tooltip?: string;
}

const DEFAULT_SIZES = [32, 64, 128, 256, 512, 1024];

/** CAT과 같은 키·기본값을 쓰는 프리셋 정의 */
export const SIZE_PRESETS = {
  importDocSize: { storageKey: "importDocSizePresets", defaultSize: 1024, sizes: DEFAULT_SIZES, tooltip: "Document size" },
  arrayGridSize: { storageKey: "arrayGridSizePresets", defaultSize: 128, sizes: DEFAULT_SIZES, tooltip: "Grid cell size" },
  arrayColumns: { storageKey: "arrayColumnPresets", defaultSize: 10, sizes: [5, 8, 10, 20], single: true, placeholders: ["Columns"], tooltip: "Columns per row" },
  guideGrid: { storageKey: "guideGridPresets", defaultSize: 2, sizes: [2, 3, 4, 5, 6, 8, 16, 32, 64], pairFormat: true, placeholders: ["Row", "Col"], tooltip: "Rows x Columns" },
  guideOffset: { storageKey: "guideOffsetPresets", defaultSize: 30, sizes: [5, 10, 15, 20, 30, 40], single: true, placeholders: ["Offset"], tooltip: "Offset" },
} satisfies Record<string, SizePresetConfig>;

export const isSameSize = (a: Size | null | undefined, b: Size | null | undefined) => !!a && !!b && a.width === b.width && a.height === b.height;

export function formatSize(cfg: SizePresetConfig, s: Size): string {
  if (cfg.single) return `${s.width}`;
  if (cfg.pairFormat) return `${s.width}x${s.height}`;
  return s.width === s.height ? `${s.width}` : `${s.width} x ${s.height}`;
}

export function loadCustomSizes(cfg: SizePresetConfig): Size[] {
  const v = loadJSON<Size[]>(cfg.storageKey, []);
  return Array.isArray(v) ? v : [];
}

export function loadSelectedSize(cfg: SizePresetConfig): Size {
  const s = loadJSON<Size | null>(`${cfg.storageKey}_selected`, null);
  if (s && s.width > 0 && s.height > 0) return { width: s.width, height: s.height };
  return { width: cfg.defaultSize, height: cfg.defaultSize };
}

export function selectSize(cfg: SizePresetConfig, s: Size) {
  saveJSON(`${cfg.storageKey}_selected`, { width: s.width, height: s.height });
}

/** 커스텀 사이즈 추가 (기본 프리셋·중복이면 추가 없이 선택만) */
export function addCustomSize(cfg: SizePresetConfig, s: Size) {
  const customs = loadCustomSizes(cfg);
  const isDefault = s.width === s.height && cfg.sizes.includes(s.width);
  if (!isDefault && !customs.some((c) => isSameSize(c, s))) {
    customs.push(s);
    saveJSON(cfg.storageKey, customs);
  }
  selectSize(cfg, s);
}

/** 커스텀 사이즈 제거. 선택 중이던 값이면 기본값으로 되돌린다 */
export function removeCustomSize(cfg: SizePresetConfig, index: number) {
  const customs = loadCustomSizes(cfg);
  const [removed] = customs.splice(index, 1);
  saveJSON(cfg.storageKey, customs);
  if (isSameSize(removed, loadSelectedSize(cfg))) selectSize(cfg, { width: cfg.defaultSize, height: cfg.defaultSize });
}

/** Import 도큐먼트 사이즈 */
export const getImportDocSize = () => loadSelectedSize(SIZE_PRESETS.importDocSize);
/** Array 그리드 셀 사이즈 */
export const getArrayGridSize = () => loadSelectedSize(SIZE_PRESETS.arrayGridSize);
/** Array 열 수 */
export const getArrayColumns = () => loadSelectedSize(SIZE_PRESETS.arrayColumns).width;
/** Guide 분할 (width=Row, height=Col) */
export function getGuideGrid() {
  const s = loadSelectedSize(SIZE_PRESETS.guideGrid);
  return { rows: s.width, cols: s.height };
}
/** Guide 오프셋 */
export const getGuideOffset = () => loadSelectedSize(SIZE_PRESETS.guideOffset).width;
