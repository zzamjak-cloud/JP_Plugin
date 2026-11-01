// CAT lib/lib_curve_fit.js 이식
// 폴리라인 → 큐빅 베지어 피팅 공용 유틸리티 (Photoshop API 비종속 순수 기하 모듈)
// - smoothPolyline: 계단 노이즈 제거용 라플라시안 스무딩 (열린 경로는 끝점 고정)
// - detectCorners: 진행 방향 회전각 기반 코너 감지
// - fitCurve / fitPathSegments: 최소자승 큐빅 베지어 피팅 (Schneider, Graphics Gems)
// - segmentsToAnchors: 베지어 세그먼트 → pathPoint 앵커(x,y,fx,fy,bx,by,smooth) 변환
// - reverseSegments: 세그먼트 시퀀스 역방향 변환 (공유 경계를 양쪽에서 재사용할 때)

// ---------- 벡터 연산 ----------
export function vSub(a: any, b: any): any { return { x: a.x - b.x, y: a.y - b.y }; }
export function vAdd(a: any, b: any): any { return { x: a.x + b.x, y: a.y + b.y }; }
export function vScale(a: any, s: any): any { return { x: a.x * s, y: a.y * s }; }
export function vDot(a: any, b: any): any { return a.x * b.x + a.y * b.y; }
export function vLen(a: any): any { return Math.sqrt(a.x * a.x + a.y * a.y); }
export function vNorm(a: any): any {
    const l = vLen(a);
    return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

// 인접 중복점 제거
export function dedupePoints(pts: any, eps: any = 1e-9): any {
    const out = [];
    for (const p of pts) {
        const last = out[out.length - 1];
        if (!last || Math.abs(last.x - p.x) > eps || Math.abs(last.y - p.y) > eps) {
            out.push({ x: p.x, y: p.y });
        }
    }
    return out;
}

// ---------- 폴리라인 스무딩 ----------
// 라플라시안 스무딩. 열린 경로는 양 끝점 고정 (공유 경계의 정션 좌표 보존용)
export function smoothPolyline(pts: any, closed: any, passes: any = 2): any {
    const n = pts.length;
    if (n < 3) return pts;
    let cur = pts;
    for (let p = 0; p < passes; p++) {
        const next = new Array(n);
        for (let i = 0; i < n; i++) {
            if (!closed && (i === 0 || i === n - 1)) {
                next[i] = { x: cur[i].x, y: cur[i].y };
                continue;
            }
            const a = cur[(i - 1 + n) % n], b = cur[i], c = cur[(i + 1) % n];
            next[i] = { x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 };
        }
        cur = next;
    }
    return cur;
}

// ---------- 코너 감지 ----------
// 진행 방향 회전각이 angleDeg 이상인 점의 인덱스 목록 (열린 경로는 끝점 제외)
// 근접한 후보 중에는 가장 날카로운 점만 유지 (비최대 억제)
export function detectCorners(pts: any, closed: any, angleDeg: any = 60, spacing: any = 2): any {
    const n = pts.length;
    if (n < 2 * spacing + 1) return [];
    const cosTh = Math.cos(angleDeg * Math.PI / 180);
    const cand = [];
    const start = closed ? 0 : spacing;
    const end = closed ? n : n - spacing;
    for (let i = start; i < end; i++) {
        const a = pts[(i - spacing + n) % n];
        const b = pts[i];
        const c = pts[(i + spacing) % n];
        const v1 = vSub(b, a), v2 = vSub(c, b);
        const l1 = vLen(v1), l2 = vLen(v2);
        if (l1 < 1e-9 || l2 < 1e-9) continue;
        const cs = vDot(v1, v2) / (l1 * l2);
        if (cs < cosTh) cand.push({ i, cs });
    }
    cand.sort((p: any, q: any) => p.cs - q.cs);
    const taken = [];
    for (const c of cand) {
        let ok = true;
        for (const t of taken) {
            let d = Math.abs(c.i - t);
            if (closed) d = Math.min(d, n - d);
            if (d <= spacing * 2) { ok = false; break; }
        }
        if (ok) taken.push(c.i);
    }
    return taken.sort((a: any, b: any) => a - b);
}

// ---------- 큐빅 베지어 피팅 (Schneider) ----------

// 직선 세그먼트 (핸들을 1/3 지점에 배치)
export function lineSegment(a: any, b: any): any {
    const d = vScale(vSub(b, a), 1 / 3);
    return { p0: { x: a.x, y: a.y }, p1: vAdd(a, d), p2: vSub(b, d), p3: { x: b.x, y: b.y } };
}

// 열린 폴리라인을 최대 오차 maxError(px) 이내의 큐빅 베지어 시퀀스로 피팅
// leftTangent/rightTangent: 끝점 접선 강제 지정 (닫힌 곡선 이음매 연속성용, 생략 가능)
export function fitCurve(points: any, maxError: any, leftTangent?: any, rightTangent?: any): any {
    const pts = dedupePoints(points);
    if (pts.length < 2) return [];
    if (pts.length === 2) return [lineSegment(pts[0], pts[1])];
    const tHat1 = leftTangent || vNorm(vSub(pts[1], pts[0]));
    const tHat2 = rightTangent || vNorm(vSub(pts[pts.length - 2], pts[pts.length - 1]));
    return fitCubicRec(pts, tHat1, tHat2, maxError * maxError, 0);
}

export function fitCubicRec(pts: any, tHat1: any, tHat2: any, errSq: any, depth: any): any {
    const n = pts.length;
    if (n === 2) return [lineSegment(pts[0], pts[1])];

    let u = chordLengthParameterize(pts);
    let bez = generateBezier(pts, u, tHat1, tHat2);
    let { maxDistSq, splitPoint } = computeMaxError(pts, bez, u);
    if (maxDistSq < errSq) return [bez];

    // 오차가 크지 않으면 Newton-Raphson 파라미터 재조정 후 재피팅
    if (maxDistSq < errSq * 16) {
        for (let it = 0; it < 4; it++) {
            u = reparameterize(pts, u, bez);
            bez = generateBezier(pts, u, tHat1, tHat2);
            const r = computeMaxError(pts, bez, u);
            maxDistSq = r.maxDistSq;
            splitPoint = r.splitPoint;
            if (maxDistSq < errSq) return [bez];
        }
    }

    if (depth > 32) return [bez]; // 재귀 안전장치

    // 최대 오차 지점에서 분할, 중앙 접선으로 곡률 연속성 유지
    splitPoint = Math.min(n - 2, Math.max(1, splitPoint));
    const tCenter = centerTangent(pts, splitPoint);
    const left = fitCubicRec(pts.slice(0, splitPoint + 1), tHat1, tCenter, errSq, depth + 1);
    const right = fitCubicRec(pts.slice(splitPoint), vScale(tCenter, -1), tHat2, errSq, depth + 1);
    return [...left, ...right];
}

// 분할점의 중앙 접선 (뒤쪽을 향하는 방향 — 왼쪽 구간의 끝 접선)
export function centerTangent(pts: any, i: any): any {
    let v = vSub(pts[Math.max(0, i - 1)], pts[Math.min(pts.length - 1, i + 1)]);
    if (vLen(v) < 1e-12) v = vSub(pts[Math.max(0, i - 1)], pts[i]);
    return vNorm(v);
}

// 현 길이 기반 파라미터화 (0~1 정규화)
export function chordLengthParameterize(pts: any): any {
    const u = [0];
    for (let i = 1; i < pts.length; i++) {
        u.push(u[i - 1] + vLen(vSub(pts[i], pts[i - 1])));
    }
    const total = u[u.length - 1] || 1;
    return u.map((v: any) => v / total);
}

// 최소자승으로 양 끝 핸들 길이(alpha) 결정
export function generateBezier(pts: any, u: any, tHat1: any, tHat2: any): any {
    const n = pts.length;
    const first = pts[0], last = pts[n - 1];
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;

    for (let i = 0; i < n; i++) {
        const t = u[i], mt = 1 - t;
        const a0 = vScale(tHat1, 3 * t * mt * mt);
        const a1 = vScale(tHat2, 3 * t * t * mt);
        c00 += vDot(a0, a0);
        c01 += vDot(a0, a1);
        c11 += vDot(a1, a1);
        const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
        const tmp = {
            x: pts[i].x - (first.x * (b0 + b1) + last.x * (b2 + b3)),
            y: pts[i].y - (first.y * (b0 + b1) + last.y * (b2 + b3))
        };
        x0 += vDot(a0, tmp);
        x1 += vDot(a1, tmp);
    }

    const det = c00 * c11 - c01 * c01;
    let alpha1 = 0, alpha2 = 0;
    if (Math.abs(det) > 1e-12) {
        alpha1 = (x0 * c11 - x1 * c01) / det;
        alpha2 = (c00 * x1 - c01 * x0) / det;
    }

    // 특이/비정상 해는 Wu-Barsky 휴리스틱(현 길이 1/3)으로 대체
    const segLen = vLen(vSub(last, first));
    const eps = 1e-6 * segLen;
    if (alpha1 < eps || alpha2 < eps || alpha1 > segLen * 4 || alpha2 > segLen * 4) {
        alpha1 = alpha2 = segLen / 3;
    }

    return {
        p0: { x: first.x, y: first.y },
        p1: vAdd(first, vScale(tHat1, alpha1)),
        p2: vAdd(last, vScale(tHat2, alpha2)),
        p3: { x: last.x, y: last.y }
    };
}

// 큐빅 베지어 위치 계산
export function evalBezier(bez: any, t: any): any {
    const mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return {
        x: a * bez.p0.x + b * bez.p1.x + c * bez.p2.x + d * bez.p3.x,
        y: a * bez.p0.y + b * bez.p1.y + c * bez.p2.y + d * bez.p3.y
    };
}

// 피팅 곡선과 원본 점 사이 최대 제곱 오차 및 위치
export function computeMaxError(pts: any, bez: any, u: any): any {
    const n = pts.length;
    let maxDistSq = 0;
    let splitPoint = n >> 1;
    for (let i = 1; i < n - 1; i++) {
        const d = vSub(evalBezier(bez, u[i]), pts[i]);
        const distSq = d.x * d.x + d.y * d.y;
        if (distSq > maxDistSq) { maxDistSq = distSq; splitPoint = i; }
    }
    // 점 사이 중간 파라미터에서도 검사 — 점 간격이 성긴 구간(직선/완만한 곡선)에서
    // 곡선이 폴리라인 밖으로 활처럼 휘는(bow) 것을 놓치지 않도록 함
    for (let i = 0; i < n - 1; i++) {
        const q = evalBezier(bez, (u[i] + u[i + 1]) / 2);
        const distSq = ptSegDistSq(q, pts[i], pts[i + 1]);
        if (distSq > maxDistSq) {
            maxDistSq = distSq;
            splitPoint = Math.min(n - 2, Math.max(1, i + 1));
        }
    }
    return { maxDistSq, splitPoint };
}

// 점 p와 선분 a-b 사이의 제곱 거리
export function ptSegDistSq(p: any, a: any, b: any): any {
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 1e-12 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = p.x - (a.x + t * abx), dy = p.y - (a.y + t * aby);
    return dx * dx + dy * dy;
}

export function reparameterize(pts: any, u: any, bez: any): any {
    return u.map((ui: any, i: any) => newtonRaphson(bez, pts[i], ui));
}

// Newton-Raphson으로 점 pts에 가장 가까운 곡선 파라미터 보정
export function newtonRaphson(bez: any, p: any, u: any): any {
    const q = evalBezier(bez, u);
    const d1 = [
        vScale(vSub(bez.p1, bez.p0), 3),
        vScale(vSub(bez.p2, bez.p1), 3),
        vScale(vSub(bez.p3, bez.p2), 3)
    ];
    const d2 = [
        vScale(vSub(d1[1], d1[0]), 2),
        vScale(vSub(d1[2], d1[1]), 2)
    ];
    const mt = 1 - u;
    const q1 = {
        x: mt * mt * d1[0].x + 2 * mt * u * d1[1].x + u * u * d1[2].x,
        y: mt * mt * d1[0].y + 2 * mt * u * d1[1].y + u * u * d1[2].y
    };
    const q2 = { x: mt * d2[0].x + u * d2[1].x, y: mt * d2[0].y + u * d2[1].y };
    const diff = vSub(q, p);
    const num = diff.x * q1.x + diff.y * q1.y;
    const den = q1.x * q1.x + q1.y * q1.y + diff.x * q2.x + diff.y * q2.y;
    if (Math.abs(den) < 1e-12) return u;
    return Math.min(1, Math.max(0, u - num / den));
}

// ---------- 코너 분할 + 구간별 피팅 ----------

// 폴리라인 전체를 코너에서 분할하여 구간별로 피팅한 베지어 세그먼트 시퀀스 반환
// closed=true면 닫힌 윤곽으로 처리 (코너가 없으면 이음매도 매끄럽게 피팅)
export function fitPathSegments(ptsIn: any, closed: any, maxError: any = 0.6, cornerAngleDeg: any = 60, cornerSpacing: any = 2): any {
    let pts = dedupePoints(ptsIn);
    if (closed && pts.length > 1) {
        const f = pts[0], l = pts[pts.length - 1];
        if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) pts = pts.slice(0, -1);
    }
    if (pts.length < 2) return [];
    if (pts.length === 2) {
        const seg = lineSegment(pts[0], pts[1]);
        return closed ? [seg, lineSegment(pts[1], pts[0])] : [seg];
    }

    if (!closed) {
        const corners = detectCorners(pts, false, cornerAngleDeg, cornerSpacing);
        return fitSections(pts, [0, ...corners, pts.length - 1], maxError);
    }

    const corners = detectCorners(pts, true, cornerAngleDeg, cornerSpacing);
    if (corners.length === 0) {
        // 코너 없는 닫힌 곡선: 시작점 접선을 중앙차분으로 맞춰 이음매를 매끄럽게
        const ring = [...pts, pts[0]];
        const t = vNorm(vSub(pts[1], pts[pts.length - 1]));
        return fitCurve(ring, maxError, t, vScale(t, -1));
    }
    // 첫 코너가 시작점이 되도록 회전 후 코너 구간별 피팅
    const s = corners[0];
    const n = pts.length;
    const rotated = [...pts.slice(s), ...pts.slice(0, s)];
    const bounds = [0, ...corners.slice(1).map((c: any) => (c - s + n) % n).sort((a: any, b: any) => a - b), n];
    const ring = [...rotated, rotated[0]];
    return fitSections(ring, bounds, maxError);
}

// bounds 인덱스 구간별로 fitCurve를 수행하여 이어붙임
export function fitSections(pts: any, bounds: any, maxError: any): any {
    const segs = [];
    for (let bi = 0; bi < bounds.length - 1; bi++) {
        const a = bounds[bi], b = bounds[bi + 1];
        if (b - a < 1) continue;
        const section = pts.slice(a, b + 1);
        if (section.length === 2) {
            segs.push(lineSegment(section[0], section[1]));
        } else {
            segs.push(...fitCurve(section, maxError));
        }
    }
    return segs;
}

// ---------- 세그먼트 → 앵커 변환 ----------

// 두 핸들이 앵커 기준 거의 정반대 방향이면 smooth 앵커로 판정
// Photoshop이 smooth 포인트의 핸들을 일직선으로 스냅할 수 있으므로
// 사실상 완전 일직선인 경우에만 true (곡선 변형 방지)
export function isSmoothJoint(hIn: any, anchor: any, hOut: any): any {
    const v1 = vSub(hIn, anchor);
    const v2 = vSub(hOut, anchor);
    const l1 = vLen(v1), l2 = vLen(v2);
    if (l1 < 1e-9 || l2 < 1e-9) return false;
    return vDot(v1, v2) / (l1 * l2) < -0.999; // 약 177.5도 이상
}

// 베지어 세그먼트 시퀀스를 Photoshop pathPoint용 앵커 배열로 변환
// closed=true면 마지막 세그먼트의 끝이 첫 앵커로 연결됨
export function segmentsToAnchors(segments: any, closed: any): any {
    const anchors = [];
    const m = segments.length;
    for (let i = 0; i < m; i++) {
        const seg = segments[i];
        const prev = (i > 0) ? segments[i - 1] : (closed ? segments[m - 1] : null);
        const bx = prev ? prev.p2.x : seg.p0.x;
        const by = prev ? prev.p2.y : seg.p0.y;
        anchors.push({
            x: seg.p0.x, y: seg.p0.y,
            fx: seg.p1.x, fy: seg.p1.y,
            bx, by,
            smooth: prev ? isSmoothJoint({ x: bx, y: by }, seg.p0, seg.p1) : false
        });
    }
    if (!closed && m > 0) {
        const last = segments[m - 1];
        anchors.push({
            x: last.p3.x, y: last.p3.y,
            fx: last.p3.x, fy: last.p3.y,
            bx: last.p2.x, by: last.p2.y,
            smooth: false
        });
    }
    return anchors;
}

// 세그먼트 시퀀스를 역방향으로 변환 (공유 경계를 반대쪽 영역에서 사용할 때)
export function reverseSegments(segments: any): any {
    return [...segments].reverse().map((s: any) => ({ p0: s.p3, p1: s.p2, p2: s.p1, p3: s.p0 }));
}

