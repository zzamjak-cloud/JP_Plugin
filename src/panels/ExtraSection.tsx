// EXTRA 섹션: CAT에서 UI에 연결되지 않았던 기능(Appendix B) 버튼 모음
import { Section, Row, IconButton } from "../ui/components";
import { clearEmptyLayers } from "../features/clearEmptyLayers";
import { clearHiddenEffects } from "../features/clearHiddenEffects";
import { animationMatchLayers } from "../features/animationMatchLayers";
import { appIconMaker } from "../features/appIconMaker";

export default function ExtraSection() {
  return (
    <Section title="EXTRA">
      <Row>
        <IconButton icon="clear_empty_layers_light@1X.png" tooltip="Clear empty layers" onClick={clearEmptyLayers} />
        <IconButton icon="clear_hiddenFX_light@1X.png" tooltip="Clear hidden effects" onClick={clearHiddenEffects} />
        <IconButton icon="animation_match_layers@1X.png" tooltip="Animation match layers" onClick={animationMatchLayers} />
        <IconButton icon="appicon_light@1X.png" tooltip="App icon maker" onClick={appIconMaker} />
      </Row>
    </Section>
  );
}
