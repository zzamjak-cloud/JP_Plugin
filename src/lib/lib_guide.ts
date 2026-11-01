// 가이드 조작 (CAT lib_guide.js 대응)
import { exec } from "../core/bridge";
import * as fsx from "../core/fs";
import { listDocuments, docNameAt, closeTempDoc } from "./lib_doc";
import { saveActiveDocAs, tempFile } from "./lib_export";

export type GuideAxis = "horizontal" | "vertical";

export interface Guide {
  /** 문서 픽셀 좌표 (PSD 저장 정밀도 1/32px) */
  position: number;
  orientation: GuideAxis;
}

/** 가이드 추가 (position = px, axis = 'vertical' | 'horizontal') */
export function makeGuide(position: number, axis: GuideAxis) {
  return exec("view.newGuide", { orientation: axis, position });
}

/** 모든 가이드 제거 */
export function clearAllGuides() {
  return exec("view.clearGuides", {});
}

function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array((globalThis as any).Buffer.from(b64, "base64"));
}

/** PSD 이미지 리소스 1032(Grid and guides)에서 가이드 목록 파싱 */
export function parsePsdGuides(bytes: Uint8Array): Guide[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 26; // 헤더
  off += 4 + dv.getUint32(off); // 컬러 모드 데이터
  const resLen = dv.getUint32(off);
  off += 4;
  const end = off + resLen;
  const guides: Guide[] = [];
  while (off + 12 <= end) {
    const id = dv.getUint16(off + 4);
    const nameLen = bytes[off + 6];
    let p = off + 7 + nameLen;
    if ((p - off) % 2) p++; // 이름(파스칼 문자열)은 짝수 길이로 패딩
    const size = dv.getUint32(p);
    const data = p + 4;
    if (id === 1032 && size >= 16) {
      const count = dv.getUint32(data + 12);
      for (let i = 0; i < count; i++) {
        const loc = dv.getInt32(data + 16 + i * 5);
        const dir = bytes[data + 16 + i * 5 + 4];
        guides.push({ position: loc / 32, orientation: dir === 0 ? "vertical" : "horizontal" });
      }
    }
    off = data + size + (size % 2);
  }
  return guides;
}

/**
 * 활성 문서의 가이드 목록 (UXP doc.guides 대응).
 * PhotoCraft 제어 채널에 가이드 조회 명령이 없어, 병합 복제본을 PSD로 저장해 가이드 리소스를 읽는다.
 */
export async function getGuides(): Promise<Guide[]> {
  const { active } = await listDocuments();
  if (active === null) throw new Error("열린 문서가 없습니다.");
  const dup = await exec<{ document: number; name?: string }>("image.duplicate", { name: "jp_guides", mergedOnly: true });
  const dupName = dup.name ?? (await docNameAt(dup.document)) ?? "jp_guides";
  let tmp = "";
  try {
    tmp = await tempFile("psd");
    await saveActiveDocAs(tmp);
  } finally {
    await closeTempDoc(dup.document, dupName);
    await exec("document.activate", { document: active }).catch(() => {});
  }
  try {
    return parsePsdGuides(b64ToBytes(await fsx.readBase64(tmp)));
  } finally {
    await fsx.remove(tmp).catch(() => {});
  }
}
