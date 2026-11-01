// GUIDE 섹션 (CAT index.html #guideExpandableUI 대응)
import { useState } from "react";
import { Section, Row, Divider, IconButton, Checkbox } from "../ui/components";
import { SizePresetDropdown } from "../ui/SizePresetDropdown";
import { getGuideGrid, getGuideOffset } from "../features/sizePresets";
import { addAllGuides, addGuideFromEdge, clearGuides, copyGuides, pasteGuides, type EdgeDirection } from "../features/addGuide";
import { patchMaker } from "../features/patchMaker";

export default function GuideSection() {
  const [layerBound, setLayerBound] = useState(false);
  const grid = (withNumbers: boolean) => {
    const { rows, cols } = getGuideGrid();
    return addAllGuides(withNumbers, rows, cols);
  };
  const edge = (d: EdgeDirection) => addGuideFromEdge(d, getGuideOffset(), layerBound);
  return (
    <Section title="GUIDE">
      <Row>
        <SizePresetDropdown preset="guideGrid" tooltip="Rows x Columns" />
        <IconButton icon="addNum_light@1X.png" tooltip="Guides with numbers" onClick={() => grid(true)} />
        <IconButton icon="guidemake_light@1X.png" tooltip="Make guides" onClick={() => grid(false)} />
      </Row>
      <Row>
        <IconButton icon="clearguide_light@1X.png" tooltip="Clear guides" onClick={clearGuides} />
        <IconButton icon="copy_light@1X.png" tooltip="Copy guides" onClick={copyGuides} />
        <IconButton icon="paste_light@1X.png" tooltip="Paste guides" onClick={pasteGuides} />
        <IconButton icon="patch_light@1X.png" tooltip="Make 9-patch" onClick={patchMaker} />
      </Row>
      <Divider />
      <Row>
        <SizePresetDropdown preset="guideOffset" tooltip="Guide offset" />
        <Checkbox label="Only selected layer" checked={layerBound} onChange={setLayerBound} />
      </Row>
      <Row>
        <IconButton icon="guide_top_light@1X.png" tooltip="Guide from top" onClick={() => edge("top")} />
        <IconButton icon="guide_bottom_light@1X.png" tooltip="Guide from bottom" onClick={() => edge("bottom")} />
        <IconButton icon="guide_left_light@1X.png" tooltip="Guide from left" onClick={() => edge("left")} />
        <IconButton icon="guide_right_light@1X.png" tooltip="Guide from right" onClick={() => edge("right")} />
      </Row>
    </Section>
  );
}
