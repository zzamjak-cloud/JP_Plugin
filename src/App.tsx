// JP Plugin 메인 화면: CAT Tools / 9-Slice Images 탭
import { useState } from "react";
import { ConnectionBar } from "./ui/ConnectionBar";
import { ProgressBar } from "./ui/ProgressBar";
import { PromptHost } from "./ui/components";
import ExportSection from "./panels/ExportSection";
import ImportSection from "./panels/ImportSection";
import RenameSection from "./panels/RenameSection";
import GuideSection from "./panels/GuideSection";
import ExtraSection from "./panels/ExtraSection";
import NineSlicePanel from "./panels/NineSlicePanel";
import "./style.css";

export default function App() {
  const [tab, setTab] = useState<"tools" | "nineslice">(() => (localStorage.getItem("jp_tab") as any) ?? "tools");
  const switchTab = (t: "tools" | "nineslice") => {
    setTab(t);
    localStorage.setItem("jp_tab", t);
  };
  return (
    <div className="app">
      <ConnectionBar />
      <div className="tabs">
        <button className={tab === "tools" ? "active" : ""} onClick={() => switchTab("tools")}>
          CAT Tools
        </button>
        <button className={tab === "nineslice" ? "active" : ""} onClick={() => switchTab("nineslice")}>
          9-Slice Images
        </button>
      </div>
      <div className="scroll">
        <div style={{ display: tab === "tools" ? "block" : "none" }}>
          <ExportSection />
          <ImportSection />
          <RenameSection />
          <GuideSection />
          <ExtraSection />
        </div>
        <div style={{ display: tab === "nineslice" ? "block" : "none" }}>
          <NineSlicePanel />
        </div>
      </div>
      <ProgressBar />
      <PromptHost />
    </div>
  );
}
