// 하네스 동작 확인: 새 문서 → 레이어 2개 → 목록 → 닫기
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving } from "../../src/lib/lib_doc";
import { newLayer, getAllLayers } from "../../src/lib/lib_layer";

await createDoc("smoke", 200, 100);
await newLayer("A");
await newLayer("B");
const layers = await getAllLayers();
console.log(layers.map((l) => `${l.id}:${l.name}`).join(", "));
if (layers.length !== 3) throw new Error("expected 3 layers");
await exec("select.all");
await docCloseWithoutSaving();
console.log("SMOKE OK");
