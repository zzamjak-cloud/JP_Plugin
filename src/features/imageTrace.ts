// Image Trace (CAT imageTrace.js 이식)
// 픽셀 처리·경계 그래프·베지어 피팅 알고리즘은 원본을 그대로 옮기고,
// 픽셀 입력은 lib_pixels(PNG 왕복), Shape 생성은 lib_shape(PhotoCraft shape.create)로 바꿨다.
//
// 공유 경계 아크 방식:
// 1) 모든 비투명 픽셀을 색상 인덱스에 배정 → 작은 영역은 인접 색으로 병합
// 2) 픽셀 코너 격자에서 색상 경계 에지 그래프 구축 (차수≠2 정점 = 정션)
// 3) 정션 사이 에지 체인(아크)을 한 번만 스무딩 + 베지어 피팅 (정션 좌표 고정)
// 4) 색상별 윤곽은 아크를 정/역방향으로 이어붙여 재구성
//    → 인접 색상이 동일한 곡선 데이터를 공유하므로 경계 틈이 원천적으로 발생하지 않음
import { executeWithHistoryGrouping } from "../lib/lib";
import { requireDoc } from "../lib/lib_doc";
import { getActiveLayer, selectLayers, makeGroupFromSelectLayers } from "../lib/lib_layer";
import { getLayerPixels } from "../lib/lib_pixels";
import { createShapeFromPathContents, setShapeColor } from "../lib/lib_shape";
import { promptText } from "../ui/components";
import { setProgress, clearProgress } from "../ui/progress";
import { fitPathSegments, segmentsToAnchors, reverseSegments } from "./curveFit";

// ==================== Image Trace (메인 진입점) ====================

export async function imageTrace(): Promise<void> {
    const doc = await requireDoc();
    const layer = await getActiveLayer();
    if (!layer) throw new Error("선택된 레이어가 없습니다.");

    const settings = await showTraceDialog();
    if (!settings) return;

    // 레이어 바운드 기준 (캔버스 밖 영역은 잘라낸다)
    const [bx, by, bw, bh] = layer.bounds ?? [0, 0, doc.width, doc.height];
    const offsetX = Math.max(0, Math.round(bx));
    const offsetY = Math.max(0, Math.round(by));
    const w = Math.min(doc.width, Math.round(bx + bw)) - offsetX;
    const h = Math.min(doc.height, Math.round(by + bh)) - offsetY;
    if (w <= 0 || h <= 0) throw new Error("레이어에 픽셀이 없습니다.");

    try {
        await executeWithHistoryGrouping(async () => {
            // 1. 픽셀 데이터 읽기 (문서 캔버스 크기 RGBA 8bit → 레이어 영역만 잘라냄)
            setProgress("Image Trace: 픽셀 읽기", 0);
            const ss = Math.max(w, h) <= 1200 ? 2 : 1;
            const full = await getLayerPixels(layer.id);
            const bufW = w, bufH = h;
            let rawPixels: Uint8Array = new Uint8Array(bufW * bufH * 4);
            for (let y = 0; y < bufH; y++) {
                const so = ((y + offsetY) * full.width + offsetX) * 4;
                rawPixels.set(full.data.subarray(so, so + bufW * 4), y * bufW * 4);
            }

            // 투명 픽셀 RGB를 인접 불투명 색으로 채움 — PNG 왕복으로 받은 투명 영역 RGB(0)가
            // Catmull-Rom 확대 시 경계로 번져 어두운 테두리 색이 별도 레이어로 생기는 것을 막는다
            bleedTransparentRGB(rawPixels, bufW, bufH, 2);

            // 수퍼샘플링: 작은 이미지는 Catmull-Rom 보간으로 2배 확대 후 트레이스
            // (스무딩/경계 배정/피팅 오차가 트레이스 공간 픽셀 단위이므로 결과 기준 오차가 절반이 됨)
            let tw = bufW, th = bufH;
            if (ss === 2) {
                rawPixels = upscale2x(rawPixels, bufW, bufH);
                tw = bufW * 2;
                th = bufH * 2;
            }
            // 앵커 좌표를 원본 크기 기준으로 되돌리기 위한 스케일
            const scaleX = w / tw, scaleY = h / th;

            // 1.5. 전처리: 알파 이진화 + 그라데이션 경계 제거
            setProgress("Image Trace: 색상 분석", 5);
            const pixels = preprocessPixels(rawPixels, tw, th);

            // 2. 색상 양자화
            const colors = quantizeColors(pixels, tw, th, settings.colorTolerance, settings.maxColors);

            let visibleColors = colors.filter((c: any) => c.a > 128);

            // 최소 면적 기준: 전체 픽셀의 0.01% 미만 영역은 인접 색으로 흡수
            const totalPixels = tw * th;
            const minRegionArea = Math.max(4, totalPixels * 0.0001);

            // 3. 모든 비투명 픽셀을 가장 가까운 색상에 배정 (틈 제거)
            const colorIndexMap = buildColorIndexMap(pixels, tw, th, visibleColors);

            // 3.2. 안티에일리어싱 혼합색 흡수
            //      — 전이색이 남으면 경계마다 정션이 촘촘해져 아크가 조각나고 계단/얼룩이 보존됨
            absorbMixtureColors(colorIndexMap, tw, th, visibleColors, settings.colorTolerance, ss);

            // 3.4. 그라데이션 밴딩 병합
            //      — 그라데이션이 양자화로 쪼개진 미세 밴드를 면 단위로 통합
            //        (경계 대비가 큰 아웃라인·셀 셰이딩 경계는 유지)
            visibleColors = mergeGradientBanding(colorIndexMap, tw, th, visibleColors, pixels, settings.colorTolerance);

            // 3.5. 최소 면적 미만의 작은 연결 영역을 인접 다수 색으로 병합 (찌꺼기 제거)
            mergeSmallRegions(colorIndexMap, tw, th, minRegionArea, 3, visibleColors);

            // 4. 경계 그래프 → 전역 스무딩 → 공유 아크 추출 → 아크별 베지어 피팅
            setProgress("Image Trace: 경로 피팅", 20);
            // 피팅 허용 오차는 트레이스 공간 기준이므로 수퍼샘플 배율을 곱해
            // 결과(원본 좌표) 기준 단순화 강도를 배율과 무관하게 유지
            const fitError = Math.max(0.3, 0.4 + settings.pathTolerance * 0.6) * ss;
            const graph = buildBoundaryGraph(colorIndexMap, tw, th, visibleColors.length);
            // 정션을 포함한 모든 경계 정점을 스무딩 — 모든 색상이 같은 좌표를 공유하므로 틈 없음
            smoothBoundaryGraph(graph, tw, th, 3);
            const { arcs, edgeToArc } = extractArcs(graph, tw, th);
            for (const arc of arcs) fitArc(arc, graph, fitError);

            // 생성된 레이어 ID 추적 (그룹핑용)
            const createdLayerIds: number[] = [];

            // 5. 색상별로 아크를 이어붙여 윤곽 재구성 → Shape Layer 생성
            for (let ci = 0; ci < visibleColors.length; ci++) {
                const color = visibleColors[ci];
                setProgress(`Image Trace: 색상 ${ci + 1}/${visibleColors.length}`, 20 + (80 * ci) / visibleColors.length);
                const loops = linkColorLoops(graph.colorEdges[ci], graph.W1);
                const contours: any[] = [];
                for (const loop of loops) {
                    const contour = loopToContour(loop, graph.colorEdges[ci], graph, arcs, edgeToArc);
                    if (contour) contours.push(contour);
                }
                if (contours.length === 0) continue;

                const pathContents = buildTracePathContents(contours, offsetX, offsetY, scaleX, scaleY);
                const id = await createShapeFromPathContents(pathContents);
                await setShapeColor(color.r, color.g, color.b, id);
                createdLayerIds.push(id);
            }

            // 6. 생성된 Shape Layer들을 그룹으로 묶기
            if (createdLayerIds.length > 1) {
                await groupLayersByIds(createdLayerIds, layer.name + "_trace");
            }
        });
    } finally {
        clearProgress();
    }
}

// ==================== 설정 다이얼로그 ====================

// 세션 동안만 기억 (CAT과 동일하게 저장하지 않음)
let lastSettings = { colorTolerance: 10, pathTolerance: 0.5 };

// CAT의 2필드 다이얼로그를 입력 프롬프트 2회로 대체 (취소 시 null)
async function showTraceDialog(): Promise<{ colorTolerance: number; maxColors: number; pathTolerance: number } | null> {
    const c = await promptText("Image Trace — Color Tolerance (0-100)\n유사 색상 병합 강도. 높을수록 색상 수 감소", String(lastSettings.colorTolerance));
    if (c === null) return null;
    const p = await promptText("Image Trace — Path Smoothness (0-5)\n경로 단순화. 높을수록 정점 감소, 곡선 부드러움", String(lastSettings.pathTolerance));
    if (p === null) return null;
    const colorTol = Math.max(0, Math.min(100, parseInt(c) || 10));
    const pf = parseFloat(p);
    const pathTol = Math.max(0, Math.min(5, isNaN(pf) ? 0.5 : pf));
    lastSettings = { colorTolerance: colorTol, pathTolerance: pathTol };
    return { colorTolerance: colorTol, maxColors: 256, pathTolerance: pathTol };
}

// ==================== 투명 영역 색 번짐 ====================

// alpha=0 픽셀의 RGB를 8-이웃 불투명(또는 이전 패스에서 채운) 픽셀 평균으로 채운다 (passes 픽셀 폭)
function bleedTransparentRGB(px: Uint8Array, w: number, h: number, passes: number) {
    const filled = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) filled[i] = px[i * 4 + 3] > 0 ? 1 : 0;
    for (let pass = 0; pass < passes; pass++) {
        const updates: number[] = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (filled[i]) continue;
                let r = 0, g = 0, b = 0, n = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        const j = ny * w + nx;
                        if (!filled[j]) continue;
                        r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; n++;
                    }
                }
                if (n) updates.push(i, Math.round(r / n), Math.round(g / n), Math.round(b / n));
            }
        }
        if (updates.length === 0) break;
        for (let k = 0; k < updates.length; k += 4) {
            const i = updates[k];
            px[i * 4] = updates[k + 1]; px[i * 4 + 1] = updates[k + 2]; px[i * 4 + 2] = updates[k + 3];
            filled[i] = 1;
        }
    }
}

// ==================== 레이어 그룹핑 ====================

// 지정된 ID의 레이어들을 선택한 후 그룹으로 묶기
async function groupLayersByIds(layerIds: number[], groupName: string) {
    if (layerIds.length === 0) return;
    await selectLayers(layerIds);
    await makeGroupFromSelectLayers(groupName);
}

// ==================== 2배 업샘플 (Catmull-Rom) ====================

// RGBA 버퍼를 Catmull-Rom 바이큐빅 보간으로 정확히 2배 확대
// 수퍼샘플링 트레이스용 — 최근접 복제와 달리 경계에 서브픽셀 위치 정보가 생겨
// 계단 없이 매끄러운 경계 추출이 가능해짐
export function upscale2x(src: any, w: any, h: any): any {
    const W = w * 2, H = h * 2;
    // 출력 픽셀 중심의 소스 위상은 0.25 / 0.75 두 가지
    const W25 = [-0.0703125, 0.8671875, 0.2265625, -0.0234375];
    const W75 = [-0.0234375, 0.2265625, 0.8671875, -0.0703125];

    // 각 출력 좌표의 소스 4탭 인덱스/가중치 사전 계산
    const buildTaps = (n: any) => {
        const idx = new Int32Array(n * 8);
        const wts = new Float32Array(n * 8);
        for (let o = 0; o < n * 2; o++) {
            const s = o * 0.5 - 0.25;
            const i0 = Math.floor(s);
            const tw = (s - i0) < 0.5 ? W25 : W75;
            for (let k = 0; k < 4; k++) {
                idx[o * 4 + k] = Math.min(n - 1, Math.max(0, i0 - 1 + k));
                wts[o * 4 + k] = tw[k];
            }
        }
        return { idx, wts };
    };
    const tx = buildTaps(w), ty = buildTaps(h);

    // 수평 패스
    const tmp = new Float32Array(W * h * 4);
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        const orow = y * W * 4;
        for (let x = 0; x < W; x++) {
            const b = x * 4;
            const i0 = row + tx.idx[b] * 4, i1 = row + tx.idx[b + 1] * 4;
            const i2 = row + tx.idx[b + 2] * 4, i3 = row + tx.idx[b + 3] * 4;
            const w0 = tx.wts[b], w1 = tx.wts[b + 1], w2 = tx.wts[b + 2], w3 = tx.wts[b + 3];
            const o = orow + b;
            tmp[o] = w0 * src[i0] + w1 * src[i1] + w2 * src[i2] + w3 * src[i3];
            tmp[o + 1] = w0 * src[i0 + 1] + w1 * src[i1 + 1] + w2 * src[i2 + 1] + w3 * src[i3 + 1];
            tmp[o + 2] = w0 * src[i0 + 2] + w1 * src[i1 + 2] + w2 * src[i2 + 2] + w3 * src[i3 + 2];
            tmp[o + 3] = w0 * src[i0 + 3] + w1 * src[i1 + 3] + w2 * src[i2 + 3] + w3 * src[i3 + 3];
        }
    }

    // 수직 패스
    const out = new Uint8ClampedArray(W * H * 4);
    const stride = W * 4;
    for (let y = 0; y < H; y++) {
        const b = y * 4;
        const r0 = ty.idx[b] * stride, r1 = ty.idx[b + 1] * stride;
        const r2 = ty.idx[b + 2] * stride, r3 = ty.idx[b + 3] * stride;
        const w0 = ty.wts[b], w1 = ty.wts[b + 1], w2 = ty.wts[b + 2], w3 = ty.wts[b + 3];
        const orow = y * stride;
        for (let i = 0; i < stride; i++) {
            out[orow + i] = w0 * tmp[r0 + i] + w1 * tmp[r1 + i] + w2 * tmp[r2 + i] + w3 * tmp[r3 + i];
        }
    }
    return out;
}

// ==================== 전처리: 알파 이진화 + 경계 선명화 ====================

// 애매한 알파 영역 제거 — 반투명 픽셀을 이진화하여 선명한 경계 확보
// 색상값은 원본 그대로 유지 (존재하지 않는 색상 생성 방지)
export function preprocessPixels(pixels: any, _w: any, _h: any): any {
    const result = new Uint8Array(pixels.length);

    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) {
            // 반투명 → 완전 투명
            result[i] = 0;
            result[i + 1] = 0;
            result[i + 2] = 0;
            result[i + 3] = 0;
        } else {
            // 불투명 → 원본 색상 유지, 알파만 255로 고정
            result[i] = pixels[i];
            result[i + 1] = pixels[i + 1];
            result[i + 2] = pixels[i + 2];
            result[i + 3] = 255;
        }
    }

    return result;
}

// ==================== 레이어 그룹핑 ====================

// 지정된 ID의 레이어들을 선택한 후 그룹으로 묶기

// ==================== 색상 양자화 ====================

export function quantizeColors(pixels: any, _w: any, _h: any, tolerance: any, maxColors: any): any {
    const colorMap = new Map();
    const snap = 4;

    for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        if (a < 10) continue;

        // 스냅은 버킷팅용으로만 사용, 원본 색상값은 합산 보존
        const r = Math.round(pixels[i] / snap) * snap;
        const g = Math.round(pixels[i + 1] / snap) * snap;
        const b = Math.round(pixels[i + 2] / snap) * snap;
        const key = (r << 16) | (g << 8) | b;

        if (colorMap.has(key)) {
            const entry = colorMap.get(key);
            entry.count++;
            entry.sumR += pixels[i];
            entry.sumG += pixels[i + 1];
            entry.sumB += pixels[i + 2];
        } else {
            colorMap.set(key, { r, g, b, a: 255, count: 1, sumR: pixels[i], sumG: pixels[i + 1], sumB: pixels[i + 2] });
        }
    }

    // 스냅 색상 대신 원본 평균색 사용 (색상 정밀도 향상)
    let colors = [...colorMap.values()].map((c: any) => ({
        r: Math.round(c.sumR / c.count),
        g: Math.round(c.sumG / c.count),
        b: Math.round(c.sumB / c.count),
        a: c.a,
        count: c.count
    })).sort((a: any, b: any) => b.count - a.count);

    // 유사 색상 병합 (가중 평균으로 대표색 결정)
    const tolDist = tolerance * 2.55;
    const merged: any[] = [];
    for (const c of colors) {
        let found = false;
        for (const m of merged) {
            const dr = c.r - m.r, dg = c.g - m.g, db = c.b - m.b;
            if (Math.sqrt(dr * dr + dg * dg + db * db) <= tolDist) {
                const total = m.count + c.count;
                m.r = Math.round((m.r * m.count + c.r * c.count) / total);
                m.g = Math.round((m.g * m.count + c.g * c.count) / total);
                m.b = Math.round((m.b * m.count + c.b * c.count) / total);
                m.count = total;
                found = true;
                break;
            }
        }
        if (!found) merged.push({ r: c.r, g: c.g, b: c.b, a: c.a, count: c.count });
    }

    return merged.sort((a: any, b: any) => b.count - a.count).slice(0, maxColors);
}

// ==================== 색상 인덱스 맵 생성 ====================

// 모든 비투명 픽셀을 가장 가까운 색상에 강제 배정
// 모든 픽셀이 하나의 색상에 소속되므로 경계 틈이 원천 제거됨
export function buildColorIndexMap(pixels: any, w: any, h: any, colors: any): any {
    const map = new Int16Array(w * h).fill(-1); // -1 = 투명

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            if (pixels[idx + 3] < 10) continue; // 투명 픽셀 스킵

            const pr = pixels[idx], pg = pixels[idx + 1], pb = pixels[idx + 2];
            let minDist = Infinity;
            let bestIdx = 0;

            for (let ci = 0; ci < colors.length; ci++) {
                const c = colors[ci];
                const dr = pr - c.r, dg = pg - c.g, db = pb - c.b;
                const dist = dr * dr + dg * dg + db * db; // 제곱 거리 (sqrt 생략)
                if (dist < minDist) {
                    minDist = dist;
                    bestIdx = ci;
                }
            }

            map[y * w + x] = bestIdx;
        }
    }
    return map;
}

// ==================== 안티에일리어싱 혼합색 흡수 ====================

// RGB 공간에서 두 상위 색상 사이(선분 근처)에 위치하면서 내부 픽셀 비율이 낮은 색상을
// 안티에일리어싱 전이색으로 판정하고, 해당 픽셀을 인접 영역 다수결로 재배정 (in-place)
// — 양쪽 영역에서 대칭적으로 성장하므로 경계가 전이 띠의 중앙을 매끄럽게 지나게 됨
export function absorbMixtureColors(map: any, w: any, h: any, colors: any, tolerance: any, step: any = 1): any {
    const n = colors.length;
    if (n < 3) return;
    const total = w * h;

    // 1) 색상별 픽셀 수 집계
    const countPx = new Float64Array(n);
    for (let i = 0; i < total; i++) {
        if (map[i] >= 0) countPx[map[i]]++;
    }

    // 2) RGB 공간에서 두 상위 색상 쌍의 선분 근처에 있는 색 = 혼합(전이) 후보
    //    (전역 프리필터일 뿐 — 실제 흡수는 3)에서 컴포넌트별 인접 색 기준으로 재검증.
    //     색이 많은 일러스트에서는 상위 색 쌍의 선분이 RGB 공간 대부분을 덮어
    //     넥타이·눈동자 같은 진짜 디테일 색까지 후보로 잡히기 때문)
    const order = [...Array(n).keys()].filter((ci: any) => countPx[ci] > 0).sort((a: any, b: any) => countPx[b] - countPx[a]);
    const mixTol = Math.max(20, tolerance * 2.55);
    const strong: any[] = [];
    const candidate = new Uint8Array(n);
    for (const ci of order) {
        let isMix = false;
        const c = colors[ci];
        for (let a = 0; a < strong.length && !isMix; a++) {
            for (let b = a + 1; b < strong.length && !isMix; b++) {
                if (distToRGBSegment(c, colors[strong[a]], colors[strong[b]]) < mixTol) isMix = true;
            }
        }
        if (isMix) candidate[ci] = 1;
        else strong.push(ci);
    }
    if (strong.length === order.length) return;

    // 3) 후보 색상의 연결 컴포넌트별 이중 검증 후 흡수 대상 선정
    //    (a) 얇음 — 깊은 내부 픽셀 비율 < 0.2 (뭉쳐 있는 실제 디테일은 유지)
    //    (b) 실제 전이 — 컴포넌트 색이 '실제로 인접한' 상위 두 색의 RGB 선분 근처일 때만.
    //        (b) 검증이 없으면 우연히 다른 색 쌍의 선분 근처에 있는 진짜 디테일
    //        (눈동자·넥타이·무늬 등)까지 통째로 흡수되어 이미지가 뭉개진다
    const dist = step * 2;
    const so = dist * w;
    const weak = new Uint8Array(total);
    const labeled = new Uint8Array(total);
    const stack = new Int32Array(total);
    let weakCount = 0;

    for (let start = 0; start < total; start++) {
        if (labeled[start]) continue;
        const ci = map[start];
        if (ci < 0 || !candidate[ci]) continue;

        let sp = 0;
        stack[sp++] = start;
        labeled[start] = 1;
        const comp: any[] = [];
        let deep = 0;
        const nbrCount = new Map(); // 인접 색상별 접촉 빈도 (경계 접촉 길이 근사)

        while (sp > 0) {
            const cur = stack[--sp];
            comp.push(cur);
            const x = cur % w, y = (cur / w) | 0;
            if (x >= dist && y >= dist && x < w - dist && y < h - dist &&
                map[cur - dist] === ci && map[cur + dist] === ci && map[cur - so] === ci && map[cur + so] === ci) {
                deep++;
            }
            const nbs = [
                x > 0 ? cur - 1 : -1,
                x < w - 1 ? cur + 1 : -1,
                y > 0 ? cur - w : -1,
                y < h - 1 ? cur + w : -1
            ];
            for (const nb of nbs) {
                if (nb < 0) continue;
                const nc = map[nb];
                if (nc === ci) {
                    if (!labeled[nb]) { labeled[nb] = 1; stack[sp++] = nb; }
                } else {
                    nbrCount.set(nc, (nbrCount.get(nc) || 0) + 1);
                }
            }
        }

        if (deep / comp.length >= 0.2) continue; // 뭉쳐 있는 실제 디테일 — 유지

        // 인접 상위 두 색 추출 (투명 제외)
        let n1 = -1, c1 = 0, n2 = -1, c2 = 0, colored = 0;
        for (const [nc, cnt] of nbrCount) {
            if (nc < 0) continue;
            colored += cnt;
            if (cnt > c1) { n2 = n1; c2 = c1; n1 = nc; c1 = cnt; }
            else if (cnt > c2) { n2 = nc; c2 = cnt; }
        }

        let isTransition = false;
        const c = colors[ci];
        if (n2 >= 0 && c1 + c2 >= colored * 0.7) {
            // 두 색 사이에 낀 띠: 그 두 색의 실제 혼합일 때만 전이로 판정
            isTransition = distToRGBSegment(c, colors[n1], colors[n2]) < mixTol;
        } else if (n1 >= 0 && n2 < 0) {
            // 한 색에만 둘러싸인 얇은 조각: 유사색 프린지만 흡수 (하이라이트 등 내부 디테일 보호)
            const dr = c.r - colors[n1].r, dg = c.g - colors[n1].g, db = c.b - colors[n1].b;
            isTransition = Math.sqrt(dr * dr + dg * dg + db * db) < mixTol;
        }
        if (!isTransition) continue;

        for (const i of comp) weak[i] = 1;
        weakCount += comp.length;
    }
    if (weakCount === 0) return;

    // 4) 웨이브 단위 다중 소스 성장으로 재배정
    //    스캔라인 순회 배정은 같은 패스 안에서 색이 진행 방향으로 연쇄 전파되어
    //    가로 줄무늬가 생기므로, 라운드마다 '확정된 이웃'만으로 일괄 배정하여
    //    양쪽 영역이 대칭 성장 → 경계가 전이 띠의 중앙을 지나게 함
    const inFrontier = new Uint8Array(total);
    let frontier: any[] = [];
    for (let i = 0; i < total; i++) {
        if (!weak[i]) continue;
        const x = i % w, y = (i / w) | 0;
        if ((x > 0 && !weak[i - 1]) || (x < w - 1 && !weak[i + 1]) ||
            (y > 0 && !weak[i - w]) || (y < h - 1 && !weak[i + w])) {
            inFrontier[i] = 1;
            frontier.push(i);
        }
    }
    let guard = w + h + 8;
    while (frontier.length > 0 && weakCount > 0 && guard-- > 0) {
        const assigned: any[] = [];
        for (const i of frontier) {
            if (!weak[i]) continue;
            const x = i % w, y = (i / w) | 0;
            const nbs = [
                x > 0 ? i - 1 : -1,
                x < w - 1 ? i + 1 : -1,
                y > 0 ? i - w : -1,
                y < h - 1 ? i + w : -1
            ];
            let best = null, bestCnt = 0, transparentCnt = 0;
            const counts = new Map();
            for (const nb of nbs) {
                if (nb < 0 || weak[nb]) continue;
                const nc = map[nb];
                if (nc === -1) { transparentCnt++; continue; }
                const cnt = (counts.get(nc) || 0) + 1;
                counts.set(nc, cnt);
                if (cnt > bestCnt) { bestCnt = cnt; best = nc; }
            }
            if (best !== null) assigned.push(i, best);
            else if (transparentCnt > 0) assigned.push(i, -1);
        }
        if (assigned.length === 0) break;
        // 라운드 내 배정은 라운드 시작 시점의 확정 상태만 참조 → 여기서 일괄 반영
        for (let k = 0; k < assigned.length; k += 2) {
            map[assigned[k]] = assigned[k + 1];
            weak[assigned[k]] = 0;
            weakCount--;
        }
        const next: any[] = [];
        for (let k = 0; k < assigned.length; k += 2) {
            const i = assigned[k];
            const x = i % w, y = (i / w) | 0;
            const nbs = [
                x > 0 ? i - 1 : -1,
                x < w - 1 ? i + 1 : -1,
                y > 0 ? i - w : -1,
                y < h - 1 ? i + w : -1
            ];
            for (const nb of nbs) {
                if (nb >= 0 && weak[nb] && !inFrontier[nb]) { inFrontier[nb] = 1; next.push(nb); }
            }
        }
        frontier = next;
    }
}

// RGB 공간에서 점 c와 선분 a-b 사이의 거리 (혼합색 판정용)
export function distToRGBSegment(c: any, a: any, b: any): any {
    const abR = b.r - a.r, abG = b.g - a.g, abB = b.b - a.b;
    const len2 = abR * abR + abG * abG + abB * abB;
    let t = len2 > 0 ? ((c.r - a.r) * abR + (c.g - a.g) * abG + (c.b - a.b) * abB) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dr = c.r - (a.r + t * abR), dg = c.g - (a.g + t * abG), db = c.b - (a.b + t * abB);
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

// ==================== 그라데이션 밴딩 병합 ====================

// 그라데이션이 양자화로 잘게 쪼개진 밴드(영역)들을 면 단위로 통합 (map in-place 갱신)
// 판정 기준 두 가지를 모두 만족할 때만 인접 영역을 병합:
//   (a) 실제 픽셀 경계가 부드러움 — 경계 양쪽 픽셀 RGB 차 평균 < softEdge
//       (양자화 밴딩의 경계는 원본에서 매끄러운 램프라 차이가 작고,
//        아웃라인·셀 셰이딩 경계는 대비가 커서 그대로 유지됨)
//   (b) 병합 그룹 평균색 거리 < maxGroupDist — 긴 그라데이션이 통째로
//       한 색이 되지 않도록 명도 이동 폭 제한
// 반환: 새 팔레트 배열 (map의 인덱스는 새 팔레트 기준으로 갱신됨)
export function mergeGradientBanding(map: any, w: any, h: any, colors: any, pixels: any, tolerance: any): any {
    const softEdge = 10;
    const maxGroupDist = Math.max(24, tolerance * 2.55);
    const total = w * h;

    // 1) 4-연결 영역 라벨링
    const region = new Int32Array(total).fill(-1);
    const regionColor: any[] = []; // 영역 → 기존 색 인덱스
    const regionSize: any[] = [];
    const stack = new Int32Array(total);
    for (let start = 0; start < total; start++) {
        if (region[start] >= 0 || map[start] < 0) continue;
        const ci = map[start];
        const rid = regionColor.length;
        let size = 0;
        let sp = 0;
        stack[sp++] = start;
        region[start] = rid;
        while (sp > 0) {
            const cur = stack[--sp];
            size++;
            const x = cur % w, y = (cur / w) | 0;
            const nbs = [
                x > 0 ? cur - 1 : -1,
                x < w - 1 ? cur + 1 : -1,
                y > 0 ? cur - w : -1,
                y < h - 1 ? cur + w : -1
            ];
            for (const nb of nbs) {
                if (nb >= 0 && region[nb] < 0 && map[nb] === ci) { region[nb] = rid; stack[sp++] = nb; }
            }
        }
        regionColor.push(ci);
        regionSize.push(size);
    }
    const numRegions = regionColor.length;
    if (numRegions < 2) return colors;

    // 2) 인접 영역 쌍별 경계 대비 측정 (원본 픽셀 RGB 차의 평균)
    const pairStats = new Map(); // key = 작은쪽*numRegions+큰쪽 → { cnt, sum }
    const measure = (i: any, j: any) => {
        const ra = region[i], rb = region[j];
        if (ra < 0 || rb < 0 || ra === rb) return;
        const pi = i * 4, pj = j * 4;
        const dr = pixels[pi] - pixels[pj], dg = pixels[pi + 1] - pixels[pj + 1], db = pixels[pi + 2] - pixels[pj + 2];
        const d = Math.sqrt(dr * dr + dg * dg + db * db);
        const key = ra < rb ? ra * numRegions + rb : rb * numRegions + ra;
        const st = pairStats.get(key);
        if (st) { st.cnt++; st.sum += d; }
        else pairStats.set(key, { cnt: 1, sum: d });
    };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (region[i] < 0) continue;
            if (x < w - 1) measure(i, i + 1);
            if (y < h - 1) measure(i, i + w);
        }
    }

    // 3) 경계가 부드러운 쌍부터 union-find 병합 (그룹 평균색 거리로 이동 폭 제한)
    const parent = new Int32Array(numRegions);
    for (let r = 0; r < numRegions; r++) parent[r] = r;
    const find = (r: any) => {
        while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; }
        return r;
    };
    const gCount = new Float64Array(numRegions);
    const gR = new Float64Array(numRegions), gG = new Float64Array(numRegions), gB = new Float64Array(numRegions);
    for (let r = 0; r < numRegions; r++) {
        const c = colors[regionColor[r]];
        gCount[r] = regionSize[r];
        gR[r] = c.r * regionSize[r];
        gG[r] = c.g * regionSize[r];
        gB[r] = c.b * regionSize[r];
    }

    const edges: any[] = [];
    for (const [key, st] of pairStats) {
        const soft = st.sum / st.cnt;
        if (soft >= softEdge) continue; // 선명한 경계 — 유지
        edges.push({ a: (key / numRegions) | 0, b: key % numRegions, soft });
    }
    edges.sort((p: any, q: any) => p.soft - q.soft);

    let mergedCnt = 0;
    for (const e of edges) {
        const ra = find(e.a), rb = find(e.b);
        if (ra === rb) continue;
        const dr = gR[ra] / gCount[ra] - gR[rb] / gCount[rb];
        const dg = gG[ra] / gCount[ra] - gG[rb] / gCount[rb];
        const db = gB[ra] / gCount[ra] - gB[rb] / gCount[rb];
        if (Math.sqrt(dr * dr + dg * dg + db * db) > maxGroupDist) continue;
        // 큰 그룹을 루트로 유지
        const big = gCount[ra] >= gCount[rb] ? ra : rb;
        const small = big === ra ? rb : ra;
        parent[small] = big;
        gCount[big] += gCount[small];
        gR[big] += gR[small];
        gG[big] += gG[small];
        gB[big] += gB[small];
        mergedCnt++;
    }
    if (mergedCnt === 0) return colors;

    // 4) 그룹 대표색 수집 (동일 색 dedupe)
    const paletteKey = new Map(); // rgb 키 → 그룹색 인덱스
    const groupColors: any[] = [];
    const regionGroupIdx = new Int32Array(numRegions);
    for (let r = 0; r < numRegions; r++) {
        const root = find(r);
        const cr = Math.round(gR[root] / gCount[root]);
        const cg = Math.round(gG[root] / gCount[root]);
        const cb = Math.round(gB[root] / gCount[root]);
        const key = (cr << 16) | (cg << 8) | cb;
        let idx = paletteKey.get(key);
        if (idx === undefined) {
            idx = groupColors.length;
            paletteKey.set(key, idx);
            groupColors.push({ r: cr, g: cg, b: cb, a: 255, count: 0 });
        }
        groupColors[idx].count += regionSize[r];
        regionGroupIdx[r] = idx;
    }

    // 5) 팔레트 통합: 지각상 구분 안 되는 근접 그룹색을 가중 평균으로 병합
    //    (그룹마다 평균색이 미세하게 달라 팔레트/레이어 수가 폭발하는 것 방지.
    //     같은 팔레트가 된 인접 영역은 경계가 사라져 면으로 자연스럽게 이어짐)
    const consolidateTol = Math.max(8, tolerance * 2.55);
    const order2 = [...groupColors.keys()].sort((a: any, b: any) => groupColors[b].count - groupColors[a].count);
    const newColors: any[] = [];
    const groupToFinal = new Int32Array(groupColors.length);
    for (const gi of order2) {
        const c = groupColors[gi];
        let found = -1;
        for (let mi = 0; mi < newColors.length; mi++) {
            const m = newColors[mi];
            const dr = c.r - m.r, dg = c.g - m.g, db = c.b - m.b;
            if (Math.sqrt(dr * dr + dg * dg + db * db) <= consolidateTol) { found = mi; break; }
        }
        if (found >= 0) {
            const m = newColors[found];
            const totalCnt = m.count + c.count;
            m.r = Math.round((m.r * m.count + c.r * c.count) / totalCnt);
            m.g = Math.round((m.g * m.count + c.g * c.count) / totalCnt);
            m.b = Math.round((m.b * m.count + c.b * c.count) / totalCnt);
            m.count = totalCnt;
            groupToFinal[gi] = found;
        } else {
            groupToFinal[gi] = newColors.length;
            newColors.push({ r: c.r, g: c.g, b: c.b, a: 255, count: c.count });
        }
    }

    for (let i = 0; i < total; i++) {
        if (region[i] >= 0) map[i] = groupToFinal[regionGroupIdx[region[i]]];
    }
    return newColors;
}

// ==================== 작은 영역 병합 ====================

// 4-연결 컴포넌트 중 minArea 미만인 영역을 인접 색으로 흡수 (in-place)
// 색상 찌꺼기와 미세 구멍이 사라져 경계 그래프가 깨끗해짐
// colors 전달 시: 충분히 접촉한 이웃 중 RGB 최근접 색으로 병합
//   — 입술·볼터치처럼 여러 색 조각으로 나뉜 얇은 디테일이 주변색(피부 등)으로
//     사라지지 않고 같은 계열 핵심 색으로 뭉쳐 다음 패스에서 살아남는다
export function mergeSmallRegions(map: any, w: any, h: any, minArea: any, maxPasses: any = 3, colors: any = null): any {
    const total = w * h;
    const cap = Math.ceil(minArea);
    const stack = new Int32Array(total);

    for (let pass = 0; pass < maxPasses; pass++) {
        const labeled = new Uint8Array(total);
        let changed = false;

        for (let start = 0; start < total; start++) {
            if (labeled[start]) continue;

            const ci = map[start];
            let sp = 0;
            stack[sp++] = start;
            labeled[start] = 1;

            const comp: any[] = [];         // 병합 판단용 픽셀 목록 (cap 초과 시 수집 중단)
            let size = 0;
            let touchesBorder = false;
            const nbrCount = new Map(); // 인접 색상 빈도

            while (sp > 0) {
                const cur = stack[--sp];
                size++;
                if (size <= cap) comp.push(cur);
                const x = cur % w, y = (cur / w) | 0;
                if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;

                // 4방향 이웃 탐색
                const nbrs = [
                    x > 0 ? cur - 1 : -1,
                    x < w - 1 ? cur + 1 : -1,
                    y > 0 ? cur - w : -1,
                    y < h - 1 ? cur + w : -1
                ];
                for (const nb of nbrs) {
                    if (nb < 0) continue;
                    const nc = map[nb];
                    if (nc === ci) {
                        if (!labeled[nb]) { labeled[nb] = 1; stack[sp++] = nb; }
                    } else {
                        nbrCount.set(nc, (nbrCount.get(nc) || 0) + 1);
                    }
                }
            }

            if (size >= minArea) continue;
            // 캔버스 경계에 닿은 투명 영역(외곽 배경)은 유지
            if (ci === -1 && touchesBorder) continue;

            // 최다 인접 색으로 병합
            let best = null, bestCnt = 0;
            for (const [c, cnt] of nbrCount) {
                if (cnt > bestCnt) { bestCnt = cnt; best = c; }
            }
            if (best === null) continue;

            // colors 제공 시: 접촉이 최다치의 25% 이상인 이웃 중 RGB 최근접 색 우선
            if (colors && ci >= 0) {
                const c0 = colors[ci];
                let bestDist = Infinity, bestColored = null;
                for (const [nc, cnt] of nbrCount) {
                    if (nc < 0 || cnt < bestCnt * 0.25) continue;
                    const cc = colors[nc];
                    const dr = c0.r - cc.r, dg = c0.g - cc.g, db = c0.b - cc.b;
                    const d = dr * dr + dg * dg + db * db;
                    if (d < bestDist) { bestDist = d; bestColored = nc; }
                }
                if (bestColored !== null) best = bestColored;
            }
            for (const idx of comp) map[idx] = best;
            changed = true;
        }

        if (!changed) break;
    }
}

// ==================== 색상 경계 그래프 ====================
//
// 격자 정점 id: vid = y * (w+1) + x  (픽셀 코너 좌표, x∈[0,w], y∈[0,h])
// 무방향 에지 id: 수평 (x,y)-(x+1,y) → vid*2, 수직 (x,y)-(x,y+1) → vid*2+1
// 방향 에지: 각 색상 영역이 진행 방향의 오른쪽에 내부를 두도록 생성
//   → 인접한 두 색상은 같은 무방향 에지를 서로 반대 방향으로 소유

export function buildBoundaryGraph(map: any, w: any, h: any, numColors: any): any {
    const W1 = w + 1;
    const at = (x: any, y: any) => (x < 0 || x >= w || y < 0 || y >= h) ? -1 : map[y * w + x];
    const edgeSet = new Set<number>();
    // 색상별 방향 에지: [from0, to0, from1, to1, ...]
    const colorEdges = Array.from({ length: numColors }, (): any[] => []);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = at(x, y);
            const vTL = y * W1 + x, vTR = vTL + 1, vBL = vTL + W1, vBR = vBL + 1;

            if (at(x, y - 1) !== c) { // 상
                edgeSet.add(vTL * 2);
                if (c !== -1) colorEdges[c].push(vTL, vTR);
            }
            if (at(x + 1, y) !== c) { // 우
                edgeSet.add(vTR * 2 + 1);
                if (c !== -1) colorEdges[c].push(vTR, vBR);
            }
            if (at(x, y + 1) !== c) { // 하
                edgeSet.add(vBL * 2);
                if (c !== -1) colorEdges[c].push(vBR, vBL);
            }
            if (at(x - 1, y) !== c) { // 좌
                edgeSet.add(vTL * 2 + 1);
                if (c !== -1) colorEdges[c].push(vBL, vTL);
            }
        }
    }

    // 정점 차수 (차수≠2 = 정션: 3색 이상이 만나는 지점)
    const deg = new Uint8Array(W1 * (h + 1));
    for (const eid of edgeSet) {
        const v1 = eid >> 1;
        const v2 = (eid & 1) ? v1 + W1 : v1 + 1;
        deg[v1]++;
        deg[v2]++;
    }

    return { W1, edgeSet, colorEdges, deg };
}

// ==================== 경계 그래프 전역 스무딩 ====================

// 정션을 포함한 모든 경계 정점을 이웃 평균으로 이동시켜 픽셀 계단을 제거
// 모든 색상 영역이 같은 정점 좌표를 공유하므로 스무딩 후에도 틈이 생기지 않음
// 캔버스 테두리 정점은 고정 (이미지 가장자리 유지)
export function smoothBoundaryGraph(graph: any, w: any, h: any, passes: any = 3): any {
    const { W1, edgeSet } = graph;

    // 경계 정점별 이웃 목록
    const nbrMap = new Map();
    const addNbr = (a: any, b: any) => {
        let l = nbrMap.get(a);
        if (!l) { l = []; nbrMap.set(a, l); }
        l.push(b);
    };
    for (const eid of edgeSet) {
        const v1 = eid >> 1;
        const v2 = (eid & 1) ? v1 + W1 : v1 + 1;
        addNbr(v1, v2);
        addNbr(v2, v1);
    }

    let pos = new Map();
    for (const v of nbrMap.keys()) {
        pos.set(v, { x: v % W1, y: (v / W1) | 0 });
    }

    for (let p = 0; p < passes; p++) {
        const next = new Map();
        for (const [v, list] of nbrMap) {
            const cur = pos.get(v);
            const x0 = v % W1, y0 = (v / W1) | 0;
            if (x0 === 0 || y0 === 0 || x0 === w || y0 === h) {
                next.set(v, cur);
                continue;
            }
            let sx = 0, sy = 0;
            for (const nb of list) {
                const np = pos.get(nb);
                sx += np.x;
                sy += np.y;
            }
            const n = list.length;
            next.set(v, { x: (cur.x * 2 + sx) / (2 + n), y: (cur.y * 2 + sy) / (2 + n) });
        }
        pos = next;
    }

    graph.smoothPos = pos;
}

// ==================== 공유 아크 추출 ====================

// 경계 그래프를 정션 사이의 체인(아크)으로 분해
// 각 아크는 인접한 두 영역이 공유하며, 피팅도 아크당 1회만 수행됨
export function extractArcs(graph: any, w: any, h: any): any {
    const { W1, edgeSet, deg } = graph;
    const visited = new Set();
    const arcs: any[] = [];
    const edgeToArc = new Map(); // eid → { arcIdx, pos }

    const otherEnd = (eid: any, v: any) => {
        const v1 = eid >> 1;
        const v2 = (eid & 1) ? v1 + W1 : v1 + 1;
        return v === v1 ? v2 : v1;
    };
    // 정점에 인접한 경계 에지 목록 (저장 없이 좌표에서 계산)
    const incident = (v: any) => {
        const x = v % W1, y = (v / W1) | 0;
        const out: any[] = [];
        if (x < w && edgeSet.has(v * 2)) out.push(v * 2);
        if (x > 0 && edgeSet.has((v - 1) * 2)) out.push((v - 1) * 2);
        if (y < h && edgeSet.has(v * 2 + 1)) out.push(v * 2 + 1);
        if (y > 0 && edgeSet.has((v - W1) * 2 + 1)) out.push((v - W1) * 2 + 1);
        return out;
    };

    const walk = (startV: any, startE: any, closedLoop: any) => {
        const vids = [startV];
        const eids: any[] = [];
        let v = startV, e = startE;
        let guard = edgeSet.size + 1;

        while (guard-- > 0) {
            visited.add(e);
            edgeToArc.set(e, { arcIdx: arcs.length, pos: eids.length });
            eids.push(e);
            v = otherEnd(e, v);
            if (closedLoop && v === startV) break;
            if (!closedLoop && deg[v] !== 2) { vids.push(v); break; }
            vids.push(v);
            // 차수 2 정점: 남은 한 에지로 계속 진행
            let nxt = -1;
            for (const cand of incident(v)) {
                if (cand !== e && !visited.has(cand)) { nxt = cand; break; }
            }
            if (nxt === -1) break; // 안전장치
            e = nxt;
        }

        arcs.push({ vids, eids, closed: closedLoop, segments: null, revSegments: null });
    };

    // 1) 정션에서 시작하는 열린 아크
    for (const eid of edgeSet) {
        if (visited.has(eid)) continue;
        const v1 = eid >> 1;
        const v2 = (eid & 1) ? v1 + W1 : v1 + 1;
        if (deg[v1] !== 2) walk(v1, eid, false);
        else if (deg[v2] !== 2) walk(v2, eid, false);
    }
    // 2) 정션이 없는 순수 폐루프 (독립된 윤곽)
    for (const eid of edgeSet) {
        if (visited.has(eid)) continue;
        walk(eid >> 1, eid, true);
    }

    return { arcs, edgeToArc };
}

// 아크 폴리라인 베지어 피팅 (전역 스무딩된 정점 좌표 사용 — 양쪽 영역이 정확히 일치)
export function fitArc(arc: any, graph: any, fitError: any): any {
    const { W1, smoothPos } = graph;
    const pts = arc.vids.map((v: any) => {
        const p = smoothPos && smoothPos.get(v);
        return p ? { x: p.x, y: p.y } : { x: v % W1, y: (v / W1) | 0 };
    });
    arc.segments = fitPathSegments(pts, arc.closed, fitError, 60, 2);
    arc.revSegments = reverseSegments(arc.segments);
}

// ==================== 색상별 윤곽 재구성 ====================

// 색상의 방향 에지들을 폐루프로 연결 (분기 정점에서는 우회전 우선 → 4-연결 유지)
export function linkColorLoops(edgeArr: any, W1: any): any {
    const m = edgeArr.length / 2;
    const outMap = new Map(); // fromVid → [edgeIdx...]
    for (let i = 0; i < m; i++) {
        const from = edgeArr[i * 2];
        if (!outMap.has(from)) outMap.set(from, []);
        outMap.get(from).push(i);
    }

    const used = new Uint8Array(m);
    const loops: any[] = [];

    for (let s = 0; s < m; s++) {
        if (used[s]) continue;
        const loop: any[] = [];
        let cur = s;
        let guard = m + 1;

        while (guard-- > 0 && !used[cur]) {
            used[cur] = 1;
            loop.push(cur);
            const from = edgeArr[cur * 2], to = edgeArr[cur * 2 + 1];
            const cands = (outMap.get(to) || []).filter((i: any) => !used[i]);
            if (cands.length === 0) break;
            if (cands.length === 1) { cur = cands[0]; continue; }

            // 분기 정점: 진입 방향 기준 우회전 > 직진 > 좌회전 순으로 선택
            const d = to - from;
            const dx = d === 1 ? 1 : d === -1 ? -1 : 0;
            const dy = d === W1 ? 1 : d === -W1 ? -1 : 0;
            let best = cands[0], bestScore = -Infinity;
            for (const i of cands) {
                const d2 = edgeArr[i * 2 + 1] - edgeArr[i * 2];
                const ex = d2 === 1 ? 1 : d2 === -1 ? -1 : 0;
                const ey = d2 === W1 ? 1 : d2 === -W1 ? -1 : 0;
                const cross = dx * ey - dy * ex; // >0 = 우회전 (스크린 좌표)
                const dot = dx * ex + dy * ey;
                const score = cross > 0 ? 2 : (dot > 0 ? 1 : (cross < 0 ? 0 : -1));
                if (score > bestScore) { bestScore = score; best = i; }
            }
            cur = best;
        }

        if (loop.length >= 4) loops.push(loop); // 최소 폐루프 = 픽셀 1개 (에지 4개)
    }

    return loops;
}

// 방향 에지 루프를 아크 단위로 분절하여 베지어 세그먼트 윤곽으로 변환
export function loopToContour(loop: any, edgeArr: any, graph: any, arcs: any, edgeToArc: any): any {
    const { W1, deg } = graph;

    // 방향 에지 → { from, to, eid }
    let seq = loop.map((i: any) => {
        const from = edgeArr[i * 2], to = edgeArr[i * 2 + 1];
        const lo = Math.min(from, to);
        const eid = (Math.abs(to - from) === 1) ? lo * 2 : lo * 2 + 1;
        return { from, to, eid };
    });

    // 정션 정점이 시작점이 되도록 회전 (아크 경계와 정렬)
    for (let k = 0; k < seq.length; k++) {
        if (deg[seq[k].from] !== 2) {
            if (k > 0) seq = [...seq.slice(k), ...seq.slice(0, k)];
            break;
        }
    }

    // 격자 정점 슈레이스 면적 — interior-on-right 규약상 바깥 윤곽 = 양수, 구멍 = 음수
    let area2 = 0;
    for (const e of seq) {
        const x1 = e.from % W1, y1 = (e.from / W1) | 0;
        const x2 = e.to % W1, y2 = (e.to / W1) | 0;
        area2 += x1 * y2 - x2 * y1;
    }

    // 아크 단위로 세그먼트 이어붙이기 (공유 아크는 방향만 뒤집어 재사용)
    const segments: any[] = [];
    let i = 0;
    let guard = seq.length + 4;
    while (i < seq.length && guard-- > 0) {
        const e0 = seq[i];
        const ref = edgeToArc.get(e0.eid);
        if (!ref) return null; // 방어: 그래프 불일치
        const arc = arcs[ref.arcIdx];
        const forward = arc.vids[ref.pos] === e0.from;
        segments.push(...(forward ? arc.segments : arc.revSegments));
        i += arc.eids.length;
    }

    if (segments.length === 0) return null;
    return { segments, isHole: area2 < 0, area: Math.abs(area2) / 2 };
}

// ==================== pathContents 생성 ====================

export function buildTracePathContents(contours: any, offsetX: any, offsetY: any, scaleX: any = 1, scaleY: any = 1): any {
    function pt(x: any, y: any): any {
        return {
            _obj: "paint",
            horizontal: { _unit: "pixelsUnit", _value: x * scaleX + offsetX },
            vertical: { _unit: "pixelsUnit", _value: y * scaleY + offsetY }
        };
    }

    // Photoshop은 컴포넌트를 순차 결합하므로 컨테이너가 내용물보다 먼저 와야 함
    // → 면적 내림차순 정렬 (바깥 윤곽 → 그 안의 구멍 → 구멍 안의 윤곽 → ...)
    const ordered = [...contours].sort((a: any, b: any) => b.area - a.area);

    return {
        _obj: "pathClass",
        pathComponents: ordered.map((ct: any) => ({
            _obj: "pathComponent",
            shapeOperation: { _enum: "shapeOperation", _value: ct.isHole ? "xor" : "add" },
            subpathListKey: [{
                _obj: "subpathsList",
                closedSubpath: true,
                points: segmentsToAnchors(ct.segments, true).map((p: any) => ({
                    _obj: "pathPoint",
                    anchor: pt(p.x, p.y),
                    forward: pt(p.fx, p.fy),
                    backward: pt(p.bx, p.by),
                    smooth: p.smooth
                }))
            }]
        }))
    };
}

