// 선택 레이어를 각각 새 문서로 만들어 PNG(+PSD)로 내보내기 (CAT exportSelectedLayers.js exportSelectedFile 대응)
import * as fsx from "../core/fs";
import { sanitizeFileName } from "../lib/lib";
import { requireDoc, listDocuments, activateDoc, createDocCopyLayers, docCloseWithoutSaving, docNameAt, trimTransparent } from "../lib/lib_doc";
import { getSelectedLayers, selectNoLayers, selectByLayerID, isGroup, isSmartObject } from "../lib/lib_layer";
import { saveForWebPNG, saveAsPSD } from "../lib/lib_export";
import { getKeepDocSize, resolveExportFolder } from "./folderPreset";
import type { PcLayer } from "../lib/types";

/** fileType: "png" = 모든 레이어, "psd" = 그룹/스마트 오브젝트만 (PNG + PSD 저장) */
export async function exportSelectedFile(fileType: "png" | "psd"): Promise<{ success: number; failed: { name: string; error: string }[] }> {
  await requireDoc();
  const selected = await getSelectedLayers();
  const keepDocSize = getKeepDocSize();
  if (selected.length === 0) throw new Error("레이어를 선택해주세요.");

  const valid = fileType === "png" ? selected : selected.filter((l) => isGroup(l) || isSmartObject(l));
  if (valid.length === 0) {
    throw new Error(fileType === "png" ? "레이어를 선택해주세요." : "그룹 레이어 또는 스마트 오브젝트를 선택해주세요.");
  }

  const folder = await resolveExportFolder();
  const original = (await listDocuments()).active ?? 0;
  let success = 0;
  const failed: { name: string; error: string }[] = [];

  // 레이어별 순차 처리. 실패한 레이어는 기록 후 다음 레이어로 진행
  for (const layer of valid) {
    try {
      await copyLayerToNewDocument(layer, original, folder, fileType, keepDocSize);
      success++;
    } catch (e) {
      failed.push({ name: layer.name, error: e instanceof Error ? e.message : String(e) });
      console.log(`레이어 "${layer.name}" 처리 실패: ${failed[failed.length - 1].error}`);
    }
  }
  return { success, failed };
}

// 레이어를 새 문서로 복사 → (트림) → 저장 → 닫기
async function copyLayerToNewDocument(layer: PcLayer, original: number, folder: string, fileType: "png" | "psd", keepDocSize: boolean) {
  let newDoc: number | null = null;
  try {
    await activateDoc(original);
    await selectNoLayers();
    await selectByLayerID(layer.id);
    newDoc = await createDocCopyLayers(layer.name, layer.id);
    if (newDoc === original) throw new Error("새 문서 생성에 실패했습니다.");
    const newName = (await docNameAt(newDoc)) ?? layer.name;
    if (!keepDocSize) await trimTransparent();

    const name = sanitizeFileName(layer.name);
    await saveForWebPNG(folder, name);
    if (fileType === "psd") await saveAsPSD(fsx.join(folder, `${name}.psd`));

    await docCloseWithoutSaving(newDoc, newName);
    newDoc = null;
    await activateDoc(original);
  } catch (e) {
    // 실패 시 정리: 방금 만든 임시 문서(이름 "<레이어명>")만 닫는다
    if (newDoc !== null && newDoc !== original) await docCloseWithoutSaving(newDoc, layer.name).catch(() => {});
    await activateDoc(original).catch(() => {});
    throw e;
  }
}
