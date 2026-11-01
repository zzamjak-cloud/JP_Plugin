// 모든 레이어를 새 문서로 옮겨 원본 경로에 다시 저장 (CAT cleanPSD.js 대응)
// 누적된 메타데이터·잔여 데이터를 털어낸다. 완료 후에는 원본처럼 문서가 열려 있지 않다.
import { requireDoc, listDocuments, activateDoc, createDocCopyLayers, docCloseWithoutSaving, docNameAt } from "../lib/lib_doc";
import { selectNoLayers, selectAllLayers } from "../lib/lib_layer";
import { saveActiveDocAs, activeDocPath } from "../lib/lib_export";

export async function cleanPSD(): Promise<string> {
  const doc = await requireDoc();
  const originalPath = await activeDocPath();
  // 루트 밖 파일의 임시 복사본(.jp_plugin_tmp)은 원본 위치가 아니므로 미저장으로 취급
  if (!originalPath || originalPath.includes("/.jp_plugin_tmp/")) throw new Error("저장된 문서가 아닙니다. 먼저 PSD로 저장해주세요.");
  const original = (await listDocuments()).active ?? 0;

  // 1. 모든 레이어 선택 후 새 문서로 복사
  await selectNoLayers();
  await selectAllLayers();
  let newDoc = await createDocCopyLayers(doc.name);
  const newName = (await docNameAt(newDoc)) ?? doc.name;
  // 2. 새 문서를 원본 경로에 먼저 저장 (기존 파일은 저장 성공 후에만 교체됨).
  //    실패하면 원본·복사본 문서를 모두 열어 둔 채로 중단한다 — 작업 내용을 잃지 않도록.
  await activateDoc(newDoc);
  await saveActiveDocAs(originalPath);
  // 3. 저장이 끝난 뒤에만 원본 문서를 닫는다 (이름 확인 후)
  await docCloseWithoutSaving(original, doc.name);
  if (newDoc > original) newDoc--;
  // 4. 새 문서 닫기 (이미 저장됨)
  await docCloseWithoutSaving(newDoc, newName);
  console.log("Clean PSD 완료");
  return originalPath;
}
