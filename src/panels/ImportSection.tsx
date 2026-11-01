// IMPORT 섹션 (CAT index.html IMPORT 대응): 문서 사이즈 + PSD/PNG 가져오기 + Auto Paste PNG, 그리드 배치
import { useEffect, useState } from "react";
import { Section, Row, Divider, IconButton, Checkbox } from "../ui/components";
import { SizePresetDropdown } from "../ui/SizePresetDropdown";
import { importPSDFiles, importPNGFiles } from "../features/importFiles";
import { applyGridLayout } from "../features/applyGridLayout";
import { isAutoPastePngEnabled, setAutoPastePngEnabled, startAutoPastePngPolling } from "../features/autoPastePng";

export default function ImportSection() {
  const [autoPaste, setAutoPaste] = useState<boolean>(() => isAutoPastePngEnabled());
  // 체크 상태 동안만 새 PNG 스마트 오브젝트 감지 폴링
  useEffect(() => (autoPaste ? startAutoPastePngPolling(1000) : undefined), [autoPaste]);
  return (
    <Section title="IMPORT">
      <Row>
        <SizePresetDropdown preset="importDocSize" />
        <IconButton icon="export_all_lays_import_psd_light@1X.png" tooltip="Import PSD files" onClick={importPSDFiles} />
        <IconButton icon="export_all_lays_import_png_light@1X.png" tooltip="Import PNG files" onClick={importPNGFiles} />
        <span title="Drop PNG as pixel layer" data-tooltip="Drop PNG as pixel layer" style={{ marginLeft: 8 }}>
          <Checkbox
            label=""
            checked={autoPaste}
            onChange={(v) => {
              setAutoPaste(v);
              setAutoPastePngEnabled(v);
            }}
          />
        </span>
      </Row>
      <Divider />
      <Row>
        <SizePresetDropdown preset="arrayGridSize" />
        <SizePresetDropdown preset="arrayColumns" width={48} />
        <IconButton icon="array_light@1x.png" tooltip="Arrange in grid" onClick={applyGridLayout} />
      </Row>
    </Section>
  );
}
