// EXPORT 섹션 (CAT index.html #exportExpandableUI 와 같은 행/버튼 배치)
import { useState } from "react";
import { Section, Row, Divider, IconButton, Checkbox, Dropdown } from "../ui/components";
import { showAlert } from "../lib/lib";
import {
  getFolderPresets,
  getSelectedFolder,
  setSelectedFolder,
  removeFolderPreset,
  addFolderPresetViaDialog,
  getKeepDocSize,
  setKeepDocSize,
  type FolderPreset,
} from "../features/folderPreset";
import { exportSelectedFile } from "../features/exportSelectedLayers";
import { savePngAndLinkToPSD } from "../features/exportSelectedAndLink";
import { speedSave } from "../features/exportSpeedSave";
import { exportMarketScreenshot } from "../features/exportMarketScreenshot";
import { cleanPSD } from "../features/cleanPSD";
import { splitToLayers } from "../features/splitToLayers";
import { sortAllLayers, sortSelectedLayers } from "../features/sortingLayer";
import { patchMaker } from "../features/patchMaker";
import { outlineStroke, expandPath } from "../features/outlineStroke";
import { imageTrace } from "../features/imageTrace";
import { importSvgToShape } from "../features/svgToShapeLayer";
import IconSearchDialog from "./IconSearchDialog";

export default function ExportSection() {
  const [presets, setPresets] = useState<FolderPreset[]>(getFolderPresets);
  const [selected, setSelected] = useState<FolderPreset | null>(getSelectedFolder);
  const [keepDocSize, setKeep] = useState<boolean>(getKeepDocSize);
  const [iconSearchOpen, setIconSearchOpen] = useState(false);

  const refresh = () => {
    setPresets(getFolderPresets());
    setSelected(getSelectedFolder());
  };

  return (
    <Section title="EXPORT">
      {/* 내보내기 폴더 프리셋 드롭다운 */}
      <Dropdown<FolderPreset>
        items={presets.map((p) => ({ value: p, label: p.name, removable: true }))}
        selectedLabel={selected?.name ?? "No Folder"}
        tooltip={selected?.path ?? "Select export folder"}
        onSelect={(it) => {
          setSelectedFolder(it.value);
          refresh();
        }}
        onRemove={(it) => {
          removeFolderPreset(it.value.id);
          refresh();
        }}
        onCustom={async () => {
          try {
            await addFolderPresetViaDialog();
          } catch (e) {
            await showAlert(e instanceof Error ? e.message : String(e));
          }
          refresh();
        }}
      />

      <Row>
        <IconButton icon="link_1_light@1X.png" tooltip="Export PNG & link" onClick={() => savePngAndLinkToPSD()} />
        <IconButton icon="export_all_lays_import_psd_light@1X.png" tooltip="Export layers as PSD" onClick={() => exportSelectedFile("psd")} />
        <IconButton icon="export_all_lays_import_png_light@1X.png" tooltip="Export layers as PNG" onClick={() => exportSelectedFile("png")} />
        <span data-tooltip="Keep doc size" title="Keep doc size">
          <Checkbox
            label=""
            checked={keepDocSize}
            onChange={(v) => {
              setKeep(v);
              setKeepDocSize(v);
            }}
          />
        </span>
      </Row>

      <Divider />

      <Row>
        <IconButton icon="psd_cleaner_light@1X.png" tooltip="Clean PSD" onClick={() => cleanPSD()} />
        <IconButton icon="split_to_layers_light@1x.png" tooltip="Split to layers" onClick={() => splitToLayers()} />
        <IconButton icon="sort_light@1X.png" tooltip="Sort all layers" onClick={() => sortAllLayers()} />
        <IconButton icon="sort_pick_light@1X.png" tooltip="Sort selected layers" onClick={() => sortSelectedLayers()} />
        <IconButton icon="patch_light@1X.png" tooltip="Make 9-patch" onClick={() => patchMaker()} />
      </Row>

      <Row>
        <IconButton icon="outlinestroke_light@1x.png" tooltip="Outline stroke" onClick={() => outlineStroke()} />
        <IconButton icon="expandstroke_light@1x.png" tooltip="Expand path" onClick={() => expandPath()} />
        <IconButton icon="imagetracing_light@1x.png" tooltip="Image trace" onClick={() => imageTrace()} />
        <IconButton icon="export_market_screenshop@1X.png" tooltip="Market screenshot" onClick={() => exportMarketScreenshot()} />
        <IconButton icon="import_searchicon_light@1X.png" tooltip="Search icons" onClick={() => setIconSearchOpen(true)} />
      </Row>

      <Row>
        <IconButton icon="import_svg_light@1X.png" tooltip="Import SVG as shape" onClick={() => importSvgToShape()} />
        <IconButton icon="export_gif_light@1X.png" tooltip="Save GIF" onClick={() => speedSave("gif")} />
        <IconButton icon="export_jpg_light@1X.png" tooltip="Save JPG" onClick={() => speedSave("jpg")} />
        <IconButton icon="export_png_light@1X.png" tooltip="Save PNG" onClick={() => speedSave("png")} />
      </Row>

      <IconSearchDialog open={iconSearchOpen} onClose={() => setIconSearchOpen(false)} />
    </Section>
  );
}
