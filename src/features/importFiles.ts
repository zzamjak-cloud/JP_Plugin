// Import PSD / PNG files (CAT importFiles.js 대응): 폴더의 PSD/PNG 파일을 새 문서에 스마트 오브젝트 레이어로 가져온다
import * as fsx from "../core/fs";
import { executeWithHistoryGrouping } from "../lib/lib";
import { createDoc } from "../lib/lib_doc";
import { importImageAsLayer } from "../lib/lib_export";
import { getAllLayers, selectLayers, convertToSmartObject, renameLayer, deleteLayer, getActiveLayer } from "../lib/lib_layer";
import { setProgress, clearProgress } from "../ui/progress";
import { getImportDocSize } from "./sizePresets";

/** 폴더 선택 → 확장자(".psd" | ".png") 파일들을 "Imported_Assets" 문서에 가운데 배치 → 생성 문서 인덱스 (취소 시 null) */
export async function makeDocImportEntry(extension: ".psd" | ".png"): Promise<number | null> {
  const folder = await fsx.pickFolder();
  if (!folder) return null;
  const files = (await fsx.listDir(folder)).filter((e) => !e.isDir && e.name.toLowerCase().endsWith(extension));
  if (!files.length) throw new Error(`선택한 폴더에 ${extension.slice(1).toUpperCase()} 파일이 없습니다.`);

  const { width, height } = getImportDocSize();
  const doc = await createDoc("Imported_Assets", width, height, 72, "rgb", "transparent");
  const initial = (await getAllLayers()).map((l) => l.id);
  try {
    await executeWithHistoryGrouping(async () => {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setProgress(`Import ${i + 1}/${files.length}: ${f.name}`, ((i + 1) / files.length) * 100);
        const ids = await importImageAsLayer(f.path, doc, { center: true });
        // UXP placedLayer(링크 스마트 오브젝트) 대응: 가져온 레이어를 하나의 스마트 오브젝트로 묶고 파일명으로 이름 지정
        if (ids.length) await selectLayers(ids);
        await convertToSmartObject();
        const so = await getActiveLayer();
        if (so) await renameLayer(so.id, fsx.stem(f.name));
        // 첫 파일 이후 초기 빈 레이어("Layer 1") 제거
        if (i === 0) for (const id of initial) await deleteLayer(id);
      }
    });
  } finally {
    clearProgress();
  }
  return doc;
}

export const importPSDFiles = () => makeDocImportEntry(".psd");
export const importPNGFiles = () => makeDocImportEntry(".png");
