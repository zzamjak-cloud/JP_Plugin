// 레이어 픽셀 읽기/쓰기 (UXP imaging.getPixels/putPixels 대응). PNG 왕복으로 구현.
import { decode, encode } from "fast-png";
import { exec } from "../core/bridge";
import * as fsx from "../core/fs";
import { saveActiveDocAs, tempFile, importImageAsLayer } from "./lib_export";
import { listDocuments } from "./lib_doc";

export interface RGBAImage {
  width: number;
  height: number;
  /** RGBA 8bit, 길이 width*height*4 */
  data: Uint8Array;
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

function bytesToB64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return (globalThis as any).Buffer.from(bytes).toString("base64");
}

/** PNG 바이트 → RGBA (그레이/RGB/16bit도 RGBA 8bit로 정규화) */
export function decodePng(bytes: Uint8Array): RGBAImage {
  const img = decode(bytes);
  const { width, height, channels } = img;
  const src = img.data as Uint8Array | Uint16Array;
  const shift = img.depth === 16 ? 8 : 0;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const g = (k: number) => src[i * channels + k] >> shift;
    if (channels === 4) {
      out.set([g(0), g(1), g(2), g(3)], i * 4);
    } else if (channels === 3) {
      out.set([g(0), g(1), g(2), 255], i * 4);
    } else if (channels === 2) {
      out.set([g(0), g(0), g(0), g(1)], i * 4);
    } else {
      out.set([g(0), g(0), g(0), 255], i * 4);
    }
  }
  return { width, height, data: out };
}

export function encodePng(img: RGBAImage): Uint8Array {
  return encode({ width: img.width, height: img.height, data: img.data, channels: 4, depth: 8 });
}

export async function readPngFile(path: string): Promise<RGBAImage> {
  return decodePng(b64ToBytes(await fsx.readBase64(path)));
}

export async function writePngFile(path: string, img: RGBAImage): Promise<void> {
  await fsx.writeBase64(path, bytesToB64(encodePng(img)));
}

/** 레이어(들)의 픽셀을 문서 캔버스 크기 RGBA로 읽는다 (기본: 선택 레이어). 원본 문서는 변경하지 않는다 */
export async function getLayerPixels(layerId?: number): Promise<RGBAImage> {
  const { active } = await listDocuments();
  const p: Record<string, unknown> = { document: "new", documentName: "jp_pixels" };
  if (layerId !== undefined) p.layer = layerId;
  await exec("layer.duplicate", p);
  const tmp = await tempFile("png");
  try {
    await saveActiveDocAs(tmp);
  } finally {
    await exec("file.close", {});
    if (active !== null) await exec("document.activate", { document: active }).catch(() => {});
  }
  const img = await readPngFile(tmp);
  await fsx.remove(tmp);
  return img;
}

/** 문서 전체 합성 이미지 */
export async function getDocumentPixels(): Promise<RGBAImage> {
  const { active } = await listDocuments();
  await exec("image.duplicate", { name: "jp_merged", mergedOnly: true });
  const tmp = await tempFile("png");
  try {
    await saveActiveDocAs(tmp);
  } finally {
    await exec("file.close", {});
    if (active !== null) await exec("document.activate", { document: active }).catch(() => {});
  }
  const img = await readPngFile(tmp);
  await fsx.remove(tmp);
  return img;
}

/** RGBA 이미지를 활성 문서에 새 레이어로 추가 → 새 레이어 ID. (x, y): 이미지 좌상단의 문서 좌표 */
export async function putPixelsAsLayer(img: RGBAImage, name: string, x = 0, y = 0): Promise<number> {
  const { active } = await listDocuments();
  if (active === null) throw new Error("열린 문서가 없습니다.");
  const tmp = await tempFile("png");
  await writePngFile(tmp, img);
  const ids = await importImageAsLayer(tmp, active, { name, offset: [x, y] });
  await fsx.remove(tmp);
  return ids[0];
}

/** 알파 기준 불투명 영역 bounds [x,y,w,h] (없으면 null) */
export function alphaBounds(img: RGBAImage, threshold = 0): [number, number, number, number] | null {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
}
