// Layers rename (CAT renamerLayers.js + lib_text_preset.js 대응): Enter/Replace 텍스트 프리셋, 자리수, 7가지 일괄 이름 변경
import { executeWithHistoryGrouping } from "../lib/lib";
import { getSelectedLayers, renameLayer, selectLayers } from "../lib/lib_layer";
import { loadJSON, saveJSON } from "../ui/storage";

export type RenameType = "prefix" | "suffix" | "rename" | "replace" | "number" | "reversenumber" | "remove";

const MAX_PRESETS = 10;

/** 텍스트 프리셋 목록 정의 (CAT과 같은 localStorage 키) */
export const TEXT_PRESETS = {
  enter: { storageKey: "layerRenamerPresets", selectedKey: "renamerEnterSelected", placeholder: "Enter", tooltip: "Text to apply" },
  replace: { storageKey: "layerRenamerReplacePresets", selectedKey: "renamerReplaceSelected", placeholder: "Replace", tooltip: "Replacement text" },
} as const;
export type TextPresetKind = keyof typeof TEXT_PRESETS;

const rawGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const rawSet = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* 저장 실패 무시 */
  }
};

export function getTextPresets(kind: TextPresetKind): string[] {
  const v = loadJSON<string[]>(TEXT_PRESETS[kind].storageKey, []);
  return Array.isArray(v) ? v : [];
}

/** 프리셋 추가 (트림, 중복이면 추가 없음). 최대 개수 초과 시 예외 → 추가/기존 텍스트 반환 */
export function addTextPreset(kind: TextPresetKind, text: string): string {
  const t = text.trim();
  if (!t) throw new Error("프리셋 텍스트를 입력해주세요.");
  const list = getTextPresets(kind);
  if (list.includes(t)) return t;
  if (list.length >= MAX_PRESETS) throw new Error(`최대 ${MAX_PRESETS}개의 프리셋만 추가할 수 있습니다.`);
  list.push(t);
  saveJSON(TEXT_PRESETS[kind].storageKey, list);
  return t;
}

/** 프리셋 제거. 선택 중이던 텍스트면 선택 해제 */
export function removeTextPreset(kind: TextPresetKind, text: string) {
  saveJSON(
    TEXT_PRESETS[kind].storageKey,
    getTextPresets(kind).filter((p) => p !== text),
  );
  if (getSelectedText(kind) === text) setSelectedText(kind, "");
}

/** 선택 텍스트 (프리셋 목록에 남아 있을 때만 유효) */
export function getSelectedText(kind: TextPresetKind): string {
  const v = rawGet(TEXT_PRESETS[kind].selectedKey) ?? "";
  return v && getTextPresets(kind).includes(v) ? v : "";
}

export function setSelectedText(kind: TextPresetKind, text: string) {
  rawSet(TEXT_PRESETS[kind].selectedKey, text ? text : null);
}

export const DIGIT_VALUES = [1, 2, 3, 4, 5, 6];
const DIGIT_KEY = "renamerDigitCount";

export function getDigitCount(): number {
  const n = parseInt(rawGet(DIGIT_KEY) ?? "", 10);
  return DIGIT_VALUES.includes(n) ? n : 1;
}
export function setDigitCount(n: number) {
  if (DIGIT_VALUES.includes(n)) rawSet(DIGIT_KEY, `${n}`);
}

function validateInputs(type: RenameType, text: string, replaceText: string) {
  if (type === "number" || type === "reversenumber") return;
  if (type !== "rename" && !text) throw new Error("변경할 텍스트를 입력해주세요.");
  if (type === "replace" && !replaceText) throw new Error("대체할 텍스트를 입력해주세요.");
}

/** 새 이름 계산 (replace/remove는 첫 번째 일치만 문자 그대로 치환) */
export function generateNewName(name: string, type: RenameType, text: string, replaceText: string, index: number, total: number, digits: number): string {
  switch (type) {
    case "prefix":
      return `${text}${name}`;
    case "suffix":
      return `${name}${text}`;
    case "rename":
      return text || name;
    case "replace":
      return name.replace(text, () => replaceText);
    case "remove":
      return name.replace(text, "");
    case "number":
      return `${name}${String(total - index).padStart(digits, "0")}`;
    case "reversenumber":
      return `${name}${String(index + 1).padStart(digits, "0")}`;
  }
}

/** 선택 레이어(위→아래 순서) 일괄 이름 변경. Undo 한 단계 */
export async function renamerLayers(type: RenameType): Promise<void> {
  const layers = await getSelectedLayers();
  if (!layers.length) throw new Error("선택된 레이어가 없습니다.");
  const text = getSelectedText("enter");
  const replaceText = getSelectedText("replace");
  const digits = getDigitCount();
  validateInputs(type, text, replaceText);

  const ids = layers.map((l) => l.id);
  await executeWithHistoryGrouping(async () => {
    for (const [i, l] of layers.entries()) {
      const newName = generateNewName(l.name, type, text, replaceText, i, layers.length, digits);
      if (newName !== l.name) await renameLayer(l.id, newName);
    }
    // 원래 선택 상태 복원
    await selectLayers(ids);
  });
}
