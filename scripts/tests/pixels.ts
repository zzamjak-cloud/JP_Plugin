// lib_pixels/lib_export 왕복 검증
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving, listDocuments } from "../../src/lib/lib_doc";
import { getLayerPixels, putPixelsAsLayer, alphaBounds } from "../../src/lib/lib_pixels";
import { getAllLayers } from "../../src/lib/lib_layer";
import { saveForWebPNG, saveForWebJPG, saveAsPSD } from "../../src/lib/lib_export";

const doc = await createDoc("pix", 120, 80);
await exec("select.rect", { x: 10, y: 20, width: 30, height: 15 });
await exec("edit.fill", { contents: "color", color: "#ff0000" });
await exec("select.deselect");
const img = await getLayerPixels();
console.log("size", img.width, img.height, "bounds", alphaBounds(img));
const sub = { width: 5, height: 5, data: new Uint8Array(100).fill(255) };
const id = await putPixelsAsLayer(sub, "white5", 50, 40);
const ls = await getAllLayers();
console.log(ls.map((l) => `${l.id}:${l.name}:${JSON.stringify(l.bounds)}`).join(" | "), "docs", JSON.stringify(await listDocuments()), "new", id);
await saveForWebPNG("/tmp/jp_out", "a");
await saveForWebJPG("/tmp/jp_out", "a");
await saveAsPSD("/tmp/jp_out/a");
await docCloseWithoutSaving();
console.log("PIXELS OK", doc);
