/**
 * Gizmo types and interfaces
 */
import * as THREE from "three/webgpu";

export type GizmoMode = 'translate' | 'rotate' | 'scale' | 'normal';

export type PivotMode = 'aabb' | 'custom';

export interface GizmoOptions {
  /** Gizmo模式 */
  mode?: GizmoMode;
  /** 是否显示轴 */
  showX?: boolean;
  showY?: boolean;
  showZ?: boolean;
  /** 是否启用空间 */
  space?: 'local' | 'world';
  /** 是否启用吸附 */
  snap?: boolean;
  /** 吸附值 */
  translationSnap?: number;
  rotationSnap?: number;
  scaleSnap?: number;
  /** 是否显示辅助线 */
  showHelper?: boolean;
  /** 大小 */
  size?: number;
  /** 颜色 */
  colors?: {
    x?: string;
    y?: string;
    z?: string;
  };
  /** Pivot 模式（默认 aabb） */
  pivotMode?: PivotMode;
  /** 自定义 Pivot 点（世界坐标） */
  pivot?: THREE.Vector3;
  /** 是否显示 Pivot helper */
  showPivotHelper?: boolean;
}

export interface GizmoEvent {
  type: 'change' | 'changeStart' | 'changeEnd' | 'objectChange';
  target: THREE.Object3D;
  mode: GizmoMode;
  translation?: THREE.Vector3;
  rotation?: THREE.Euler;
  scale?: THREE.Vector3;
  /** 当前生效的 Pivot（世界坐标） */
  pivot?: THREE.Vector3;
}

export interface GizmoCallbacks {
  onChange?: (event: GizmoEvent) => void;
  onChangeStart?: (event: GizmoEvent) => void;
  onChangeEnd?: (event: GizmoEvent) => void;
  onObjectChange?: (event: GizmoEvent) => void;
}
