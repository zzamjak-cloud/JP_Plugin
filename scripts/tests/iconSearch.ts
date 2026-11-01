// Search icons: Iconify 검색/프리뷰/가져오기 (Node fetch로 실제 API 호출)
import { docCloseWithoutSaving, getDocInfo } from "../../src/lib/lib_doc";
import { getAllLayers } from "../../src/lib/lib_layer";
import { getShapeInfo } from "../../src/lib/lib_shape";
import { PAGE_SIZE, searchIcons, loadPreviews, getPreview, importIcon } from "../../src/features/iconSearch";

const assert = (c: unknown, m: string) => { if (!c) throw new Error("ASSERT: " + m); };
const icons = await searchIcons("home");
console.log("검색 결과", icons.length, icons.slice(0, 3).join(","));
assert(icons.length > PAGE_SIZE && icons.every((i) => i.includes(":")), "검색 결과 prefix:name");
const page = icons.slice(0, PAGE_SIZE);
await loadPreviews(page);
const loaded = page.filter((i) => getPreview(i));
console.log("프리뷰", loaded.length, "/", page.length);
assert(loaded.length >= page.length * 0.9, "프리뷰 로드");
const uri = getPreview(loaded[0])!;
const svg = Buffer.from(uri.split(",")[1], "base64").toString("utf8");
assert(uri.startsWith("data:image/svg+xml;base64,") && svg.includes('width="56"') && !svg.includes("currentColor"), "프리뷰 SVG");
assert((await searchIcons("zzqqxxnotanicon")).length === 0, "결과 없음");

const ids = await importIcon("mdi:home");
const d = await getDocInfo();
assert(d!.name.startsWith("home") && d!.width === 128, "문서 이름 home " + d!.name);
const shapes = (await getAllLayers()).filter((l) => l.kind === "Shape");
assert(shapes.length === 1 && ids[0] === shapes[0].id, "Shape 1개");
const info = await getShapeInfo(shapes[0].id);
console.log("mdi:home bounds", JSON.stringify(info.bounds), "subpaths", info.path.subpaths.length);
assert(info.fill === "#000000" && info.bounds[2] > 90, "currentColor → 검정, 크기");
await docCloseWithoutSaving();
console.log("ICON_SEARCH OK");
