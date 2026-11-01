// PhotoCraft 연결 상태·실행·설정 바
import { useEffect, useRef, useState } from "react";
import { pcLaunch, pcQuit, pcSetConfig, pcStatus, setCachedConfig, type PcStatus } from "../core/bridge";
import { confirmDialog, showAlert } from "../lib/lib";
import { pickFolder } from "../core/fs";

export function ConnectionBar() {
  const [status, setStatus] = useState<PcStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const inFlight = useRef(false);
  const refresh = async () => {
    // 이전 상태 조회가 끝나지 않았으면 겹쳐 보내지 않는다
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const s = await pcStatus();
      setStatus(s);
      setCachedConfig(s.config);
    } catch (e) {
      setStatus(null);
    } finally {
      inFlight.current = false;
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const launch = async () => {
    setBusy(true);
    try {
      await pcLaunch();
    } catch (e) {
      if (String(e).includes("RUNNING_WITHOUT_CONTROL")) {
        const ok = await confirmDialog(
          "PhotoCraft가 제어 포트 없이 실행 중입니다.\nJP Plugin과 연결하려면 PhotoCraft를 재시작해야 합니다.\n(저장하지 않은 문서는 PhotoCraft가 저장 여부를 묻습니다)\n\n지금 재시작할까요?",
        );
        if (ok) {
          try {
            await pcQuit();
            await pcLaunch();
          } catch (e2) {
            await showAlert(String(e2));
          }
        }
      } else {
        await showAlert(String(e));
      }
    }
    await refresh();
    setBusy(false);
  };

  const connected = status?.connected ?? false;
  return (
    <div className="conn-bar">
      <span className={`dot ${connected ? "on" : "off"}`} />
      <span className="conn-text">{connected ? `PhotoCraft 연결됨 (:${status?.config.port})` : "PhotoCraft 연결 안 됨"}</span>
      {!connected && (
        <button className="small" disabled={busy} onClick={launch}>
          {busy ? "실행 중…" : "PhotoCraft 실행"}
        </button>
      )}
      <button className="small ghost" onClick={() => setShowSettings(!showSettings)} title="설정">
        ⚙
      </button>
      {showSettings && status && (
        <div className="settings">
          <label>
            PhotoCraft 앱
            <input defaultValue={status.config.appPath} onBlur={(e) => pcSetConfig({ ...status.config, appPath: e.target.value }).then(refresh)} />
          </label>
          <label>
            제어 포트
            <input type="number" defaultValue={status.config.port} onBlur={(e) => {
                const port = Math.trunc(Number(e.target.value));
                if (port >= 1 && port <= 65535) pcSetConfig({ ...status.config, port }).then(refresh);
                else e.target.value = String(status.config.port);
              }} />
          </label>
          <label>
            작업 루트 (PhotoCraft 파일 접근 허용 폴더)
            <div className="inline">
              <input readOnly value={status.config.root} />
              <button
                className="small"
                onClick={async () => {
                  const f = await pickFolder(status.config.root);
                  if (f) {
                    await pcSetConfig({ ...status.config, root: f });
                    await refresh();
                    await showAlert("작업 루트가 변경됐습니다. PhotoCraft를 재시작해야 적용됩니다.");
                  }
                }}
              >
                변경
              </button>
            </div>
          </label>
          {status.error && !connected && <div className="error">{status.error}</div>}
        </div>
      )}
    </div>
  );
}
