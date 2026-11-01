// 앱 아이콘 일괄 생성 (CAT appIconMaker.js appIconMaker 대응)
// 2048 템플릿 문서를 복제 → 캔버스 1332 중앙 크롭 → 크기별 리사이즈 → PNG 저장.
// 적응형 아이콘은 최상위 "f"/"b" 레이어만 보이게 해 크롭 없이 리사이즈한다.
import * as fsx from "../core/fs";
import { showAlert } from "../lib/lib";
import { requireDoc, listDocuments, activateDoc, duplicateDoc, canvasSize, docResize, docCloseWithoutSaving, docNameAt } from "../lib/lib_doc";
import { getLayerTree, setVisible } from "../lib/lib_layer";
import { saveForWebPNG } from "../lib/lib_export";
import { setProgress, clearProgress } from "../ui/progress";

export const APP_ICONS = {
  ANDROID: { name: "android", sizes: [512, 432, 324, 216, 192, 162, 108, 144, 96, 81, 72, 48, 36] },
  IOS: { name: "iOS", sizes: [1024, 180, 167, 152, 144, 120, 114, 87, 80, 76, 72, 60, 58, 57, 40, 29, 20] },
  ANDROID_ADAPTIVE: { name: "android(Adaptive)", sizes: [432, 324, 216, 162, 108, 81] },
};
const CROP_SIZE = 1332;
// 축소 품질을 위해 bicubic 사용 (CAT은 호출부가 보간법을 넘기며, 미지정 시 nearestNeighbor)
const RESAMPLE = "bicubic";

export async function appIconMaker(): Promise<void> {
  const resample = RESAMPLE;
  await requireDoc();
  const folder = await fsx.pickFolder();
  if (!folder) throw new Error("폴더가 선택되지 않았습니다.");
  for (const p of [APP_ICONS.ANDROID, APP_ICONS.IOS, APP_ICONS.ANDROID_ADAPTIVE]) await fsx.mkdir(fsx.join(folder, p.name));

  const original = (await listDocuments()).active ?? 0;
  const total = APP_ICONS.IOS.sizes.length + APP_ICONS.ANDROID.sizes.length + APP_ICONS.ANDROID_ADAPTIVE.sizes.length * 2;
  let done = 0;
  const step = (label: string) => setProgress(`아이콘 생성 중: ${label} (${++done}/${total})`, (done / total) * 100);

  try {
    for (const platform of [APP_ICONS.IOS, APP_ICONS.ANDROID]) {
      for (const size of platform.sizes) {
        const fileName = `${platform.name}_${size}`;
        step(fileName);
        await generateIcon(original, size, fsx.join(folder, platform.name), fileName, resample, async () => {
          await canvasSize(CROP_SIZE, CROP_SIZE, "center");
        });
      }
    }
    for (const size of APP_ICONS.ANDROID_ADAPTIVE.sizes) {
      for (const layerName of ["f", "b"]) {
        const fileName = `android_${size}_${layerName}`;
        step(fileName);
        await generateIcon(original, size, fsx.join(folder, APP_ICONS.ANDROID_ADAPTIVE.name), fileName, resample, async () => {
          // 최상위 레이어 중 해당 이름만 표시
          for (const l of await getLayerTree()) await setVisible(l.id, l.name === layerName);
        });
      }
    }
  } finally {
    clearProgress();
  }
  await showAlert("앱 아이콘 생성이 완료되었습니다!");
}

// 문서 복제 → 준비(크롭/레이어 표시) → 리사이즈 → PNG 저장 → 닫기
async function generateIcon(original: number, size: number, folder: string, fileName: string, resample: string, prepare: () => Promise<void>) {
  await activateDoc(original);
  const dup = await duplicateDoc(fileName);
  const dupName = (await docNameAt(dup)) ?? fileName;
  try {
    await prepare();
    await docResize(size, size, resample);
    await saveForWebPNG(folder, fileName);
  } catch (e) {
    throw new Error(`아이콘 생성 실패 (${size}px): ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await docCloseWithoutSaving(dup, dupName).catch(() => {});
    await activateDoc(original).catch(() => {});
  }
}
