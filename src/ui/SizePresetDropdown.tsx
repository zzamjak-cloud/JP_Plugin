// 사이즈 프리셋 드롭다운 (CAT sizeDropdown.js의 SizeDropdown 대응).
// 기본 프리셋 + 커스텀 사이즈(x로 삭제) + "custom..." 입력 다이얼로그("Custom Value": W/H 또는 단일 값)
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Dropdown, type DropdownItem } from "./components";
import {
  SIZE_PRESETS,
  addCustomSize,
  formatSize,
  loadCustomSizes,
  loadSelectedSize,
  removeCustomSize,
  selectSize,
  type Size,
  type SizePresetConfig,
} from "../features/sizePresets";

export { SIZE_PRESETS };
export type { Size, SizePresetConfig };

/** 커스텀 사이즈 입력 모달. 확정 시 {width,height}, 취소/무효 값이면 null */
function CustomSizeDialog({ cfg, onClose }: { cfg: SizePresetConfig; onClose: (s: Size | null) => void }) {
  const placeholders = cfg.placeholders ?? ["W", "H"];
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const wRef = useRef<HTMLInputElement>(null);
  useEffect(() => wRef.current?.focus(), []);
  const confirm = () => {
    const width = parseInt(w, 10);
    // H 미입력 시 정사각형
    const height = cfg.single ? width : parseInt(h, 10) || width;
    onClose(!width || width <= 0 || height <= 0 ? null : { width, height });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") confirm();
    if (e.key === "Escape") onClose(null);
  };
  return (
    <div className="modal-backdrop" onClick={() => onClose(null)}>
      <div className="modal" style={{ width: 220 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Custom Value</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={wRef} placeholder={placeholders[0]} value={w} onChange={(e) => setW(e.target.value)} onKeyDown={onKey} style={{ flex: 1, minWidth: 0 }} />
          {!cfg.single && <input placeholder={placeholders[1] ?? "H"} value={h} onChange={(e) => setH(e.target.value)} onKeyDown={onKey} style={{ flex: 1, minWidth: 0 }} />}
        </div>
        <div className="modal-buttons">
          <button onClick={() => onClose(null)}>Cancel</button>
          <button className="primary" onClick={confirm}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 사이즈 프리셋 드롭다운. preset: SIZE_PRESETS 키 또는 직접 정의한 설정.
 * 선택 값은 localStorage(`${storageKey}_selected`)에 저장되며, 기능 코드는 sizePresets.ts의 getter로 읽는다.
 */
export function SizePresetDropdown({
  preset,
  width = 64,
  tooltip,
  onChange,
}: {
  preset: keyof typeof SIZE_PRESETS | SizePresetConfig;
  width?: number;
  tooltip?: string;
  onChange?: (s: Size) => void;
}) {
  const cfg: SizePresetConfig = typeof preset === "string" ? SIZE_PRESETS[preset] : preset;
  const [selected, setSelected] = useState<Size>(() => loadSelectedSize(cfg));
  const [customs, setCustoms] = useState<Size[]>(() => loadCustomSizes(cfg));
  const [dialog, setDialog] = useState(false);

  const refresh = () => {
    const s = loadSelectedSize(cfg);
    setSelected(s);
    setCustoms(loadCustomSizes(cfg));
    onChange?.(s);
  };

  const items: DropdownItem<{ size: Size; custom: number }>[] = [
    ...cfg.sizes.map((v) => ({ value: { size: { width: v, height: v }, custom: -1 }, label: formatSize(cfg, { width: v, height: v }) })),
    ...customs.map((s, i) => ({ value: { size: s, custom: i }, label: formatSize(cfg, s), removable: true })),
  ];

  return (
    <>
      <Dropdown
        items={items}
        selectedLabel={formatSize(cfg, selected)}
        tooltip={tooltip ?? cfg.tooltip}
        width={width}
        onSelect={(it) => {
          selectSize(cfg, it.value.size);
          refresh();
        }}
        onRemove={(it) => {
          removeCustomSize(cfg, it.value.custom);
          refresh();
        }}
        onCustom={() => setDialog(true)}
      />
      {dialog && (
        <CustomSizeDialog
          cfg={cfg}
          onClose={(s) => {
            setDialog(false);
            if (!s) return;
            addCustomSize(cfg, s);
            refresh();
          }}
        />
      )}
    </>
  );
}

export default SizePresetDropdown;
