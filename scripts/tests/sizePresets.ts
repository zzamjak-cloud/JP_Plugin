// 사이즈 프리셋 검증: 기본값, 커스텀 추가(기본·중복 제외), 삭제 시 기본값 복귀, CAT localStorage 키
import { SIZE_PRESETS, addCustomSize, removeCustomSize, loadCustomSizes, loadSelectedSize, formatSize, getImportDocSize, getArrayColumns, getGuideGrid, getGuideOffset } from "../../src/features/sizePresets";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
const cfg = SIZE_PRESETS.importDocSize;
assert(JSON.stringify(getImportDocSize()) === '{"width":1024,"height":1024}', "기본 1024");
assert(getArrayColumns() === 10 && getGuideOffset() === 30 && getGuideGrid().rows === 2, "기본값들");
addCustomSize(cfg, { width: 512, height: 512 });
assert(loadCustomSizes(cfg).length === 0 && getImportDocSize().width === 512, "기본 프리셋은 선택만");
addCustomSize(cfg, { width: 300, height: 200 });
addCustomSize(cfg, { width: 300, height: 200 });
assert(loadCustomSizes(cfg).length === 1, "중복 제외");
assert(localStorage.getItem("importDocSizePresets_selected") === '{"width":300,"height":200}', "선택 키");
assert(formatSize(cfg, { width: 300, height: 200 }) === "300 x 200" && formatSize(SIZE_PRESETS.guideGrid, { width: 2, height: 2 }) === "2x2", "표시 형식");
removeCustomSize(cfg, 0);
assert(loadSelectedSize(cfg).width === 1024 && loadCustomSizes(cfg).length === 0, "선택 커스텀 삭제 → 기본값");
console.log("SIZE PRESETS OK");
