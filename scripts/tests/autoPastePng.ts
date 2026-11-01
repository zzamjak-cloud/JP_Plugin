// Auto Paste PNG 검증: 폴링 tick이 새 스마트 오브젝트를 감지해 원본 해상도 픽셀 레이어로 교체(중심 유지·정수 좌표·파일명)
// 제어 채널로는 OS 드래그/Place를 재현할 수 없어, PNG를 스마트 오브젝트로 만들어 문서에 넣은 뒤 accept 조건만 바꿔 검증한다.
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving, listDocuments } from "../../src/lib/lib_doc";
import { getAllLayers, getLayerDetail, convertToSmartObject, copyLayersToDocument, layTransform } from "../../src/lib/lib_layer";
import { openFile, saveForWebPNG } from "../../src/lib/lib_export";
import {
  autoPasteTick,
  newAutoPasteState,
  isPlacedPng,
  isAutoPastePngEnabled,
  setAutoPastePngEnabled,
  startAutoPastePngPolling,
} from "../../src/features/autoPastePng";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
// 설정 키
assert(isAutoPastePngEnabled() === true, "기본 활성");
setAutoPastePngEnabled(false);
assert(localStorage.getItem("autoPastePngEnabledV1") === "false" && !isAutoPastePngEnabled(), "비활성 저장");
setAutoPastePngEnabled(true);
assert(isPlacedPng({ smartSource: { fileName: "Icon.PNG" } }) && !isPlacedPng({ smartSource: { fileName: "Layer 0.pcraft" } }), "PNG 판정");

// 원본 PNG 41x31
await createDoc("src", 41, 31, 72, "rgb", "white");
await saveForWebPNG("/tmp/jp_test_7982/ap", "drop");
await docCloseWithoutSaving();

const target = await createDoc("target", 200, 200);
const state = newAutoPasteState();
assert((await autoPasteTick(state)).length === 0, "첫 tick은 기준만 기록");

// 드롭된 PNG 흉내: PNG를 열어 SO로 만들고 대상 문서로 복사 후 120% 확대(배치 시 스케일 상황)
const src = await openFile("/tmp/jp_test_7982/ap/drop.png");
await exec("layer.new.layerFromBackground", { ifPresent: true });
await convertToSmartObject();
await copyLayersToDocument(target, undefined, { source: src, at: [100, 80] });
await exec("file.close", { document: src });
await exec("document.activate", { document: target });
const so = (await getAllLayers()).find((l) => /smart/i.test(l.kind))!;
await layTransform(120, 120, "bicubic", so.id);
const soB = (await getAllLayers()).find((l) => l.id === so.id)!.bounds!;
const cx = soB[0] + soB[2] / 2, cy = soB[1] + soB[3] / 2;
console.log("SO", JSON.stringify(soB), (await getLayerDetail(so.id))?.smartSource);

// 기본 조건(PNG 원본)으로는 ".pcraft" 원본 SO를 건드리지 않는다
const s2 = newAutoPasteState();
await autoPasteTick(s2);
s2.known.delete(so.id);
s2.revision = -1;
assert((await autoPasteTick(s2)).length === 0, "PNG가 아닌 SO 무시");

// 테스트용 accept: 새 SO 전부
const docCount = (await listDocuments()).documents.length;
const ids = await autoPasteTick(state, () => true);
const ls = await getAllLayers();
console.log(ls.map((l) => `${l.id}:${l.name}:${l.kind}:${JSON.stringify(l.bounds)}`).join(" | "));
assert(ids.length === 1, "변환 1건");
const px = ls.find((l) => l.id === ids[0])!;
assert(px.kind === "Pixel", "픽셀 레이어");
assert(px.bounds![2] === 41 && px.bounds![3] === 31, "원본 해상도 41x31");
assert(px.bounds![0] === Math.round(cx - 41 / 2) && px.bounds![1] === Math.round(cy - 31 / 2), "중심 유지(정수)");
assert(!ls.some((l) => l.id === so.id), "원본 SO 삭제");
assert(px.active, "새 레이어 선택");
assert((await listDocuments()).documents.length === docCount, "내용 문서 닫힘");
assert((await autoPasteTick(state, () => true)).length === 0, "재처리 없음");

// 폴링 시작/중지가 오류 없이 동작
const stop = startAutoPastePngPolling(200);
await new Promise((r) => setTimeout(r, 700));
stop();
await docCloseWithoutSaving();
console.log("AUTO PASTE OK");
