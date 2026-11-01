// export 테스트 공용 도우미: 문서 구성, PNG 크기 확인, assert
import fs from "node:fs";
import { decode } from "fast-png";
import { exec } from "../../src/core/bridge";
import { createDoc, listDocuments, docCloseWithoutSaving } from "../../src/lib/lib_doc";
import { newLayer, makeGroupFromSelectLayers, selectByLayerID } from "../../src/lib/lib_layer";

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ASSERT: " + msg);
}

/** 루트 밖 출력 폴더 (비우고 생성) */
export function outDir(name: string): string {
  const d = `/tmp/jp_export_out_7981/${name}`;
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function pngSize(path: string): [number, number] {
  assert(fs.existsSync(path), `파일 없음: ${path}`);
  const img = decode(fs.readFileSync(path));
  return [img.width, img.height];
}

export function exists(path: string) {
  assert(fs.existsSync(path) && fs.statSync(path).size > 0, `파일 없음: ${path}`);
}

/** 열린 문서를 모두 닫는다 */
export async function closeAll() {
  for (let i = 0; i < 20; i++) {
    const { documents } = await listDocuments();
    if (!documents.length) return;
    await docCloseWithoutSaving(documents[documents.length - 1].index);
  }
}

/** 사각형 픽셀 레이어 생성 → ID */
export async function rectLayer(name: string, x: number, y: number, w: number, h: number, color = "#ff0000"): Promise<number> {
  const id = await newLayer(name);
  await exec("select.rect", { x, y, width: w, height: h });
  await exec("edit.fill", { contents: "color", color });
  await exec("select.deselect");
  return id;
}

/** 레이어 하나를 담은 그룹 → 그룹 ID */
export async function groupWith(groupName: string, layerName: string, x: number, y: number, w: number, h: number, color = "#00ff00"): Promise<number> {
  const id = await rectLayer(layerName, x, y, w, h, color);
  await selectByLayerID(id);
  return makeGroupFromSelectLayers(groupName);
}

export async function newTestDoc(name: string, w = 200, h = 200) {
  await closeAll();
  return createDoc(name, w, h);
}
