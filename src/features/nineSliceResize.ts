// 9-Slice 리사이즈 코어 (CAT nineSliceResize.js 대응)
import { createDoc, getDocInfo, activateDoc, docCloseWithoutSaving, trimTransparent } from "../lib/lib_doc";
import {
  getAllLayers,
  getLayerTree,
  selectByLayerID,
  renameLayer,
  cutRegion,
  copyLayersToDocument,
  transformToRect,
  mergeVisible,
  moveLayerOffset,
  getLayerById,
} from "../lib/lib_layer";
import type { Bounds } from "../lib/types";

export interface SliceValues {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** T/B/L/R 값 보정 및 검증 — 실패 시 Error throw, 성공 시 보정된 값 반환 */
export function adjustAndValidateSliceValues(v: SliceValues & { width: number; height: number; srcW: number; srcH: number }): SliceValues {
  let { top, bottom, left, right } = v;
  const { width, height, srcW, srcH } = v;
  // 내부 보정: T/B 또는 L/R 합이 원본 크기 이상이면 1px 보정
  if (top + bottom >= srcH && top > 0 && bottom > 0) bottom = bottom - 1;
  if (left + right >= srcW && left > 0 && right > 0) right = right - 1;

  // 검증: Border 합이 원본보다 작아야 함
  if (left + right >= srcW) throw new Error(`Left(${left}) + Right(${right}) 값이 원본 너비(${srcW})보다 크거나 같습니다.`);
  if (top + bottom >= srcH) throw new Error(`Top(${top}) + Bottom(${bottom}) 값이 원본 높이(${srcH})보다 크거나 같습니다.`);
  // 검증: 목표 크기가 Border 합보다 커야 함
  if (width < left + right) throw new Error(`목표 너비(${width})가 Left(${left}) + Right(${right}) 합보다 작습니다.`);
  if (height < top + bottom) throw new Error(`목표 높이(${height})가 Top(${top}) + Bottom(${bottom}) 합보다 작습니다.`);
  return { top, bottom, left, right };
}

export interface NineSliceParams extends SliceValues {
  /** 일회용 소스 문서 인덱스 (작업 후 닫힘) */
  srcDoc: number;
  /** 소스 문서 이름 (닫기 전 확인용) */
  srcName?: string;
  /** 소스 레이어 ID */
  layerId: number;
  resultName: string;
  width: number;
  height: number;
  destLeft: number;
  destTop: number;
  /** 결과를 넣을 원본 문서 인덱스 (소스/목표 문서보다 앞 인덱스여야 함) */
  originalDoc: number;
}

/**
 * 9-Slice 코어 — 소스 문서의 레이어를 9-slice 스케일링하여 원본 문서의 (destLeft, destTop)에 결과 레이어 생성.
 * 소스 문서와 임시 목표 문서는 닫힌다. 결과 레이어 ID 반환.
 */
export async function nineSliceCore(p: NineSliceParams): Promise<number | null> {
  const { top, bottom, left, right, width, height } = p;

  // 1. 소스 문서에서 트림 → "Source"
  await activateDoc(p.srcDoc);
  await selectByLayerID(p.layerId);
  await trimTransparent();
  await renameLayer(p.layerId, "Source");
  const src = await getLayerById(p.layerId);
  if (!src?.bounds) throw new Error("소스 이미지가 비어 있습니다.");
  const [sx, sy, actualW, actualH] = src.bounds;
  const resolution = (await getDocInfo())?.resolution ?? 72;

  const newCenterW = width - left - right;
  const newCenterH = height - top - bottom;

  // 2. 목표 크기 문서 생성
  const targetDoc = await createDoc("9slice_target", width, height, resolution, "rgb", "transparent");
  await activateDoc(p.srcDoc);

  let resultId: number | null;
  if (top === 0 && bottom === 0 && left === 0 && right === 0) {
    // 단순 스케일링 모드: 전체를 정확한 W×H로 (최근접 이웃)
    const r = await copyLayersToDocument(targetDoc, [p.layerId], { source: p.srcDoc });
    resultId = r?.layers?.[0] ?? r?.layer;
    await activateDoc(targetDoc);
    await transformToRect(resultId!, [sx, sy, actualW, actualH], [0, 0, width, height], "nearest");
  } else {
    // 9-slice 모드: [top, left, bottom, right] 소스 영역 → (x, y, w, h) 목표 영역
    const slices: { name: string; src: [number, number, number, number]; dst: Bounds }[] = [
      // 코너: 고정 크기
      { name: "TL", src: [0, 0, top, left], dst: [0, 0, left, top] },
      { name: "TR", src: [0, actualW - right, top, actualW], dst: [width - right, 0, right, top] },
      { name: "BL", src: [actualH - bottom, 0, actualH, left], dst: [0, height - bottom, left, bottom] },
      { name: "BR", src: [actualH - bottom, actualW - right, actualH, actualW], dst: [width - right, height - bottom, right, bottom] },
      // 엣지: 한 방향 스트레칭
      { name: "TC", src: [0, left, top, actualW - right], dst: [left, 0, newCenterW, top] },
      { name: "BC", src: [actualH - bottom, left, actualH, actualW - right], dst: [left, height - bottom, newCenterW, bottom] },
      { name: "ML", src: [top, 0, actualH - bottom, left], dst: [0, top, left, newCenterH] },
      { name: "MR", src: [top, actualW - right, actualH - bottom, actualW], dst: [width - right, top, right, newCenterH] },
      // 센터: 양방향 스트레칭
      { name: "MC", src: [top, left, actualH - bottom, actualW - right], dst: [left, top, newCenterW, newCenterH] },
    ];
    // 크기가 0인 영역 제외
    const valid = slices.filter((s) => s.src[2] - s.src[0] > 0 && s.src[3] - s.src[1] > 0 && s.dst[2] > 0 && s.dst[3] > 0);

    // 1단계: 소스 문서에서 모든 영역 잘라내기 (소스는 트림 후 (0,0) 기준이지만 안전하게 오프셋 반영)
    const cutIds: number[] = [];
    for (const s of valid) {
      await selectByLayerID(p.layerId);
      const [t, l, b, r] = s.src;
      const id = await cutRegion(sy + t, sx + l, sy + b, sx + r, s.name);
      if (id === null) throw new Error(`${s.name} 영역을 잘라낼 수 없습니다.`);
      cutIds.push(id);
    }
    // 2단계: 잘라낸 레이어를 한 번에 목표 문서로 복사
    await copyLayersToDocument(targetDoc, cutIds, { source: p.srcDoc });
    await activateDoc(targetDoc);
    const targetLayers = await getAllLayers();
    // 3단계: 각 조각을 정확한 크기로 스케일링해 배치 (소스 영역 사각형 → 목표 사각형, 최근접 이웃)
    for (const s of valid) {
      const layer = targetLayers.find((l) => l.name === s.name);
      if (!layer) throw new Error(`${s.name} 조각을 찾을 수 없습니다.`);
      const [t, l, b, r] = s.src;
      await transformToRect(layer.id, [sx + l, sy + t, r - l, b - t], s.dst, "nearest");
    }
    // 목표 문서의 보이는 레이어 병합 (조각이 하나뿐이라 병합할 게 없으면 그 조각이 결과)
    try {
      resultId = await mergeVisible();
    } catch {
      resultId = targetLayers.find((l) => l.name === valid[0].name)?.id ?? null;
    }
  }
  if (resultId === null || resultId === undefined) throw new Error("9-slice 결과 레이어를 만들 수 없습니다.");

  // 3. 결과 이름 지정 후 원본 문서로 복사
  await renameLayer(resultId, p.resultName);
  const copied = await copyLayersToDocument(p.originalDoc, [resultId], { source: targetDoc });
  const finalId: number | undefined = copied?.layers?.[0] ?? copied?.layer;

  // 4. 작업 문서 닫기 (뒤 인덱스부터)
  // 이 작업이 만든 문서만 이름을 확인하고 닫는다 (인덱스 큰 것부터)
  const targetName = "9slice_target";
  const toClose: [number, string | undefined][] = [
    [targetDoc, targetName],
    [p.srcDoc, p.srcName],
  ];
  for (const [d, n] of toClose.sort((a, b) => b[0] - a[0])) await docCloseWithoutSaving(d, n);
  await activateDoc(p.originalDoc);

  // 5. 결과 레이어를 목표 좌표로 이동
  if (finalId === undefined) return null;
  const res = (await getLayerTree()).find((l) => l.id === finalId) ?? (await getLayerById(finalId));
  if (res?.bounds) {
    const dx = p.destLeft - res.bounds[0];
    const dy = p.destTop - res.bounds[1];
    if (dx !== 0 || dy !== 0) await moveLayerOffset(finalId, dx, dy);
  }
  return finalId;
}
