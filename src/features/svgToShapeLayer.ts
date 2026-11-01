// SVG → Shape Layer 변환 (CAT svgToShapeLayer.js 이식)
// SVG 파싱은 원본과 같은 정규식 방식(DOM 파서 미사용)이라 브라우저/Node 하네스 모두에서 동작한다.
import * as fsx from "../core/fs";
import { executeWithHistoryGrouping } from "../lib/lib";
import { createDoc } from "../lib/lib_doc";
import { createShapeFromPathContents } from "../lib/lib_shape";

// ==================== SVG 파일 → Shape Layer 변환 ====================

export async function importSvgToShape(): Promise<void> {
    // SVG 파일 선택
    const [file] = await fsx.pickFiles(["svg"], false);
    if (!file) return;

    const svgText = await fsx.readText(file);
    const fileName = fsx.basename(file).replace('.svg', '');

    await importSvgTextToShape(svgText, fileName);
}

// SVG 텍스트 → 신규 문서 생성 + Shape Layer 변환 (파일/네트워크 공용 진입점) → 생성된 레이어 ID 목록
export async function importSvgTextToShape(svgText: string, docName: string): Promise<number[]> {
    // SVG 파싱
    const svgData = parseSvg(svgText);
    if (svgData.paths.length === 0) throw new Error("SVG에서 유효한 path를 찾을 수 없습니다.");

    const vb = svgData.viewBox;
    const docSize = 128;
    // 균등 스케일 (비율 유지)
    const scale = docSize / Math.max(vb.width, vb.height);

    // 모든 path를 미리 파싱 — 스타일 정보 포함
    const allSubpaths: any[] = [];
    for (const pathInfo of svgData.paths) {
        const commands = parseSvgPathD(pathInfo.d);
        const subpaths = commandsToSubpaths(commands);
        // 각 subpath에 SVG 스타일 정보 전달
        for (const sp of subpaths) {
            sp.svgFill = pathInfo.fill;
            sp.svgFillNone = pathInfo.fillNone;
            sp.svgStroke = pathInfo.stroke;
            sp.svgStrokeWidth = pathInfo.strokeWidth;
        }
        allSubpaths.push(...subpaths);
    }

    if (allSubpaths.length === 0) throw new Error("변환 가능한 subpath가 없습니다.");

    // 스타일(fill/stroke 조합)별 그룹핑 — 멀티컬러 SVG는 컬러당 하나의 Shape Layer로 분리
    const styleGroups = groupSubpathsByStyle(allSubpaths);

    await createDoc(docName, docSize, docSize, 72, "rgb", "transparent");
    return executeWithHistoryGrouping(async () => {
        const ids: number[] = [];
        // SVG 페인트 순서 유지: 먼저 등장한 그룹부터 생성 → 새 레이어가 위로 쌓여 나중 path가 위에 위치
        for (const group of styleGroups) {
            const shapeStyle = determineShapeStyle(group.subpaths, scale);
            // 단일 컬러면 레이어 이름은 기본값 유지 (기존 동작과 동일)
            if (styleGroups.length > 1) shapeStyle.options.name = group.name;
            ids.push(await createShapeFromPathContents(shapeStyle.pathContents, shapeStyle.options));
        }
        return ids;
    });
}
// SVG 텍스트 → 신규 문서 생성 + Shape Layer 변환 (파일/네트워크 공용 진입점)

// ==================== SVG XML 파싱 ====================

// 16진수 컬러를 RGB 객체로 변환
export function parseColor(colorStr: any): any {
    if (!colorStr || colorStr === 'none') return null;
    // #RGB → #RRGGBB 확장
    if (/^#[0-9a-f]{3}$/i.test(colorStr)) {
        colorStr = '#' + colorStr[1] + colorStr[1] + colorStr[2] + colorStr[2] + colorStr[3] + colorStr[3];
    }
    if (/^#[0-9a-f]{6}$/i.test(colorStr)) {
        return {
            r: parseInt(colorStr.slice(1, 3), 16),
            g: parseInt(colorStr.slice(3, 5), 16),
            b: parseInt(colorStr.slice(5, 7), 16)
        };
    }
    // rgb(r,g,b) 형식
    const rgbMatch = colorStr.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (rgbMatch) {
        return { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) };
    }
    // 기본 색상 이름 (자주 쓰이는 것만)
    const namedColors: Record<string, any> = {
        black: { r: 0, g: 0, b: 0 }, white: { r: 255, g: 255, b: 255 },
        red: { r: 255, g: 0, b: 0 }, green: { r: 0, g: 128, b: 0 },
        blue: { r: 0, g: 0, b: 255 }, yellow: { r: 255, g: 255, b: 0 },
        gray: { r: 128, g: 128, b: 128 }, grey: { r: 128, g: 128, b: 128 },
        orange: { r: 255, g: 165, b: 0 }, purple: { r: 128, g: 0, b: 128 },
        currentColor: { r: 0, g: 0, b: 0 }
    };
    return namedColors[colorStr.toLowerCase()] || { r: 0, g: 0, b: 0 };
}

// 요소의 속성 문자열에서 특정 속성값 추출
export function getAttr(attrStr: any, name: any): any {
    // 직접 속성: fill="red"
    const attrRegex = new RegExp('\\b' + name + '\\s*=\\s*"([^"]+)"', 'i');
    const attrMatch = attrStr.match(attrRegex);
    if (attrMatch) return attrMatch[1].trim();

    // style 인라인 CSS: style="fill:red; stroke:#000"
    const styleMatch = attrStr.match(/\bstyle\s*=\s*"([^"]+)"/i);
    if (styleMatch) {
        const cssName = name; // stroke-width 등은 그대로 사용
        const cssRegex = new RegExp('(?:^|;)\\s*' + cssName + '\\s*:\\s*([^;]+)', 'i');
        const cssMatch = styleMatch[1].match(cssRegex);
        if (cssMatch) return cssMatch[1].trim();
    }

    return null;
}

export function parseSvg(svgText: any): any {
    const paths: any[] = [];

    // viewBox 추출
    let viewBox = { x: 0, y: 0, width: 100, height: 100 };
    const vbMatch = svgText.match(/viewBox\s*=\s*"([^"]+)"/);
    if (vbMatch) {
        const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
        viewBox = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    } else {
        const wMatch = svgText.match(/<svg[^>]*\bwidth\s*=\s*"(\d+\.?\d*)"/);
        const hMatch = svgText.match(/<svg[^>]*\bheight\s*=\s*"(\d+\.?\d*)"/);
        if (wMatch && hMatch) {
            viewBox.width = parseFloat(wMatch[1]);
            viewBox.height = parseFloat(hMatch[1]);
        }
    }

    // 부모 <g>, <svg> 요소에서 상속 가능한 스타일 수집
    const inheritedStyles: any = { fill: null, stroke: null, strokeWidth: null };
    const groupRegex = /<(svg|g)([^>]*)>/gi;
    let gMatch;
    while ((gMatch = groupRegex.exec(svgText)) !== null) {
        const gAttrs = gMatch[2];
        const gFill = getAttr(gAttrs, 'fill');
        const gStroke = getAttr(gAttrs, 'stroke');
        const gStrokeWidth = getAttr(gAttrs, 'stroke-width');
        // 가장 가까운 부모의 값을 덮어씀 (마지막 <g>가 가장 가까움)
        if (gFill !== null) inheritedStyles.fill = gFill;
        if (gStroke !== null) inheritedStyles.stroke = gStroke;
        if (gStrokeWidth !== null) inheritedStyles.strokeWidth = gStrokeWidth;
    }

    // <path> 추출 — 자체 속성 + 부모 상속 스타일 병합
    const pathRegex = /<path([^>]*)\/?\s*>/gi;
    let match;
    while ((match = pathRegex.exec(svgText)) !== null) {
        const attrs = match[1];
        const dMatch = attrs.match(/\bd\s*=\s*"([^"]+)"/);
        if (!dMatch) continue;

        // 속성 우선순위: path 자체 속성 > 부모 상속 속성
        const fillStr = getAttr(attrs, 'fill') || inheritedStyles.fill;
        const strokeStr = getAttr(attrs, 'stroke') || inheritedStyles.stroke;
        const swStr = getAttr(attrs, 'stroke-width') || inheritedStyles.strokeWidth;

        const hasExplicitFillNone = fillStr && fillStr.toLowerCase() === 'none';
        const hasStroke = strokeStr && strokeStr.toLowerCase() !== 'none';
        const strokeWidth = swStr ? parseFloat(swStr) : 1;

        // fill="none"이고 stroke도 없으면 건너뛰기 (배경 rect 등)
        if (hasExplicitFillNone && !hasStroke) continue;

        // 컬러 파싱
        const fillColor = hasExplicitFillNone ? null : parseColor(fillStr || 'black');
        const strokeColor = hasStroke ? parseColor(strokeStr) : null;

        paths.push({
            d: dMatch[1],
            fill: fillColor,          // null이면 채우기 없음
            fillNone: hasExplicitFillNone, // fill="none" 명시 여부 (속성 부재와 구분)
            stroke: strokeColor,      // null이면 선 없음
            strokeWidth: strokeWidth
        });
    }

    return { viewBox, paths };
}

// ==================== SVG path d 파싱 ====================

export function parseSvgPathD(d: any): any {
    const tokens = tokenize(d);
    const commands: any[] = [];
    let i = 0;
    let currentCommand: any = null;

    while (i < tokens.length) {
        const token = tokens[i];

        if (typeof token === 'string' && /^[MmLlHhVvCcSsQqTtAaZz]$/.test(token)) {
            currentCommand = token;
            i++;
        }

        if (!currentCommand) { i++; continue; }

        const cmd = currentCommand.toUpperCase();
        const isRelative = currentCommand === currentCommand.toLowerCase() && cmd !== 'Z';

        if (cmd === 'Z') {
            commands.push({ type: 'Z' });
            currentCommand = null;
            continue;
        }

        const paramCounts: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
        const count = paramCounts[cmd];
        if (count === undefined) { i++; continue; }

        const params: any[] = [];
        while (params.length < count && i < tokens.length && typeof tokens[i] === 'number') {
            params.push(tokens[i]);
            i++;
        }

        if (params.length === count) {
            commands.push({ type: cmd, params, relative: isRelative });
            if (cmd === 'M') currentCommand = isRelative ? 'l' : 'L';
        } else {
            break; // 파라미터 부족 시 중단
        }

        // 연속 파라미터 처리
        if (i < tokens.length && typeof tokens[i] === 'number') continue;
    }

    return commands;
}

export function tokenize(d: any): any {
    const tokens: any[] = [];
    const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
    let m;
    while ((m = re.exec(d)) !== null) {
        tokens.push(m[1] ? m[1] : parseFloat(m[2]));
    }
    return tokens;
}

// ==================== SVG 명령어 → subpath 배열 변환 ====================

export function commandsToSubpaths(commands: any): any {
    const subpaths: any[] = [];
    let current: any = null;
    let curX = 0, curY = 0;
    let startX = 0, startY = 0;
    let lastCp2X = 0, lastCp2Y = 0;
    let lastCmd = '';

    for (const cmd of commands) {
        let { type, params, relative } = cmd;

        // 상대좌표 → 절대좌표
        if (relative && params) {
            params = [...params];
            if (type === 'H') {
                params[0] += curX;
            } else if (type === 'V') {
                params[0] += curY;
            } else if (type === 'A') {
                // Arc: rx,ry,rotation,flags는 그대로, x,y만 변환
                params[5] += curX;
                params[6] += curY;
            } else {
                for (let j = 0; j < params.length; j++) {
                    params[j] += (j % 2 === 0) ? curX : curY;
                }
            }
        }

        switch (type) {
            case 'M': {
                if (current && current.points.length > 0) subpaths.push(current);
                curX = params[0]; curY = params[1];
                startX = curX; startY = curY;
                current = { closed: false, points: [{ x: curX, y: curY, lx: curX, ly: curY, rx: curX, ry: curY }] };
                break;
            }
            case 'L': {
                curX = params[0]; curY = params[1];
                current.points.push({ x: curX, y: curY, lx: curX, ly: curY, rx: curX, ry: curY });
                break;
            }
            case 'H': {
                curX = params[0];
                current.points.push({ x: curX, y: curY, lx: curX, ly: curY, rx: curX, ry: curY });
                break;
            }
            case 'V': {
                curY = params[0];
                current.points.push({ x: curX, y: curY, lx: curX, ly: curY, rx: curX, ry: curY });
                break;
            }
            case 'C': {
                const [cp1x, cp1y, cp2x, cp2y, ex, ey] = params;
                // 이전 점의 rightDirection 업데이트
                const prev = current.points[current.points.length - 1];
                prev.rx = cp1x; prev.ry = cp1y;
                // 새 점 추가
                current.points.push({ x: ex, y: ey, lx: cp2x, ly: cp2y, rx: ex, ry: ey });
                curX = ex; curY = ey;
                lastCp2X = cp2x; lastCp2Y = cp2y;
                break;
            }
            case 'S': {
                const [cp2x, cp2y, ex, ey] = params;
                let cp1x, cp1y;
                if (lastCmd === 'C' || lastCmd === 'S') {
                    cp1x = 2 * curX - lastCp2X; cp1y = 2 * curY - lastCp2Y;
                } else {
                    cp1x = curX; cp1y = curY;
                }
                const prevS = current.points[current.points.length - 1];
                prevS.rx = cp1x; prevS.ry = cp1y;
                current.points.push({ x: ex, y: ey, lx: cp2x, ly: cp2y, rx: ex, ry: ey });
                curX = ex; curY = ey;
                lastCp2X = cp2x; lastCp2Y = cp2y;
                break;
            }
            case 'Q': {
                const [qx, qy, ex, ey] = params;
                // 쿼드라틱 → 큐빅 변환
                const c1x = curX + (2/3) * (qx - curX), c1y = curY + (2/3) * (qy - curY);
                const c2x = ex + (2/3) * (qx - ex), c2y = ey + (2/3) * (qy - ey);
                const prevQ = current.points[current.points.length - 1];
                prevQ.rx = c1x; prevQ.ry = c1y;
                current.points.push({ x: ex, y: ey, lx: c2x, ly: c2y, rx: ex, ry: ey });
                curX = ex; curY = ey;
                lastCp2X = c2x; lastCp2Y = c2y;
                break;
            }
            case 'T': {
                const [ex, ey] = params;
                let qx, qy;
                if (lastCmd === 'Q' || lastCmd === 'T') {
                    qx = 2 * curX - lastCp2X; qy = 2 * curY - lastCp2Y;
                } else { qx = curX; qy = curY; }
                const c1x = curX + (2/3) * (qx - curX), c1y = curY + (2/3) * (qy - curY);
                const c2x = ex + (2/3) * (qx - ex), c2y = ey + (2/3) * (qy - ey);
                const prevT = current.points[current.points.length - 1];
                prevT.rx = c1x; prevT.ry = c1y;
                current.points.push({ x: ex, y: ey, lx: c2x, ly: c2y, rx: ex, ry: ey });
                curX = ex; curY = ey;
                lastCp2X = c2x; lastCp2Y = c2y;
                break;
            }
            case 'A': {
                const [arcRx, arcRy, xRot, largeArc, sweep, ex, ey] = params;
                const curves = arcToBezier(curX, curY, arcRx, arcRy, xRot, largeArc, sweep, ex, ey);
                for (const c of curves) {
                    const prevA = current.points[current.points.length - 1];
                    prevA.rx = c.cp1x; prevA.ry = c.cp1y;
                    current.points.push({ x: c.x, y: c.y, lx: c.cp2x, ly: c.cp2y, rx: c.x, ry: c.y });
                }
                curX = ex; curY = ey;
                break;
            }
            case 'Z': {
                if (current) {
                    current.closed = true;
                    curX = startX; curY = startY;
                    subpaths.push(current);
                    current = null;
                }
                break;
            }
        }
        lastCmd = type;
    }

    if (current && current.points.length > 0) subpaths.push(current);
    return subpaths;
}

// ==================== Photoshop pathContents 구성 ====================

export function buildPathContents(subpaths: any, scale: any): any {
    function pt(x: any, y: any): any {
        return {
            _obj: "paint",
            horizontal: { _unit: "pixelsUnit", _value: x * scale },
            vertical: { _unit: "pixelsUnit", _value: y * scale }
        };
    }

    return {
        _obj: "pathClass",
        pathComponents: [{
            _obj: "pathComponent",
            shapeOperation: { _enum: "shapeOperation", _value: "add" },
            subpathListKey: subpaths.map((sp: any) => ({
                _obj: "subpathsList",
                closedSubpath: sp.closed,
                points: sp.points.map((p: any) => {
                    const isCurve = (p.lx !== p.x || p.ly !== p.y || p.rx !== p.x || p.ry !== p.y);
                    return {
                        _obj: "pathPoint",
                        anchor: pt(p.x, p.y),
                        forward: pt(p.rx, p.ry),    // 다음 점으로 가는 핸들
                        backward: pt(p.lx, p.ly),    // 이전 점에서 오는 핸들
                        smooth: isCurve
                    };
                })
            }))
        }]
    };
}

// ==================== 스타일별 그룹핑 ====================

// RGB 객체 → 헥사 문자열 (그룹 키/레이어 이름용)
export function colorToHex(c: any): any {
    if (!c) return 'none';
    return '#' + [c.r, c.g, c.b].map((v: any) => v.toString(16).padStart(2, '0')).join('');
}

// subpath들을 fill/stroke 스타일 조합별로 그룹핑 (SVG 등장 순서 유지)
// 멀티컬러 아이콘(예: Google 로고)은 컬러당 별도 Shape Layer가 필요하므로 분리한다
export function groupSubpathsByStyle(allSubpaths: any): any {
    const map = new Map();
    for (const sp of allSubpaths) {
        const key = [
            colorToHex(sp.svgFill),
            sp.svgFillNone ? 'fillNone' : '',
            colorToHex(sp.svgStroke),
            sp.svgStrokeWidth || 1
        ].join('|');
        if (!map.has(key)) {
            // 레이어 이름: fill 컬러 우선, 없으면 stroke 컬러
            const name = sp.svgFill ? colorToHex(sp.svgFill)
                : (sp.svgStroke ? colorToHex(sp.svgStroke) : 'shape');
            map.set(key, { name, subpaths: [] });
        }
        map.get(key).subpaths.push(sp);
    }
    return [...map.values()];
}

// ==================== Shape 스타일 결정 ====================

// subpath들의 SVG 속성을 분석하여 Shape Layer 스타일 결정
export function determineShapeStyle(allSubpaths: any, scale: any): any {
    const pathContents = buildPathContents(allSubpaths, scale);

    // 모든 subpath의 열림/닫힘 상태 및 SVG 스타일 수집
    const hasOpenPath = allSubpaths.some((sp: any) => !sp.closed);
    const hasClosedPath = allSubpaths.some((sp: any) => sp.closed);

    // SVG에서 명시된 fill/stroke 정보 수집 (첫 번째로 발견된 값 사용)
    let svgFill = null;
    let svgStroke = null;
    let svgStrokeWidth = 1;
    for (const sp of allSubpaths) {
        if (!svgFill && sp.svgFill) svgFill = sp.svgFill;
        if (!svgStroke && sp.svgStroke) svgStroke = sp.svgStroke;
        if (sp.svgStrokeWidth) svgStrokeWidth = sp.svgStrokeWidth;
    }

    // 스타일 결정 로직:
    // 1) SVG에 stroke가 있고 fill이 없는 경우 → stroke만 활성화
    // 2) SVG에 stroke와 fill 모두 있는 경우 → 둘 다 활성화
    // 3) 열린 패스만 있고 stroke 정보가 있는 경우 → stroke만 활성화
    // 4) 그 외 → 기존 동작 (fill만 활성화)

    const hasExplicitStroke = svgStroke !== null;
    const hasExplicitFill = svgFill !== null;
    const hasFillNone = allSubpaths.some((sp: any) => sp.svgFillNone);
    const allOpen = hasOpenPath && !hasClosedPath;

    let fillEnabled, strokeEnabled, fillColor, strokeColor, description;

    if (hasExplicitStroke && !hasExplicitFill && hasFillNone) {
        // fill="none" 명시 + stroke → 라인 아이콘: 닫힌 패스여도 fill 없이 stroke만
        fillEnabled = false;
        strokeEnabled = true;
        fillColor = { r: 0, g: 0, b: 0 };
        strokeColor = svgStroke;
        description = "stroke만 (fill=none 명시)";
    } else if (hasExplicitStroke && !hasExplicitFill && allOpen) {
        // 열린 패스 + stroke만 있음 → stroke만
        fillEnabled = false;
        strokeEnabled = true;
        fillColor = { r: 0, g: 0, b: 0 };
        strokeColor = svgStroke;
        description = "stroke만 (열린 패스)";
    } else if (hasExplicitStroke && !hasExplicitFill) {
        // stroke만 명시 (닫힌 패스 포함) → stroke + 기본 fill
        fillEnabled = true;
        strokeEnabled = true;
        fillColor = { r: 0, g: 0, b: 0 };
        strokeColor = svgStroke;
        description = "fill(기본) + stroke";
    } else if (hasExplicitStroke && hasExplicitFill) {
        // fill과 stroke 모두 명시 → 둘 다 활성화
        fillEnabled = true;
        strokeEnabled = true;
        fillColor = svgFill;
        strokeColor = svgStroke;
        description = "fill + stroke";
    } else if (allOpen && !hasExplicitFill) {
        // 열린 패스만 있고 색상 정보 없음 → stroke(검정)로 표현
        fillEnabled = false;
        strokeEnabled = true;
        fillColor = { r: 0, g: 0, b: 0 };
        strokeColor = { r: 0, g: 0, b: 0 };
        description = "stroke만 (열린 패스, 기본색)";
    } else {
        // 기본: fill만
        fillEnabled = true;
        strokeEnabled = false;
        fillColor = hasExplicitFill ? svgFill : { r: 0, g: 0, b: 0 };
        strokeColor = { r: 0, g: 0, b: 0 };
        description = "fill만";
    }

    // strokeWidth를 scale에 맞게 조정
    const scaledStrokeWidth = Math.max(1, Math.round(svgStrokeWidth * scale));

    return {
        pathContents,
        options: {
            fillEnabled,
            strokeEnabled,
            fillColor,
            strokeColor,
            strokeWidth: scaledStrokeWidth
        },
        description
    };
}

// ==================== Arc → 큐빅 베지어 변환 ====================

export function arcToBezier(x1: any, y1: any, rx: any, ry: any, xRotation: any, largeArcFlag: any, sweepFlag: any, x2: any, y2: any): any {
    if (x1 === x2 && y1 === y2) return [];
    if (rx === 0 || ry === 0) return [{ cp1x: x1, cp1y: y1, cp2x: x2, cp2y: y2, x: x2, y: y2 }];

    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (xRotation * Math.PI) / 180;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    let rxSq = rx * rx, rySq = ry * ry;
    const x1pSq = x1p * x1p, y1pSq = y1p * y1p;
    const lambda = x1pSq / rxSq + y1pSq / rySq;
    if (lambda > 1) {
        const s = Math.sqrt(lambda);
        rx *= s; ry *= s; rxSq = rx * rx; rySq = ry * ry;
    }

    let sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
    sq = Math.sqrt(sq);
    if (largeArcFlag === sweepFlag) sq = -sq;

    const cxp = sq * (rx * y1p / ry);
    const cyp = sq * -(ry * x1p / rx);
    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

    const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dTheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweepFlag && dTheta > 0) dTheta -= 2 * Math.PI;
    if (sweepFlag && dTheta < 0) dTheta += 2 * Math.PI;

    const segments = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
    const delta = dTheta / segments;
    const curves: any[] = [];

    for (let i = 0; i < segments; i++) {
        const t1 = theta1 + i * delta;
        const t2 = theta1 + (i + 1) * delta;
        const alpha = (4 / 3) * Math.tan((t2 - t1) / 4);
        const cos1 = Math.cos(t1), sin1 = Math.sin(t1);
        const cos2 = Math.cos(t2), sin2 = Math.sin(t2);

        const transform = (px: any, py: any) => ({
            x: cosPhi * rx * px - sinPhi * ry * py + cx,
            y: sinPhi * rx * px + cosPhi * ry * py + cy
        });

        const p1 = transform(cos1 - alpha * sin1, sin1 + alpha * cos1);
        const p2 = transform(cos2 + alpha * sin2, sin2 - alpha * cos2);
        const p = transform(cos2, sin2);
        curves.push({ cp1x: p1.x, cp1y: p1.y, cp2x: p2.x, cp2y: p2.y, x: p.x, y: p.y });
    }
    return curves;
}

export function vecAngle(ux: any, uy: any, vx: any, vy: any): any {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
}

