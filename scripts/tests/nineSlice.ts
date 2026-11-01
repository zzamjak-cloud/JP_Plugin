// 9-SLICE IMAGES 검증: 등록(루트 밖 파일 복사), 프로젝트, 슬라이스 값, 선택 영역 삽입, 검증 오류, 삭제
import fs from "node:fs";
import { encode } from "fast-png";
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving, listDocuments, getDocInfo } from "../../src/lib/lib_doc";
import { getLayerTree } from "../../src/lib/lib_layer";
import { getLayerPixels } from "../../src/lib/lib_pixels";
import {
  registerFiles,
  loadImageMeta,
  updateSliceValues,
  insertIfSelection,
  deleteImage,
  addProject,
  removeProject,
  loadProjects,
  getImageDataUrl,
  imagePath,
  skippedMessage,
} from "../../src/features/nineSlicePanel";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

// 깨끗한 상태에서 시작 (이전 실패 실행의 문서 정리)
while ((await listDocuments()).documents.length) await docCloseWithoutSaving();

// 30x30 소스: 코너(10px) TL 빨강/TR 초록/BL 파랑/BR 노랑, 엣지 회색(128), 중앙 흰색
const S = 30;
const data = new Uint8Array(S * S * 4);
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    const cx = x < 10 ? 0 : x >= 20 ? 2 : 1;
    const cy = y < 10 ? 0 : y >= 20 ? 2 : 1;
    let c = [128, 128, 128];
    if (cx === 1 && cy === 1) c = [255, 255, 255];
    if (cx === 0 && cy === 0) c = [255, 0, 0];
    if (cx === 2 && cy === 0) c = [0, 255, 0];
    if (cx === 0 && cy === 2) c = [0, 0, 255];
    if (cx === 2 && cy === 2) c = [255, 255, 0];
    data.set([...c, 255], (y * S + x) * 4);
  }
const srcDir = "/tmp/jp_test_7984_src";
fs.mkdirSync(srcDir, { recursive: true });
const srcPng = `${srcDir}/btn.png`;
fs.writeFileSync(srcPng, encode({ width: S, height: S, data, channels: 4, depth: 8 }));
fs.writeFileSync(`${srcDir}/note.txt`, "x");

// 등록: 지원 형식만 복사, 나머지 건너뜀
const { added, skipped } = await registerFiles([srcPng, `${srcDir}/note.txt`], "default");
assert(added.length === 1 && skipped === 1, `register ${added.length}/${skipped}`);
assert(skippedMessage(1) === "1개 파일을 건너뛰었습니다. (지원 형식: png, jpg, jpeg, webp)", "skip msg");
const meta = added[0];
assert(meta.name === "btn" && /^ns_\d+_\d+\.png$/.test(meta.file), "meta " + JSON.stringify(meta));
const stored = await imagePath(meta);
assert(fs.existsSync(stored) && !stored.startsWith("/tmp/jp_test_7984/"), "copied to app data " + stored);
assert((await getImageDataUrl(meta)).startsWith("data:image/png;base64,iVBOR"), "data url");

// 프로젝트
assert(addProject("ui") === null, "add project");
assert(addProject("ui") === "이미 존재하는 프로젝트 이름입니다.", "dup project");
assert(addProject("default") === "이미 존재하는 프로젝트 이름입니다.", "default project");
const r2 = await registerFiles([srcPng], "ui");
removeProject("ui");
assert(!loadProjects().includes("ui"), "project removed");
assert(loadImageMeta().find((m) => m.id === r2.added[0].id)!.project === "default", "image moved to default");
await deleteImage(r2.added[0].id);

// 선택 영역 없음 → 삽입 안 함
await createDoc("ns", 200, 100, 72, "rgb", "white");
assert((await insertIfSelection(meta)) === false, "no selection → no insert");

// 9-slice 삽입 (l=r=t=b=10) → 100x60
updateSliceValues(meta.id, { l: 10, r: 10, t: 10, b: 10 });
let m = loadImageMeta().find((x) => x.id === meta.id)!;
await exec("select.rect", { x: 20, y: 10, width: 100, height: 60 });
assert((await insertIfSelection(m)) === true, "inserted");
let docs = await listDocuments();
assert(docs.documents.length === 1, "temp docs closed: " + docs.documents.length);
let top = (await getLayerTree())[0];
assert(top.name === "btn_100x60", "result name " + top.name);
assert(JSON.stringify(top.bounds) === "[20,10,100,60]", "result bounds " + JSON.stringify(top.bounds));
assert(top.active, "result selected");
const info = await getDocInfo();
assert(info!.hasSelection && JSON.stringify(info!.selectionBounds) === "[20,10,100,60]", "selection restored " + JSON.stringify(info!.selectionBounds));
const px = await getLayerPixels(top.id);
const rgb = (x: number, y: number) => Array.from(px.data.slice((y * px.width + x) * 4, (y * px.width + x) * 4 + 4)).join(",");
const checks: [number, number, string][] = [
  [20, 10, "255,0,0,255"], // TL
  [29, 19, "255,0,0,255"],
  [30, 19, "128,128,128,255"], // TC 시작
  [109, 19, "128,128,128,255"], // TC 끝
  [110, 10, "0,255,0,255"], // TR
  [119, 69, "255,255,0,255"], // BR
  [20, 69, "0,0,255,255"], // BL
  [70, 40, "255,255,255,255"], // MC
  [25, 40, "128,128,128,255"], // ML
  [19, 10, "0,0,0,0"], // 영역 밖
];
for (const [x, y, want] of checks) assert(rgb(x, y) === want, `pixel ${x},${y} = ${rgb(x, y)} (want ${want})`);

// 모든 Border 0 → 단순 스케일
updateSliceValues(meta.id, { l: 0, r: 0, t: 0, b: 0 });
m = loadImageMeta().find((x) => x.id === meta.id)!;
await exec("select.rect", { x: 130, y: 5, width: 60, height: 90 });
await insertIfSelection(m);
top = (await getLayerTree())[0];
assert(top.name === "btn_60x90" && JSON.stringify(top.bounds) === "[130,5,60,90]", "scale-only " + top.name + JSON.stringify(top.bounds));

// 검증 오류: 목표 너비 < L+R → 오류, 임시 문서 정리
updateSliceValues(meta.id, { l: 10, r: 10, t: 0, b: 0 });
m = loadImageMeta().find((x) => x.id === meta.id)!;
await exec("select.rect", { x: 0, y: 0, width: 15, height: 20 });
let err = "";
await insertIfSelection(m).catch((e) => (err = String(e.message)));
assert(err === "목표 너비(15)가 Left(10) + Right(10) 합보다 작습니다.", "validate error: " + err);
docs = await listDocuments();
assert(docs.documents.length === 1, "docs cleaned after error: " + docs.documents.length);

// T/B 보정: t=15,b=15 (합=원본 높이) → b=14 로 보정되어 성공
updateSliceValues(meta.id, { l: 0, r: 0, t: 15, b: 15 });
m = loadImageMeta().find((x) => x.id === meta.id)!;
await exec("select.rect", { x: 0, y: 0, width: 40, height: 50 });
await insertIfSelection(m);
top = (await getLayerTree())[0];
assert(top.name === "btn_40x50" && JSON.stringify(top.bounds) === "[0,0,40,50]", "adjusted " + top.name + JSON.stringify(top.bounds));
await docCloseWithoutSaving();

// 삭제
await deleteImage(meta.id);
assert(!loadImageMeta().some((x) => x.id === meta.id) && !fs.existsSync(stored), "deleted");
console.log("NINESLICE OK");
