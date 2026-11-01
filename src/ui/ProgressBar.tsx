// 전역 진행률 바
import { useEffect, useState } from "react";
import { subscribeProgress, type Progress } from "./progress";

export function ProgressBar() {
  const [p, setP] = useState<Progress | null>(null);
  useEffect(() => subscribeProgress(setP), []);
  if (!p) return null;
  return (
    <div className="progress">
      <div className="progress-label">{p.label}</div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${p.percent}%` }} />
      </div>
    </div>
  );
}
