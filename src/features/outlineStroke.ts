// Outline Stroke / Expand Path (CAT outlineStroke.js 이식)
// 폴리라인 오프셋·자기교차 분해·베지어 피팅 알고리즘은 원본을 그대로 옮기고,
// Photoshop 조작만 lib_shape(PhotoCraft shape.*) 호출로 바꿨다.
import { executeWithHistoryGrouping } from "../lib/lib";
import { requireDoc } from "../lib/lib_doc";
import { getActiveLayer, deleteLayer } from "../lib/lib_layer";
import { createShapeFromPathContents, setShapeColor, getShapeFillColor, getShapePathData, getStrokeSettings } from "../lib/lib_shape";
import { promptText } from "../ui/components";
import { fitPathSegments, segmentsToAnchors } from "./curveFit";

// ==================== Outline Stroke (메인 진입점) ====================

export async function outlineStroke(): Promise<void> {
    await requireDoc();
    const layer = await getActiveLayer();
    if (!layer) throw new Error("선택된 레이어가 없습니다.");

    // 원본 레이어 ID 저장 (아웃라인 생성 후 제거)
    const originalLayerId = layer.id;

    await executeWithHistoryGrouping(async () => {
        // 1. 현재 Shape Layer의 path 데이터 읽기
        const pathData = await getShapePathData(originalLayerId);
        if (!pathData) throw new Error("Vector Mask 데이터를 가져올 수 없습니다.");

        // 2. Stroke 설정 읽기
        const stroke = await getStrokeSettings(originalLayerId);
        if (!stroke || !stroke.enabled || stroke.width <= 0) {
            throw new Error("Stroke가 활성화되지 않았거나 두께가 0입니다.");
        }

        // 3. pathContents → 내부 세그먼트 형식으로 변환
        const subpaths = pathContentsToSubpaths(pathData);

        // 4. subpath별 아웃라인을 각각 독립 컴포넌트로 모은다.
        //    CAT은 subpath마다 Shape Layer를 만든 뒤 mergeLayersNew로 하나의 Shape Layer로 합쳤다.
        //    PhotoCraft의 레이어 병합은 래스터화되므로, 같은 결과(컴포넌트 결합된 단일 Shape)를 한 번에 만든다.
        const components: any[] = [];
        for (let i = 0; i < subpaths.length; i++) {
            const sp = subpaths[i];
            if (sp.points.length < 2) continue;

            const polyline = subpathToPolyline(sp);
            if (polyline.length < 2) continue;

            const result = computeOutline(polyline, stroke, sp.closed);
            if (result.outerLoops.length === 0) continue;

            const pc = buildRingPathContents(result.outerLoops, result.innerLoops);
            components.push(...pc.pathComponents);
        }
        if (components.length === 0) throw new Error("아웃라인 결과가 없습니다.");

        // 5~6. 원본 Stroke 색상으로 Shape 생성 (원본 바로 위에 생성됨)
        const newId = await createShapeFromPathContents({ _obj: "pathClass", pathComponents: components });
        await setShapeColor(stroke.color.r, stroke.color.g, stroke.color.b, newId);

        // 7. 원본 레이어 제거 (아웃라인 패스만 남김)
        await deleteLayer(originalLayerId);
    });
}

// ==================== Expand Path (메인 진입점) ====================

export async function expandPath(): Promise<void> {
    // 입력 다이얼로그 표시
    const value = await promptText("Expand Path (px)", "4");
    if (value === null) return;

    const offset = parseFloat(value);
    if (isNaN(offset) || offset === 0) return;

    await requireDoc();
    const layer = await getActiveLayer();
    if (!layer) throw new Error("선택된 레이어가 없습니다.");

    await executeWithHistoryGrouping(async () => {
        // 원본 Shape Layer의 채우기 색상 읽기
        const originalColor = await getShapeFillColor(layer.id);

        // Shape Layer의 path 데이터 읽기
        const pathData = await getShapePathData(layer.id);
        if (!pathData) throw new Error("Vector Mask 데이터를 가져올 수 없습니다.");

        const subpaths = pathContentsToSubpaths(pathData);
        const joinType = 'round';

        // 모든 subpath의 폴리라인과 면적을 미리 계산
        const spData: any[] = [];
        for (const sp of subpaths) {
            const polyline = subpathToPolyline(sp);
            if (polyline.length < 2) continue;
            let pts = [...polyline];
            if (sp.closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 0.01) {
                pts = pts.slice(0, -1);
            }
            const area = (sp.closed && pts.length >= 3) ? signedArea(pts) : 0;
            spData.push({ sp, pts, area });
        }

        // 포함 관계(중첩 깊이)로 outer/hole 판별
        // 감기 방향 기준 판별은 여러 패스가 병합된 레이어에서 방향이 제각각일 때
        // 별개의 패스를 구멍으로 오판해 일부만 처리되는 문제가 있음
        const depths = computeNestingDepths(spData);

        const expandedSubpaths: any[] = [];
        for (let di = 0; di < spData.length; di++) {
            const { sp, pts, area } = spData[di];
            if (pts.length < 2) continue;

            // 중첩 깊이가 홀수 = 다른 패스 내부에 있는 구멍
            let actualOffset = offset;
            if (sp.closed && pts.length >= 3 && area !== 0) {
                const areaSign = area >= 0 ? 1 : -1;
                const isHole = (depths[di] % 2) === 1;
                // CCW(양수면적) + outer → 양수 오프셋 = 확장
                if (areaSign > 0) actualOffset = -actualOffset;
                if (isHole) actualOffset = -actualOffset;
            }

            const offsetPath = computeOffsetWithJoins(pts, actualOffset, sp.closed, joinType);

            if (sp.closed) {
                // 자기교차 분해 후 방향 일치 + 오프셋 거리 유지 루프만 유지 (다중 루프 허용)
                const srcSign = area >= 0 ? 1 : -1;
                const loops = resolveOffsetLoops(offsetPath, srcSign, pts, true, Math.abs(actualOffset));
                for (const lp of loops) {
                    if (lp.length >= 3) expandedSubpaths.push({ closed: true, points: lp });
                }
            } else if (offsetPath.length >= 2) {
                expandedSubpaths.push({ closed: false, points: offsetPath });
            }
        }

        if (expandedSubpaths.length === 0) throw new Error("오프셋 결과가 없습니다.");

        // 결과를 새 Shape Layer로 생성 후 원본 채우기 색상 적용 (원본 레이어는 유지)
        const pathContents = buildExpandedPathContents(expandedSubpaths);
        const newId = await createShapeFromPathContents(pathContents);
        await setShapeColor(originalColor.r, originalColor.g, originalColor.b, newId);
    });
}

// ==================== Path 데이터 변환 ====================

// pathContents → 내부 subpath 형식
export function pathContentsToSubpaths(pathContents: any): any {
    const subpaths = [];
    for (const comp of pathContents.pathComponents) {
        const shapeOp = comp.shapeOperation?._value || 'add';
        for (const sp of comp.subpathListKey) {
            const points = sp.points.map((pt: any) => {
                const val = (obj: any) => {
                    if (obj === undefined || obj === null) return 0;
                    if (typeof obj === 'number') return obj;
                    if (obj._value !== undefined) return obj._value;
                    return 0;
                };
                const ax = val(pt.anchor?.horizontal);
                const ay = val(pt.anchor?.vertical);
                return {
                    x: ax,
                    y: ay,
                    fx: pt.forward ? val(pt.forward.horizontal) : ax,
                    fy: pt.forward ? val(pt.forward.vertical) : ay,
                    bx: pt.backward ? val(pt.backward.horizontal) : ax,
                    by: pt.backward ? val(pt.backward.vertical) : ay
                };
            });
            subpaths.push({ closed: sp.closedSubpath ?? false, points, shapeOp });
        }
    }
    return subpaths;
}

// ==================== 베지어 → 폴리라인 변환 ====================

// subpath를 폴리라인(점 배열)으로 변환
export function subpathToPolyline(sp: any): any {
    const pts = sp.points;
    const n = pts.length;
    if (n === 0) return [];

    const polyline = [{ x: pts[0].x, y: pts[0].y }];

    const segCount = sp.closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
        const curr = pts[i];
        const next = pts[(i + 1) % n];

        // 현재 점의 forward와 다음 점의 backward로 큐빅 베지어 구성
        const p0 = { x: curr.x, y: curr.y };
        const p1 = { x: curr.fx, y: curr.fy };
        const p2 = { x: next.bx, y: next.by };
        const p3 = { x: next.x, y: next.y };

        // 직선인지 확인
        const isLine = (dist(p0, p1) < 0.01 && dist(p2, p3) < 0.01);

        if (isLine) {
            polyline.push({ x: p3.x, y: p3.y });
        } else {
            // 적응적 분할로 베지어를 폴리라인으로 (허용 오차를 작게 유지해야 오프셋이 균일)
            subdivideBezier(p0, p1, p2, p3, polyline, 0.15);
        }
    }

    return polyline;
}

// 재귀적 적응적 베지어 분할 (flatness 기준)
export function subdivideBezier(p0: any, p1: any, p2: any, p3: any, result: any, tolerance: any, depth: any = 0): any {
    if (depth > 12) {
        result.push(p3);
        return;
    }

    // flatness 체크: 제어점이 직선에서 얼마나 벗어나는지
    const d1 = pointToLineDistance(p1, p0, p3);
    const d2 = pointToLineDistance(p2, p0, p3);

    if (d1 + d2 <= tolerance) {
        result.push(p3);
        return;
    }

    // De Casteljau 분할 (t=0.5)
    const m01 = mid(p0, p1);
    const m12 = mid(p1, p2);
    const m23 = mid(p2, p3);
    const m012 = mid(m01, m12);
    const m123 = mid(m12, m23);
    const m0123 = mid(m012, m123);

    subdivideBezier(p0, m01, m012, m0123, result, tolerance, depth + 1);
    subdivideBezier(m0123, m123, m23, p3, result, tolerance, depth + 1);
}

// ==================== 폴리라인 오프셋 ====================

// outer/inner 오프셋 루프들을 계산 (여러 루프 허용 — 좁은 목이 잘리는 형태 등)
export function computeOutline(polyline: any, stroke: any, closed: any): any {
    // 닫힌 경로에서 중복 끝점 제거
    if (closed && polyline.length > 2 && dist(polyline[0], polyline[polyline.length - 1]) < 0.01) {
        polyline = polyline.slice(0, -1);
    }
    if (polyline.length < 2) return { outerLoops: [], innerLoops: [] };

    const d = stroke.width / 2;
    let dOuter, dInner;
    switch (stroke.align) {
        case 'inner':  dOuter = 0; dInner = stroke.width; break;
        case 'outer':  dOuter = stroke.width; dInner = 0; break;
        default:       dOuter = d; dInner = d; break;
    }

    if (closed) {
        // 경로 방향(CW/CCW)과 무관하게 양수 = 바깥이 되도록 부호 정규화
        // (양수 슈레이스 면적 방향에서는 +오프셋이 안쪽을 향함)
        const srcArea = signedArea(polyline);
        const outwardSign = srcArea > 0 ? -1 : 1;
        const srcSign = srcArea >= 0 ? 1 : -1;

        const outerRaw = computeOffsetWithJoins(polyline, outwardSign * dOuter, true, stroke.join);
        const innerRaw = computeOffsetWithJoins(polyline, -outwardSign * dInner, true, stroke.join);

        // 자기교차를 분해하고 방향 일치 + 오프셋 거리 유지 루프만 유지
        return {
            outerLoops: resolveOffsetLoops(outerRaw, srcSign, polyline, true, dOuter),
            innerLoops: resolveOffsetLoops(innerRaw, srcSign, polyline, true, dInner)
        };
    }

    // 열린 경로: outer → endCap → inner(역순) → startCap 으로 하나의 폐곡선 구성
    const outerPath = computeOffsetWithJoins(polyline, dOuter || d, false, stroke.join);
    const innerPath = computeOffsetWithJoins(polyline, -(dInner || d), false, stroke.join);
    const innerReversed = [...innerPath].reverse();

    // 경로 진행 방향 계산
    const endDir = normalize(sub(polyline[polyline.length - 1], polyline[polyline.length - 2]));
    const startDir = normalize(sub(polyline[0], polyline[1]));

    // end cap: outerPath의 끝점 → innerPath의 끝점
    const endCapPts = makeCapBetween(
        outerPath[outerPath.length - 1],
        innerReversed[0],
        polyline[polyline.length - 1],
        stroke.cap, stroke.width, endDir
    );

    // start cap: innerReversed의 끝점 → outerPath의 첫점
    const startCapPts = makeCapBetween(
        innerReversed[innerReversed.length - 1],
        outerPath[0],
        polyline[0],
        stroke.cap, stroke.width, startDir
    );

    const combined = [...outerPath, ...endCapPts, ...innerReversed, ...startCapPts];
    const sign = signedArea(combined) >= 0 ? 1 : -1;
    // 열린 경로도 모든 구성점이 경로에서 최소 오프셋 거리를 유지해야 유효
    const minD = Math.min(dOuter || d, dInner || d);
    return { outerLoops: resolveOffsetLoops(combined, sign, polyline, false, minD), innerLoops: [] };
}

// per-vertex join 처리로 오프셋 경로 생성
export function computeOffsetWithJoins(polyline: any, d: any, closed: any, joinType: any): any {
    const n = polyline.length;
    if (Math.abs(d) < 1e-9) return polyline.map((p: any) => ({ x: p.x, y: p.y }));
    const segNormals = computeSegmentNormals(polyline);
    const realSegCount = closed ? n : n - 1;
    const result = [];

    for (let i = 0; i < n; i++) {
        const p = polyline[i];

        // 열린 경로의 시작/끝점: 단순 오프셋
        if (!closed && i === 0) {
            result.push(offsetPoint(p, segNormals[0], d));
            continue;
        }
        if (!closed && i === n - 1) {
            result.push(offsetPoint(p, segNormals[realSegCount - 1], d));
            continue;
        }

        // 인접 세그먼트의 법선
        const prevIdx = closed ? ((i - 1 + realSegCount) % realSegCount) : (i - 1);
        const nextIdx = closed ? (i % realSegCount) : i;
        const n1 = segNormals[prevIdx];
        const n2 = segNormals[nextIdx];

        // 두 법선의 각도 차이
        const cross = n1.x * n2.y - n1.y * n2.x;
        const dot = n1.x * n2.x + n1.y * n2.y;

        // 거의 평행: 평균 사용
        if (Math.abs(cross) < 0.05 && dot > 0) {
            const avg = normalize({ x: n1.x + n2.x, y: n1.y + n2.y });
            result.push(offsetPoint(p, avg, d));
            continue;
        }

        // 두 세그먼트에서의 오프셋 점
        const p1 = offsetPoint(p, n1, d);
        const p2 = offsetPoint(p, n2, d);

        // 바깥쪽 꺾임인지 판단
        const isOuterSide = (d > 0) ? (cross < 0) : (cross > 0);

        if (isOuterSide) {
            // 바깥쪽(볼록): join 처리
            switch (joinType) {
                case 'round': {
                    const r = Math.abs(d);
                    const a1 = Math.atan2(p1.y - p.y, p1.x - p.x);
                    let a2 = Math.atan2(p2.y - p.y, p2.x - p.x);
                    let da = a2 - a1;
                    if (da > Math.PI) da -= 2 * Math.PI;
                    if (da < -Math.PI) da += 2 * Math.PI;

                    result.push(p1);
                    // 반지름·각도에 비례한 적응적 분할 (현 오차 ≈ 0.05px 수준)
                    const steps = Math.max(3, Math.min(96, Math.ceil(Math.abs(da) * Math.sqrt(Math.max(r, 1)) * 1.5)));
                    for (let s = 1; s < steps; s++) {
                        const t = s / steps;
                        const angle = a1 + da * t;
                        result.push({ x: p.x + r * Math.cos(angle), y: p.y + r * Math.sin(angle) });
                    }
                    result.push(p2);
                    break;
                }
                case 'bevel':
                    result.push(p1, p2);
                    break;
                case 'miter':
                default: {
                    const prevPt = polyline[closed ? ((i - 1 + n) % n) : (i - 1)];
                    const nextPt = polyline[closed ? ((i + 1) % n) : Math.min(i + 1, n - 1)];
                    const inter = lineIntersection(offsetPoint(prevPt, n1, d), p1, p2, offsetPoint(nextPt, n2, d));
                    if (inter && dist(inter, p) < Math.abs(d) * 4) {
                        result.push(inter);
                    } else {
                        result.push(p1, p2);
                    }
                    break;
                }
            }
        } else {
            // 안쪽(오목): 오프셋 점 2개를 그대로 추가 — 여기서 생기는 교차 루프는
            // resolveOffsetLoops가 교차점에서 정확히 트리밍하므로 오프셋 거리가 보존됨
            result.push(p1, p2);
        }
    }

    return result;
}

// 각 세그먼트의 법선 계산
export function computeSegmentNormals(polyline: any): any {
    const normals: any[] = [];
    for (let i = 0; i < polyline.length - 1; i++) {
        const a = polyline[i];
        const b = polyline[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
            normals.push({ x: -dy / len, y: dx / len });
        } else {
            normals.push(normals.length > 0 ? { ...normals[normals.length - 1] } : { x: 0, y: -1 });
        }
    }
    // 닫힌 경로용: 마지막→첫번째 세그먼트
    if (polyline.length > 1) {
        const a = polyline[polyline.length - 1];
        const b = polyline[0];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
            normals.push({ x: -dy / len, y: dx / len });
        } else {
            normals.push(normals.length > 0 ? { ...normals[normals.length - 1] } : { x: 0, y: -1 });
        }
    }
    return normals;
}

// ==================== Cap 처리 ====================

// fromPt에서 toPt로 연결하는 cap (outDir = 경로 바깥 방향)
export function makeCapBetween(fromPt: any, toPt: any, center: any, capType: any, strokeWidth: any, outDir: any): any {
    switch (capType) {
        case 'round': {
            const r = strokeWidth / 2;
            const a1 = Math.atan2(fromPt.y - center.y, fromPt.x - center.x);
            let a2 = Math.atan2(toPt.y - center.y, toPt.x - center.x);
            let da = a2 - a1;

            // -PI ~ PI 범위로 정규화
            if (da > Math.PI) da -= 2 * Math.PI;
            if (da < -Math.PI) da += 2 * Math.PI;

            // 외향 방향 기준으로 올바른 호 방향 결정
            // 호의 중간점이 외향 방향 쪽에 있어야 함
            const midAngleCW = a1 + da / 2;
            const midAngleCCW = a1 + (da > 0 ? da - 2 * Math.PI : da + 2 * Math.PI) / 2;

            const midCW = { x: Math.cos(midAngleCW), y: Math.sin(midAngleCW) };
            const midCCW = { x: Math.cos(midAngleCCW), y: Math.sin(midAngleCCW) };

            const dotCW = midCW.x * outDir.x + midCW.y * outDir.y;
            const dotCCW = midCCW.x * outDir.x + midCCW.y * outDir.y;

            // 외향과 같은 쪽으로 도는 호 선택
            if (dotCCW > dotCW) {
                da = da > 0 ? da - 2 * Math.PI : da + 2 * Math.PI;
            }

            // 반지름·각도에 비례한 적응적 분할
            const steps = Math.max(3, Math.min(96, Math.ceil(Math.abs(da) * Math.sqrt(Math.max(r, 1)) * 1.5)));
            const pts = [];
            for (let i = 1; i < steps; i++) {
                const t = i / steps;
                const angle = a1 + da * t;
                pts.push({ x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) });
            }
            return pts;
        }
        case 'square': {
            const ext = strokeWidth / 2;
            return [
                { x: fromPt.x + outDir.x * ext, y: fromPt.y + outDir.y * ext },
                { x: toPt.x + outDir.x * ext, y: toPt.y + outDir.y * ext }
            ];
        }
        case 'butt':
        default:
            return [];
    }
}

// ==================== 자기교차 분해 및 유효 루프 선별 ====================

// 원시 오프셋 폴리곤의 자기교차를 모두 분해한 뒤 유효 루프만 선별
// 1) 방향 필터: 원본 경로와 회전 방향이 일치해야 함 (뒤집힌 루프 제거)
// 2) 거리 필터: 모든 정점이 원본 경로에서 minDist 이상 떨어져야 함
//    — 오목 코너 노치, 폭보다 작은 형태의 붕괴(뒤집힌 오프셋) 제거로 균일한 두께 보장
export function resolveOffsetLoops(polygon: any, expectedSign: any, srcPolyline: any = null, srcClosed: any = true, minDist: any = 0, minArea: any = 0.5): any {
    const stack = [dedupeLoop(polygon)];
    const simple = [];
    let guard = 400;

    while (stack.length > 0 && guard-- > 0) {
        const poly = stack.pop();
        if (poly.length < 3) continue;

        const inter = findFirstSelfIntersection(poly);
        if (!inter) {
            simple.push(poly);
            continue;
        }

        // 교차점에서 두 루프로 분할하여 각각 재검사
        const loop1 = [inter.point];
        for (let k = inter.edgeA + 1; k <= inter.edgeB; k++) {
            loop1.push(poly[k]);
        }

        const loop2 = [inter.point];
        for (let k = (inter.edgeB + 1) % poly.length; k !== (inter.edgeA + 1) % poly.length; k = (k + 1) % poly.length) {
            loop2.push(poly[k]);
        }

        stack.push(dedupeLoop(loop1), dedupeLoop(loop2));
    }

    // 방향 일치 + 최소 면적 이상인 루프만 유효
    let valid = simple.filter((l: any) => {
        const a = signedArea(l);
        return Math.abs(a) > minArea && (a >= 0 ? 1 : -1) === expectedSign;
    });

    // 거리 필터: 오프셋 거리보다 가까운 정점을 가진 루프는 무효
    if (srcPolyline && minDist > 0.01) {
        const tol = Math.max(0.3, minDist * 0.08);
        valid = valid.filter((l: any) => l.every((p: any) => minDistToPolyline(p, srcPolyline, srcClosed) >= minDist - tol));
    }

    return valid;
}

// 점이 다각형 내부에 있는지 검사 (ray casting)
export function pointInPolygon(p: any, poly: any): any {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y)) {
            const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
            if (p.x < x) inside = !inside;
        }
    }
    return inside;
}

// 닫힌 subpath들의 중첩 깊이 계산 — 다른 닫힌 subpath에 몇 겹으로 포함되는지
// (홀수 = 구멍, 짝수 = 면. 감기 방향과 무관하게 기하학적 포함 관계로 판별)
export function computeNestingDepths(spData: any): any {
    // outer가 inner를 포함하는지 — 여러 꼭짓점 다수결로 판정
    // (자기교차 분해로 생긴 형제 루프들은 교차점 하나를 공유하므로
    //  단일 대표점 판정은 경계 위의 점을 내부로 오판할 수 있음)
    function contains(outerPts: any, innerPts: any): any {
        const samples = Math.min(9, innerPts.length);
        const stride = Math.max(1, Math.floor(innerPts.length / samples));
        let inside = 0, tested = 0;
        for (let k = 0; k < innerPts.length && tested < samples; k += stride) {
            tested++;
            if (pointInPolygon(innerPts[k], outerPts)) inside++;
        }
        return inside * 2 > tested;
    }

    return spData.map((d: any, i: any) => {
        if (!d.sp.closed || d.pts.length < 3) return 0;
        let depth = 0;
        for (let j = 0; j < spData.length; j++) {
            if (j === i) continue;
            const o = spData[j];
            if (!o.sp.closed || o.pts.length < 3) continue;
            if (contains(o.pts, d.pts)) depth++;
        }
        return depth;
    });
}

// 점에서 폴리라인(세그먼트 체인)까지의 최소 거리
export function minDistToPolyline(p: any, poly: any, closed: any): any {
    let min = Infinity;
    const n = poly.length;
    const cnt = closed ? n : n - 1;
    for (let i = 0; i < cnt; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = p.x - (a.x + t * abx), dy = p.y - (a.y + t * aby);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < min) min = d;
    }
    return min;
}

// 루프 내 인접 중복점 제거 (분할 반복 시 수치 안정성 확보)
export function dedupeLoop(pts: any, eps: any = 1e-6): any {
    const out = [];
    for (const p of pts) {
        const last = out[out.length - 1];
        if (!last || Math.abs(last.x - p.x) > eps || Math.abs(last.y - p.y) > eps) {
            out.push(p);
        }
    }
    // 첫/끝 중복 제거
    if (out.length > 1) {
        const f = out[0], l = out[out.length - 1];
        if (Math.abs(f.x - l.x) <= eps && Math.abs(f.y - l.y) <= eps) out.pop();
    }
    return out;
}

// 폴리곤에서 첫 번째 자기교차 찾기 (O(n²))
export function findFirstSelfIntersection(pts: any): any {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a1 = pts[i];
        const a2 = pts[(i + 1) % n];

        // 인접하지 않은 세그먼트만 검사 (최소 2개 떨어진)
        for (let j = i + 2; j < n; j++) {
            // 닫힌 폴리곤에서 첫/마지막 세그먼트는 인접
            if (i === 0 && j === n - 1) continue;

            const b1 = pts[j];
            const b2 = pts[(j + 1) % n];

            const inter = segSegIntersection(a1, a2, b1, b2);
            if (inter) {
                return { edgeA: i, edgeB: j, point: inter.point };
            }
        }
    }
    return null;
}

// 두 선분의 교차 검사 (파라미터 0~1 범위 내)
export function segSegIntersection(a1: any, a2: any, b1: any, b2: any): any {
    const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
    const cross = d1x * d2y - d1y * d2x;

    if (Math.abs(cross) < 1e-10) return null;

    const dx = b1.x - a1.x, dy = b1.y - a1.y;
    const tA = (dx * d2y - dy * d2x) / cross;
    const tB = (dx * d1y - dy * d1x) / cross;

    // 끝점 근처 제외 (수치 안정성)
    if (tA > 0.001 && tA < 0.999 && tB > 0.001 && tB < 0.999) {
        return {
            point: { x: a1.x + tA * d1x, y: a1.y + tA * d1y }
        };
    }
    return null;
}

// 폴리곤의 부호 면적 계산
export function signedArea(polygon: any): any {
    let area = 0;
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += polygon[i].x * polygon[j].y;
        area -= polygon[j].x * polygon[i].y;
    }
    return area / 2;
}

// ==================== 결과 → Photoshop pathContents ====================

// outer 루프들 + inner 루프들(구멍)을 하나의 pathComponent에 subpath로 구성
// 각 루프는 베지어 피팅을 거쳐 최소 정점으로 변환됨
export function buildRingPathContents(outerLoops: any, innerLoops: any): any {
    function pt(x: any, y: any): any {
        return {
            _obj: "paint",
            horizontal: { _unit: "pixelsUnit", _value: x },
            vertical: { _unit: "pixelsUnit", _value: y }
        };
    }

    // 폴리라인 루프 → 베지어 피팅 → 앵커 (오프셋 점 간격이 불균일하므로 코너 간격 1)
    const loopToAnchors = (loop: any) => segmentsToAnchors(fitPathSegments(loop, true, 0.22, 45, 1), true);

    const makeSub = (anchors: any) => ({
        _obj: "subpathsList",
        closedSubpath: true,
        points: anchors.map((p: any) => ({
            _obj: "pathPoint",
            anchor: pt(p.x, p.y),
            forward: pt(p.fx, p.fy),
            backward: pt(p.bx, p.by),
            smooth: p.smooth
        }))
    });

    const subpathList = [];
    for (const loop of outerLoops) {
        const anchors = loopToAnchors(loop);
        if (anchors.length >= 2) subpathList.push(makeSub(anchors));
    }
    // inner는 역방향으로 추가 (구멍)
    for (const loop of innerLoops) {
        const anchors = loopToAnchors([...loop].reverse());
        if (anchors.length >= 2) subpathList.push(makeSub(anchors));
    }

    return {
        _obj: "pathClass",
        pathComponents: [{
            _obj: "pathComponent",
            shapeOperation: { _enum: "shapeOperation", _value: "add" },
            subpathListKey: subpathList
        }]
    };
}

// ==================== 벡터 유틸리티 ====================

export function mid(a: any, b: any): any { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
export function sub(a: any, b: any): any { return { x: a.x - b.x, y: a.y - b.y }; }
export function dist(a: any, b: any): any { const dx = b.x - a.x, dy = b.y - a.y; return Math.sqrt(dx * dx + dy * dy); }
export function normalize(v: any): any { const l = Math.sqrt(v.x * v.x + v.y * v.y); return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }; }

export function offsetPoint(p: any, n: any, d: any): any {
    return { x: p.x + n.x * d, y: p.y + n.y * d };
}

// 점에서 직선(a→b)까지의 거리
export function pointToLineDistance(p: any, a: any, b: any): any {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) return dist(p, a);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

// 두 직선 (a→b)와 (c→d)의 교점
export function lineIntersection(a: any, b: any, c: any, d: any): any {
    const dx1 = b.x - a.x, dy1 = b.y - a.y;
    const dx2 = d.x - c.x, dy2 = d.y - c.y;
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-10) return null;
    const t = ((c.x - a.x) * dy2 - (c.y - a.y) * dx2) / denom;
    return { x: a.x + t * dx1, y: a.y + t * dy1 };
}

// ==================== Expand Path ====================


// 확장/축소 값 입력 다이얼로그

// 확장된 subpath들을 pathContents로 변환 (베지어 피팅 적용)
export function buildExpandedPathContents(subpaths: any): any {
    function pt(x: any, y: any): any {
        return {
            _obj: "paint",
            horizontal: { _unit: "pixelsUnit", _value: x },
            vertical: { _unit: "pixelsUnit", _value: y }
        };
    }

    // 포함 관계(중첩 깊이)로 구멍 판별 — 깊이 홀수 = 구멍(subtract)
    // Photoshop 순차 결합 특성상 컨테이너가 구멍보다 먼저 오도록 깊이 오름차순 → 면적 내림차순 정렬
    const withArea = subpaths.map((sp: any) => ({
        sp,
        pts: sp.points,
        closed: sp.closed,
        area: (sp.closed && sp.points.length >= 3) ? signedArea(sp.points) : 0
    }));
    const depths = computeNestingDepths(withArea.map((d: any) => ({ sp: { closed: d.closed }, pts: d.pts })));
    withArea.forEach((d: any, i: any) => { d.depth = depths[i]; });
    withArea.sort((a: any, b: any) => (a.depth - b.depth) || (Math.abs(b.area) - Math.abs(a.area)));

    return {
        _obj: "pathClass",
        pathComponents: withArea.map(({ sp, area, depth }: any) => {
            const isHole = sp.closed && area !== 0 && (depth % 2) === 1;
            const anchors = segmentsToAnchors(fitPathSegments(sp.points, sp.closed, 0.22, 45, 1), sp.closed);
            return {
                _obj: "pathComponent",
                shapeOperation: { _enum: "shapeOperation", _value: isHole ? "subtract" : "add" },
                subpathListKey: [{
                    _obj: "subpathsList",
                    closedSubpath: sp.closed,
                    points: anchors.map((p: any) => ({
                        _obj: "pathPoint",
                        anchor: pt(p.x, p.y),
                        forward: pt(p.fx, p.fy),
                        backward: pt(p.bx, p.by),
                        smooth: p.smooth
                    }))
                }]
            };
        })
    };
}

