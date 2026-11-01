// 공용 UI 컴포넌트: 섹션, 아이콘 버튼, 프리셋 드롭다운, 체크박스, 입력 다이얼로그
import { useEffect, useRef, useState, type ReactNode } from "react";
import { runSafe } from "../lib/lib";
import { loadJSON, saveJSON } from "./storage";

/** 접이식 섹션 ("EXPORT +" / "EXPORT -") */
export function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const key = `jp_section_${title}`;
  const [open, setOpen] = useState<boolean>(() => loadJSON(key, defaultOpen));
  return (
    <div className="section">
      <button
        className="section-header"
        onClick={() => {
          setOpen(!open);
          saveJSON(key, !open);
        }}
      >
        {title} {open ? "-" : "+"}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="row">{children}</div>;
}

export function Divider() {
  return <div className="divider" />;
}

/** 아이콘 버튼: 클릭 시 비동기 작업 실행, 실행 중 비활성, 실패 시 알림 */
export function IconButton({ icon, tooltip, onClick, label }: { icon?: string; tooltip: string; onClick: () => Promise<unknown> | unknown; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`icon-button${busy ? " busy" : ""}${label && !icon ? " text" : ""}`}
      data-tooltip={tooltip}
      title={tooltip}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await runSafe(tooltip, async () => onClick());
        setBusy(false);
      }}
    >
      {icon ? <img src={`/icons/${icon}`} alt={tooltip} /> : <span>{label ?? tooltip}</span>}
    </button>
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** 텍스트 입력 모달 (UXP의 custom... 입력 다이얼로그 대응) */
let promptImpl: ((title: string, initial: string) => Promise<string | null>) | null = null;
export function promptText(title: string, initial = ""): Promise<string | null> {
  if (promptImpl) return promptImpl(title, initial);
  return Promise.resolve(window.prompt(title, initial));
}

export function PromptHost() {
  const [state, setState] = useState<{ title: string; value: string; resolve: (v: string | null) => void } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    promptImpl = (title, initial) => new Promise((resolve) => setState({ title, value: initial, resolve }));
    return () => {
      promptImpl = null;
    };
  }, []);
  useEffect(() => inputRef.current?.focus(), [state?.title]);
  if (!state) return null;
  const close = (v: string | null) => {
    state.resolve(v);
    setState(null);
  };
  return (
    <div className="modal-backdrop" onClick={() => close(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{state.title}</div>
        <input
          ref={inputRef}
          value={state.value}
          onChange={(e) => setState({ ...state, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") close(state.value);
            if (e.key === "Escape") close(null);
          }}
        />
        <div className="modal-buttons">
          <button onClick={() => close(null)}>취소</button>
          <button className="primary" onClick={() => close(state.value)}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

export interface DropdownItem<T> {
  value: T;
  label: string;
  /** 사용자 추가 항목: x 버튼으로 삭제 가능 */
  removable?: boolean;
}

/**
 * 프리셋 드롭다운 (CAT sizeDropdown/renamer 드롭다운 대응).
 * items: 기본+사용자 항목, onCustom: "custom..." 클릭 시 새 값을 만들어 반환(없으면 null)
 */
export function Dropdown<T>({
  items,
  selectedLabel,
  placeholder,
  tooltip,
  onSelect,
  onRemove,
  onCustom,
  width,
}: {
  items: DropdownItem<T>[];
  selectedLabel: string | null;
  placeholder?: string;
  tooltip?: string;
  onSelect: (item: DropdownItem<T>) => void;
  onRemove?: (item: DropdownItem<T>) => void;
  onCustom?: () => void | Promise<void>;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="dropdown" ref={ref} style={width ? { width } : undefined} title={tooltip}>
      <button className="dropdown-toggle" onClick={() => setOpen(!open)}>
        <span className={selectedLabel ? "" : "placeholder"}>{selectedLabel ?? placeholder ?? ""}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="dropdown-list">
          {items.map((it, i) => (
            <div
              key={i}
              className="dropdown-item"
              onClick={() => {
                onSelect(it);
                setOpen(false);
              }}
            >
              <span>{it.label}</span>
              {it.removable && onRemove && (
                <span
                  className="remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(it);
                  }}
                >
                  ×
                </span>
              )}
            </div>
          ))}
          {onCustom && (
            <div
              className="dropdown-item custom"
              onClick={async () => {
                setOpen(false);
                await onCustom();
              }}
            >
              custom...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
