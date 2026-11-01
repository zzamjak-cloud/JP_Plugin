// 활성 문서를 PSD와 같은 폴더·같은 이름으로 GIF/JPG/PNG 저장 (CAT exportSpeedSave.js speedSave 대응)
import { saveForWebPNG, saveForWebJPG, saveForWebGIF } from "../lib/lib_export";
import { docFolderAndName } from "./folderPreset";

/** extension: png(PNG-24 투명) / jpg(품질 60) / gif. 기존 파일은 덮어쓴다 → 저장 경로 */
export async function speedSave(extension: "png" | "jpg" | "gif"): Promise<string> {
  const { folder, name } = await docFolderAndName();
  if (extension === "png") await saveForWebPNG(folder, name);
  else if (extension === "jpg") await saveForWebJPG(folder, name);
  else await saveForWebGIF(folder, name);
  console.log(`${extension} 저장 완료`);
  return `${folder}/${name}.${extension}`;
}
