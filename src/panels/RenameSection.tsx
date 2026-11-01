// LAYERS RENAME 섹션 (CAT index.html Layers Renamer 대응): Enter/Replace 텍스트 프리셋, 자리수, 7개 버튼
import { useState } from "react";
import { Section, Row, Divider, IconButton, Dropdown, promptText } from "../ui/components";
import { showAlert } from "../lib/lib";
import {
  TEXT_PRESETS,
  DIGIT_VALUES,
  getTextPresets,
  addTextPreset,
  removeTextPreset,
  getSelectedText,
  setSelectedText,
  getDigitCount,
  setDigitCount,
  renamerLayers,
  type TextPresetKind,
} from "../features/renamerLayers";

/** 텍스트 프리셋 드롭다운 (선택 없으면 placeholder 표시) */
function TextPresetDropdown({ kind }: { kind: TextPresetKind }) {
  const cfg = TEXT_PRESETS[kind];
  const [presets, setPresets] = useState<string[]>(() => getTextPresets(kind));
  const [selected, setSelected] = useState<string>(() => getSelectedText(kind));
  const refresh = () => {
    setPresets(getTextPresets(kind));
    setSelected(getSelectedText(kind));
  };
  return (
    <Dropdown
      items={presets.map((t) => ({ value: t, label: t, removable: true }))}
      selectedLabel={selected || null}
      placeholder={cfg.placeholder}
      tooltip={cfg.tooltip}
      width={104}
      onSelect={(it) => {
        setSelectedText(kind, it.value);
        refresh();
      }}
      onRemove={(it) => {
        removeTextPreset(kind, it.value);
        refresh();
      }}
      onCustom={async () => {
        const text = await promptText("Add Preset");
        if (!text || !text.trim()) return;
        try {
          setSelectedText(kind, addTextPreset(kind, text));
        } catch (e) {
          await showAlert(e instanceof Error ? e.message : String(e));
        }
        refresh();
      }}
    />
  );
}

export default function RenameSection() {
  const [digit, setDigit] = useState<number>(() => getDigitCount());
  return (
    <Section title="LAYERS RENAME">
      <Row>
        <TextPresetDropdown kind="enter" />
        <TextPresetDropdown kind="replace" />
      </Row>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <span style={{ color: "var(--muted)" }}>digit</span>
        <Dropdown
          items={DIGIT_VALUES.map((v) => ({ value: v, label: `${v}` }))}
          selectedLabel={`${digit}`}
          width={48}
          onSelect={(it) => {
            setDigitCount(it.value);
            setDigit(it.value);
          }}
        />
      </div>
      <Divider />
      <Row>
        <IconButton icon="rename_prefix_light@1X.png" tooltip="Add prefix" onClick={() => renamerLayers("prefix")} />
        <IconButton icon="rename_number_light@1X.png" tooltip="Add numbers" onClick={() => renamerLayers("number")} />
        <IconButton icon="rename_reversenumber_light@1X.png" tooltip="Add reverse numbers" onClick={() => renamerLayers("reversenumber")} />
        <IconButton icon="rename_sufix_light@1X.png" tooltip="Add suffix" onClick={() => renamerLayers("suffix")} />
      </Row>
      <Row>
        <IconButton icon="renameText_light@1X.png" tooltip="Rename layers" onClick={() => renamerLayers("rename")} />
        <IconButton icon="replaceText_light@1X.png" tooltip="Replace text" onClick={() => renamerLayers("replace")} />
        <IconButton icon="remove_text_light@1X.png" tooltip="Remove text" onClick={() => renamerLayers("remove")} />
      </Row>
    </Section>
  );
}
