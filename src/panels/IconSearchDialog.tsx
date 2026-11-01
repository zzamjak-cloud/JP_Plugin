// Icon Search 모달 (CAT iconSearch.js showIconSearchDialog 대응)
import { useEffect, useRef, useState } from "react";
import { runSafe } from "../lib/lib";
import { PAGE_SIZE, getPreview, importIcon, loadPreviews, searchIcons } from "../features/iconSearch";

const muted = { fontSize: 11, color: "#999", padding: 4 } as const;

export default function IconSearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [allIcons, setAllIcons] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  // 결과 영역 상태 메시지 (null이면 그리드 표시)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [pageIcons, setPageIcons] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const renderToken = useRef(0); // 페이지 전환 시 이전 렌더링 결과 무시용
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(allIcons.length / PAGE_SIZE));

  // 현재 페이지의 아이콘 그리드 렌더링
  const renderPage = async (icons: string[], p: number) => {
    const token = ++renderToken.current;
    setSelected(null);
    setPage(p);
    const list = icons.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
    if (list.length === 0) {
      setPageIcons([]);
      setStatus({ text: "결과 없음" });
      return;
    }
    setStatus({ text: "불러오는 중..." });
    await loadPreviews(list);
    if (token !== renderToken.current) return; // 그 사이 다른 페이지로 이동함
    setPageIcons(list);
    setStatus(null);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };

  // 검색 실행
  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSelected(null);
    setAllIcons([]);
    setPageIcons([]);
    setPage(0);
    renderToken.current++;
    setStatus({ text: "검색 중..." });
    try {
      const icons = await searchIcons(q);
      setAllIcons(icons);
      await renderPage(icons, 0);
    } catch (e) {
      setStatus({ text: `오류: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  };

  // Import: 다이얼로그를 닫고 신규 문서 생성 + 벡터 변환 (검색 상태는 유지해 재사용)
  const doImport = async () => {
    if (!selected) return;
    const id = selected;
    onClose();
    await runSafe("아이콘 가져오기", () => importIcon(id));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: "min(96vw, 680px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Icon Search</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            ref={inputRef}
            style={{ flex: 1 }}
            placeholder="검색어 (예: home, arrow, cat)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
              if (e.key === "Escape") onClose();
            }}
          />
          <button onClick={runSearch}>Search</button>
        </div>
        <div
          ref={resultsRef}
          style={{
            height: "min(60vh, 440px)",
            overflowY: "auto",
            display: "flex",
            flexWrap: "wrap",
            alignContent: "flex-start",
            border: "1px solid #555",
            borderRadius: 4,
            padding: 10,
          }}
        >
          {status ? (
            <span style={status.error ? { ...muted, color: "#e34850" } : muted}>{status.text}</span>
          ) : (
            pageIcons.map((iconId) => {
              const uri = getPreview(iconId);
              return (
                <div
                  key={iconId}
                  title={iconId}
                  onClick={() => setSelected(iconId)}
                  style={{
                    width: 72,
                    height: 72,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px solid ${selected === iconId ? "#1473e6" : "transparent"}`,
                    borderRadius: 4,
                    margin: 4,
                    cursor: "pointer",
                  }}
                >
                  {uri ? (
                    <img src={uri} style={{ width: 56, height: 56, pointerEvents: "none" }} />
                  ) : (
                    <span style={{ fontSize: 9, color: "#777", pointerEvents: "none" }}>?</span>
                  )}
                </div>
              );
            })
          )}
        </div>
        {allIcons.length > 0 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 24 }}>
            <button style={{ opacity: page > 0 ? 1 : 0.4 }} onClick={() => page > 0 && renderPage(allIcons, page - 1)}>
              이전
            </button>
            <span style={{ fontSize: 11, color: "#999", minWidth: 140, textAlign: "center" }}>
              {`${page + 1} / ${totalPages} (${allIcons.length}개)`}
            </span>
            <button
              style={{ opacity: page < totalPages - 1 ? 1 : 0.4 }}
              onClick={() => (page + 1) * PAGE_SIZE < allIcons.length && renderPage(allIcons, page + 1)}
            >
              다음
            </button>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#999" }}>{selected ?? ""}</span>
          <div className="modal-buttons">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!selected} onClick={doImport}>
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
