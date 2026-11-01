// 그룹/스마트 오브젝트 내용을 PNG + PSD로 내보내기 (CAT exportSelectedAndLink.js savePngAndLinkToPSD 대응)
// PhotoCraft 제어 채널은 layer.smartObjects.relinkToFile / convertToLinked(경로 파라미터)를 거부하므로
// 내보낸 PSD로 재연결하는 단계는 할 수 없다. 스마트 오브젝트는 임베디드 상태로 남는다.
import * as fsx from "../core/fs";
import { showAlert } from "../lib/lib";
import { withHistory } from "../core/bridge";
import { requireDoc, listDocuments, activateDoc, docCloseWithoutSaving, trimTransparent } from "../lib/lib_doc";
import {
  getSelectedLayers,
  selectByLayerID,
  selectNoLayers,
  isGroup,
  isSmartObject,
  convertToSmartObject,
  editSmartObjectContents,
} from "../lib/lib_layer";
import { saveForWebPNG, saveAsPSD } from "../lib/lib_export";
import { getKeepDocSize, resolveExportFolder } from "./folderPreset";

export async function savePngAndLinkToPSD(): Promise<string[]> {
  const exported: string[] = [];
  try {
    await requireDoc();
    const keepDocSize = getKeepDocSize();
    const layers = (await getSelectedLayers()).filter((l) => isSmartObject(l) || isGroup(l));
    if (layers.length === 0) throw new Error("스마트 오브젝트 또는 그룹 레이어를 선택해주세요.");
    const folder = await resolveExportFolder();
    const parent = (await listDocuments()).active ?? 0;

    await withHistory(async () => {
      for (const layer of layers) {
        await activateDoc(parent);
        await selectByLayerID(layer.id);
        let soId = layer.id;
        if (isGroup(layer)) {
          // 그룹 → 스마트 오브젝트 변환 (UXP newPlacedLayer)
          const r = await convertToSmartObject(layer.id);
          soId = r?.layer ?? soId;
        }
        const opened = await editSmartObjectContents(soId).catch(() => null);
        if (!opened) {
          // 이 레이어만 건너뛰고 나머지는 계속 처리
          await showAlert(`"${layer.name}": Smart Object가 아닙니다.`);
          await activateDoc(parent).catch(() => {});
          continue;
        }
        if (!keepDocSize) await trimTransparent();
        exported.push(await saveAndClose(folder, opened.document));
        await activateDoc(parent);
        await selectNoLayers();
      }
    });
  } catch (e) {
    await showAlert(e instanceof Error ? e.message : String(e));
  }
  return exported;
}

// 내용 문서를 <폴더>/<내용문서명>.png / .psd 로 저장 후 닫는다 (CAT: xxx.psb → xxx.png / xxx.psd)
async function saveAndClose(folder: string, contentsDoc: number): Promise<string> {
  await activateDoc(contentsDoc);
  const docName = (await requireDoc()).name;
  const base = fsx.stem(docName);
  await saveForWebPNG(folder, base);
  await saveAsPSD(fsx.join(folder, `${base}.psd`));
  await docCloseWithoutSaving(contentsDoc, docName);
  return base;
}
