// Iconify 아이콘 검색 → SVG 벡터 변환 (CAT iconSearch.js 이식). UI는 panels/IconSearchDialog.tsx
import { importSvgTextToShape } from "./svgToShapeLayer";

const ICONIFY_API = "https://api.iconify.design";
const SEARCH_LIMIT = 999; // API 최대치 — 한 번에 받아서 클라이언트에서 페이징
export const PAGE_SIZE = 60; // 한 페이지에 표시할 아이콘 수
const PREVIEW_COLOR = "#cccccc"; // 다크 패널에서 보이도록 회색 프리뷰 (currentColor 대체)
const FETCH_CONCURRENCY = 4; // 동시 요청 제한

// 프리뷰 SVG 캐시 (iconId → data URI 또는 null)
const previewCache = new Map<string, string | null>();

// UTF-8 문자열 → base64
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

interface IconifyIcon {
  body: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
}

// Iconify 아이콘 데이터 → 프리뷰용 SVG data URI
function buildPreviewUri(icon: IconifyIcon, defaults: { width?: number; height?: number }): string {
  const w = icon.width || defaults.width || 16;
  const h = icon.height || defaults.height || 16;
  const body = icon.body.replace(/currentColor/g, PREVIEW_COLOR);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="${icon.left || 0} ${icon.top || 0} ${w} ${h}">${body}</svg>`;
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

// 같은 prefix 아이콘들을 일괄 조회(JSON API)하여 캐시에 저장
async function fetchPreviewBatch(prefix: string, names: string[]) {
  const res = await fetch(`${ICONIFY_API}/${prefix}.json?icons=${names.map(encodeURIComponent).join(",")}`);
  if (!res.ok) throw new Error(`프리뷰 조회 실패 (${res.status})`);
  const data = await res.json();
  const icons: Record<string, IconifyIcon> = data.icons || {};
  const aliases: Record<string, { parent: string }> = data.aliases || {};
  for (const name of names) {
    // 별칭 아이콘은 부모 아이콘 데이터로 표시
    let icon = icons[name];
    if (!icon && aliases[name]) icon = icons[aliases[name].parent];
    previewCache.set(`${prefix}:${name}`, icon ? buildPreviewUri(icon, data) : null);
  }
}

/** 캐시에 없는 아이콘 프리뷰를 prefix별로 묶어 동시성 제한 하에 로드 */
export async function loadPreviews(iconIds: string[]): Promise<void> {
  const groups = new Map<string, string[]>();
  for (const iconId of iconIds) {
    if (previewCache.has(iconId)) continue;
    const [prefix, name] = iconId.split(":");
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(name);
  }
  const jobs = [...groups.entries()];
  const worker = async () => {
    while (jobs.length > 0) {
      const [prefix, names] = jobs.shift()!;
      try {
        await fetchPreviewBatch(prefix, names);
      } catch {
        // 실패한 prefix는 캐시에 없으므로 그리드에 "?"로 표시된다
      }
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
}

/** 캐시된 프리뷰 data URI (없으면 null) */
export const getPreview = (iconId: string): string | null => previewCache.get(iconId) ?? null;

/** 아이콘 검색 — "prefix:name" 문자열 배열 */
export async function searchIcons(query: string): Promise<string[]> {
  const res = await fetch(`${ICONIFY_API}/search?query=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`);
  if (!res.ok) throw new Error(`검색 실패 (${res.status})`);
  const data = await res.json();
  return data.icons || [];
}

/** 개별 아이콘 SVG 텍스트 다운로드 */
export async function fetchIconSvg(iconId: string): Promise<string> {
  const [prefix, name] = iconId.split(":");
  const res = await fetch(`${ICONIFY_API}/${prefix}/${name}.svg`);
  if (!res.ok) throw new Error(`SVG 다운로드 실패 (${res.status})`);
  return await res.text();
}

/** 선택 아이콘 → 신규 문서(아이콘 이름) + Shape Layer 변환 → 생성된 레이어 ID 목록 */
export async function importIcon(iconId: string): Promise<number[]> {
  const svgText = await fetchIconSvg(iconId);
  const docName = iconId.split(":")[1];
  return importSvgTextToShape(svgText, docName);
}
