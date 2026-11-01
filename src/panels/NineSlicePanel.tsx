// 9-Slice Images 패널 (CAT nineSlicePanel.js UI 대응): 프로젝트 드롭다운, 이미지 추가/삭제, 썸네일 그리드, 슬라이스 편집기, 카드 클릭 삽입
import { runExclusive } from "../core/bridge";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dropdown, IconButton } from "../ui/components";
import { showAlert } from "../lib/lib";
import { pickFiles } from "../core/fs";
import {
  ALLOWED_EXTENSIONS,
  DEFAULT_PROJECT,
  addProject,
  deleteImage,
  getImageDataUrl,
  insertIfSelection,
  loadCurrentProject,
  loadImageMeta,
  loadProjects,
  registerFiles,
  removeProject,
  saveCurrentProject,
  skippedMessage,
  updateSliceValues,
  type NineSliceImage,
} from "../features/nineSlicePanel";

const CARD_MAX_WIDTH = 76;
const CARD_GAP = 6;
const MIN_PER_ROW = 3;
const GUIDE_COLOR = "rgb(0, 200, 255)";

// ===== 프로젝트 관리 팝업 =====
function ProjectManager({ onClose, onChanged, onAdded }: { onClose: () => void; onChanged: () => void; onAdded: (name: string) => void }) {
  const [projects, setProjects] = useState(loadProjects);
  const [name, setName] = useState("");
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const err = addProject(n);
    if (err) {
      await showAlert(err);
      return;
    }
    setName("");
    setProjects(loadProjects());
    onAdded(n); // 새 프로젝트로 바로 전환
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 260 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">프로젝트 관리</div>
        <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 8 }}>
          {projects.length === 0 && <div style={{ opacity: 0.6, fontSize: 12 }}>커스텀 프로젝트 없음</div>}
          {projects.map((p) => (
            <div key={p} className="dropdown-item">
              <span>{p}</span>
              <span
                className="remove"
                onClick={() => {
                  removeProject(p);
                  setProjects(loadProjects());
                  onChanged();
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
        <input placeholder="새 프로젝트 이름" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <div className="modal-buttons">
          <button onClick={add}>Add</button>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== 슬라이스 편집 팝업 (룰러 가이드 드래그 방식) =====
type Key = "l" | "r" | "t" | "b";
function SliceEditor({ meta, dataUrl, imgW, imgH, onClose }: { meta: NineSliceImage; dataUrl: string; imgW: number; imgH: number; onClose: (saved: boolean) => void }) {
  // 표시 배율: 큰 이미지는 축소, 작은 이미지는 확대하여 드래그하기 쉽게
  const scale = Math.min(360 / imgW, 280 / imgH, 8);
  const dispW = Math.max(1, Math.round(imgW * scale));
  const dispH = Math.max(1, Math.round(imgH * scale));
  const RULER = 16;
  const HANDLE = 14;
  const HIT = 10;
  const [v, setV] = useState(() => {
    const l = Math.min(meta.l, imgW - 1);
    const r = Math.min(meta.r, imgW - 1 - l);
    const t = Math.min(meta.t, imgH - 1);
    const b = Math.min(meta.b, imgH - 1 - t);
    return { l, r, t, b };
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<Key | null>(null);

  const moveTo = useCallback(
    (key: Key, clientX: number, clientY: number) => {
      const rect = stageRef.current!.getBoundingClientRect();
      const x = Math.round((clientX - rect.left) / scale);
      const y = Math.round((clientY - rect.top) / scale);
      // 반대편 가이드와 최소 1px 간격 유지
      setV((c) => {
        const n = { ...c };
        if (key === "l") n.l = Math.max(0, Math.min(x, imgW - c.r - 1));
        else if (key === "r") n.r = Math.max(0, Math.min(imgW - x, imgW - c.l - 1));
        else if (key === "t") n.t = Math.max(0, Math.min(y, imgH - c.b - 1));
        else n.b = Math.max(0, Math.min(imgH - y, imgH - c.t - 1));
        return n;
      });
    },
    [scale, imgW, imgH],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      moveTo(dragging.current, e.clientX, e.clientY);
    };
    const up = () => (dragging.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [moveTo]);

  const start = (key: Key) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = key;
  };
  // 룰러를 누르면 가까운 쪽 가이드를 잡아 그 위치부터 드래그 시작
  const grabFromRuler = (vertical: boolean) => (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = stageRef.current!.getBoundingClientRect();
    let key: Key;
    if (vertical) {
      const x = (e.clientX - rect.left) / scale;
      key = Math.abs(x - v.l) <= Math.abs(imgW - v.r - x) ? "l" : "r";
    } else {
      const y = (e.clientY - rect.top) / scale;
      key = Math.abs(y - v.t) <= Math.abs(imgH - v.b - y) ? "t" : "b";
    }
    dragging.current = key;
    moveTo(key, e.clientX, e.clientY);
  };

  const lx = Math.round(v.l * scale);
  const rx = dispW - Math.round(v.r * scale);
  const ty = Math.round(v.t * scale);
  const by = dispH - Math.round(v.b * scale);
  const clampX = (x: number) => RULER + Math.min(Math.max(x - HANDLE / 2, 0), dispW - HANDLE);
  const clampY = (y: number) => RULER + Math.min(Math.max(y - HANDLE / 2, 0), dispH - HANDLE);
  const handleStyle: React.CSSProperties = {
    position: "absolute",
    background: "rgb(0,160,220)",
    color: "#fff",
    fontSize: 9,
    textAlign: "center",
    borderRadius: 2,
    userSelect: "none",
  };
  const vLine = (key: Key, x: number) => (
    <div key={key} onPointerDown={start(key)} style={{ position: "absolute", top: 0, left: x - HIT / 2, width: HIT, height: dispH, cursor: "ew-resize" }}>
      <div style={{ position: "absolute", left: HIT / 2, top: 0, width: 1, height: "100%", background: GUIDE_COLOR }} />
    </div>
  );
  const hLine = (key: Key, y: number) => (
    <div key={key} onPointerDown={start(key)} style={{ position: "absolute", left: 0, top: y - HIT / 2, height: HIT, width: dispW, cursor: "ns-resize" }}>
      <div style={{ position: "absolute", top: HIT / 2, left: 0, height: 1, width: "100%", background: GUIDE_COLOR }} />
    </div>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: Math.max(RULER + dispW + 24, 320), maxWidth: "none" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          {meta.name} ({imgW}x{imgH}px)
        </div>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>룰러에서 안쪽으로 드래그하여 가이드 위치를 설정하세요</div>
        <div style={{ position: "relative", width: RULER + dispW, height: RULER + dispH, margin: "0 auto", touchAction: "none" }}>
          <div onPointerDown={grabFromRuler(true)} style={{ position: "absolute", left: RULER, top: 0, width: dispW, height: RULER, background: "rgb(64,64,64)", borderBottom: "1px solid rgb(96,96,96)", cursor: "ew-resize" }} />
          <div onPointerDown={grabFromRuler(false)} style={{ position: "absolute", left: 0, top: RULER, width: RULER, height: dispH, background: "rgb(64,64,64)", borderRight: "1px solid rgb(96,96,96)", cursor: "ns-resize" }} />
          <div ref={stageRef} style={{ position: "absolute", left: RULER, top: RULER, width: dispW, height: dispH, background: "rgb(46,46,46)", overflow: "hidden" }}>
            <img src={dataUrl} draggable={false} style={{ position: "absolute", left: 0, top: 0, width: dispW, height: dispH, imageRendering: "pixelated" }} />
            {vLine("l", lx)}
            {vLine("r", rx)}
            {hLine("t", ty)}
            {hLine("b", by)}
          </div>
          {(["l", "r"] as const).map((k) => (
            <div key={k} onPointerDown={start(k)} style={{ ...handleStyle, top: 0, left: clampX(k === "l" ? lx : rx), width: HANDLE, height: RULER - 1, lineHeight: `${RULER - 1}px`, cursor: "ew-resize" }}>
              {k.toUpperCase()}
            </div>
          ))}
          {(["t", "b"] as const).map((k) => (
            <div key={k} onPointerDown={start(k)} style={{ ...handleStyle, left: 0, top: clampY(k === "t" ? ty : by), height: HANDLE, width: RULER - 1, lineHeight: `${HANDLE}px`, cursor: "ns-resize" }}>
              {k.toUpperCase()}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "rgb(127,178,229)", textAlign: "center", margin: "10px 0" }}>
          L: {v.l}&nbsp;&nbsp; R: {v.r}&nbsp;&nbsp; T: {v.t}&nbsp;&nbsp; B: {v.b}
        </div>
        <div className="modal-buttons">
          <button onClick={() => onClose(false)}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              updateSliceValues(meta.id, v);
              onClose(true);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** 데이터 URL 이미지의 원본 크기 측정 (3초 타임아웃) */
function measureImage(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error("이미지 로드 시간 초과")), 3000);
    img.onload = () => {
      clearTimeout(timer);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = url;
  });
}

// ===== 카드 =====
function Card({ meta, size, selected, onClick, onSlice }: { meta: NineSliceImage; size: number; selected: boolean; onClick: () => void; onSlice: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    getImageDataUrl(meta)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [meta.id]);
  const thumb = Math.max(24, size - 10);
  const hasValues = meta.l + meta.r + meta.t + meta.b > 0;
  return (
    <div
      onClick={onClick}
      style={{
        width: size,
        boxSizing: "border-box",
        padding: 4,
        border: `1px solid ${selected ? "rgb(20,115,230)" : "rgba(255,255,255,0.12)"}`,
        borderRadius: 4,
        background: selected ? "rgba(20,115,230,0.18)" : "transparent",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      <div style={{ width: thumb, height: thumb, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.2)" }}>
        {url && <img src={url} style={{ maxWidth: thumb, maxHeight: thumb }} draggable={false} />}
      </div>
      <div style={{ fontSize: 10, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }} title={meta.name}>
        {missing ? `${meta.name} (파일 없음)` : meta.name}
      </div>
      <div
        title="Edit 9-slice guides"
        onClick={(e) => {
          e.stopPropagation(); // 카드 클릭(삽입) 방지
          onSlice();
        }}
        style={{ fontSize: 10, padding: "1px 4px", borderRadius: 3, background: "rgba(255,255,255,0.1)", maxWidth: "100%", overflow: "hidden", whiteSpace: "nowrap" }}
      >
        {hasValues ? `${meta.l}·${meta.r}·${meta.t}·${meta.b}` : "Slice"}
      </div>
    </div>
  );
}

export default function NineSlicePanel() {
  const [images, setImages] = useState<NineSliceImage[]>(loadImageMeta);
  const [projects, setProjects] = useState<string[]>(loadProjects);
  const [project, setProject] = useState<string>(loadCurrentProject);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manager, setManager] = useState(false);
  const [editor, setEditor] = useState<{ meta: NineSliceImage; url: string; w: number; h: number } | null>(null);
  const [gridW, setGridW] = useState(200);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const busy = useRef(false);

  const reload = () => {
    setImages(loadImageMeta());
    setProjects(loadProjects());
  };
  const switchProject = (name: string) => {
    saveCurrentProject(name);
    setProject(name);
    setSelectedId(null);
    reload();
  };

  const register = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    const { skipped } = await registerFiles(paths, projectRef.current);
    setImages(loadImageMeta());
    if (skipped > 0) await showAlert(skippedMessage(skipped));
  }, []);

  // 그리드 폭 추적 (패널 리사이즈 대응)
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setGridW(el.clientWidth || 200));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 드래그앤드롭 등록 (Tauri 창에 파일을 떨어뜨리면 경로 목록이 전달된다). 패널이 보일 때만 처리
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((ev) => {
          if (ev.payload.type !== "drop") return;
          if (!rootRef.current || rootRef.current.offsetParent === null) return;
          register(ev.payload.paths).catch((e) => showAlert(String(e?.message ?? e)));
        }),
      )
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      })
      .catch(() => {
        /* Tauri 외 환경: 드래그앤드롭 미지원 */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [register]);

  const visible = images.filter((m) => (m.project || DEFAULT_PROJECT) === project);
  // 그리드 레이아웃: 최소 3열, 카드 최대 76px
  const width = gridW - 2;
  const perRow = Math.max(MIN_PER_ROW, Math.floor(width / (CARD_MAX_WIDTH + CARD_GAP)));
  const cardW = Math.min(CARD_MAX_WIDTH, Math.floor((width - perRow * CARD_GAP) / perRow));

  const onCardClick = async (meta: NineSliceImage) => {
    setSelectedId(meta.id);
    if (busy.current) return;
    busy.current = true;
    try {
      await runExclusive(() => insertIfSelection(meta));
    } catch (e) {
      await showAlert(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  };

  const openEditor = async (meta: NineSliceImage) => {
    let url: string;
    try {
      url = await getImageDataUrl(meta);
    } catch {
      await showAlert("이미지 파일을 찾을 수 없습니다. 이미지를 다시 등록해주세요.");
      return;
    }
    try {
      const { w, h } = await measureImage(url);
      if (!w || !h) throw new Error();
      setEditor({ meta, url, w, h });
    } catch {
      await showAlert("이미지 크기를 읽을 수 없습니다.");
    }
  };

  return (
    <div ref={rootRef} className="section-body" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Dropdown
        items={[DEFAULT_PROJECT, ...projects].map((p) => ({ value: p, label: p === project ? `✓ ${p}` : p }))}
        selectedLabel={project}
        tooltip="Project category"
        onSelect={(it) => switchProject(it.value)}
        onCustom={() => setManager(true)}
      />
      <div className="row">
        <IconButton label="+" tooltip="Add images" onClick={async () => register(await pickFiles(ALLOWED_EXTENSIONS, true))} />
        <IconButton
          label="Del"
          tooltip="Remove image"
          onClick={async () => {
            if (!selectedId || !images.some((m) => m.id === selectedId)) {
              await showAlert("삭제할 이미지를 먼저 선택해주세요.");
              return;
            }
            await deleteImage(selectedId);
            setSelectedId(null);
            setImages(loadImageMeta());
          }}
        />
      </div>
      <div ref={gridRef} style={{ display: "flex", flexWrap: "wrap", gap: CARD_GAP, alignContent: "flex-start" }}>
        {visible.length === 0 ? (
          <div style={{ fontSize: 11, opacity: 0.6, padding: 12, textAlign: "center", width: "100%" }}>+ 버튼 또는 드래그앤드롭으로 이미지를 등록하세요</div>
        ) : (
          visible.map((m) => <Card key={m.id} meta={m} size={cardW} selected={m.id === selectedId} onClick={() => onCardClick(m)} onSlice={() => openEditor(m)} />)
        )}
      </div>
      {manager && (
        <ProjectManager
          onClose={() => setManager(false)}
          onChanged={() => {
            reload();
            if (project !== DEFAULT_PROJECT && !loadProjects().includes(project)) switchProject(DEFAULT_PROJECT);
          }}
          onAdded={(n) => switchProject(n)}
        />
      )}
      {editor && (
        <SliceEditor
          meta={editor.meta}
          dataUrl={editor.url}
          imgW={editor.w}
          imgH={editor.h}
          onClose={(saved) => {
            setEditor(null);
            if (saved) setImages(loadImageMeta());
          }}
        />
      )}
    </div>
  );
}
