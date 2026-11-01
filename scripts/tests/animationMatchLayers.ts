// Animation match layers 검증: 타임라인 프레임 순회·대상 레이어 선택, 타임라인 없으면 오류 알림
import { exec } from "../../src/core/bridge";
import { createDoc, docCloseWithoutSaving, getTimelineInfo } from "../../src/lib/lib_doc";
import { newLayer, getAllLayers } from "../../src/lib/lib_layer";
import { animationMatchLayers } from "../../src/features/animationMatchLayers";

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};
await createDoc("anim", 40, 40);
await newLayer("frameA");
const log = (globalThis as any).__JP_LOG__ as string[];
if (!(await getTimelineInfo())) {
  log.length = 0;
  assert((await animationMatchLayers()) === 0 && log[0] === "애니메이션 레이어 매칭 중 오류가 발생했습니다.", "타임라인 없음 알림");
  await exec("timeline.create", { duration: 5, fps: 5 });
}
await exec("timeline.setProps", { duration: 5 });
await exec("timeline.setFrame", { frame: 2 });
const n = await animationMatchLayers();
const info = await getTimelineInfo();
const active = (await getAllLayers()).find((l) => l.active);
console.log("frames", n, "timeline", JSON.stringify(info), "active", active?.name);
assert(n === 5, "5프레임 처리");
assert(info?.current === 2, "원래 프레임 복원");
assert(active?.name === "frameA", "Layer 1 제외 첫 보이는 레이어 선택");
await docCloseWithoutSaving();
console.log("ANIMATION OK");
