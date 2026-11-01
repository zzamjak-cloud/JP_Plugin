// PhotoCraft document.inspect / layer.list 응답 타입
export type Bounds = [number, number, number, number]; // [x, y, w, h]

export interface PcLayer {
  id: number;
  name: string;
  kind: string; // "Pixel" | "Group" | "Type" | "Shape" | "SmartObject" | "Adjustment" | "Fill" …
  visible: boolean;
  bounds: Bounds | null;
  selected: boolean;
  active: boolean;
  children?: PcLayer[];
  depth?: number;
  parent?: number | null;
}

export interface PcDocInfo {
  name: string;
  path: string | null;
  width: number;
  height: number;
  resolution: number;
  mode: string;
  depth: number;
  hasSelection: boolean;
  selectionBounds: Bounds | null;
  selectedLayers: number[];
  activeLayer: number | null;
  layers: any[];
  history: string[];
  revision: number;
}

export interface PcSession {
  index: number;
  name: string;
}
