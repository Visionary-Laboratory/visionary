/**
 * Gizmo Manager - 管理多个Gizmo控制器和场景集成
 */
import * as THREE from "three/webgpu";
import { GizmoController } from './gizmo-controller';
import { GizmoOptions, GizmoMode, GizmoEvent, GizmoCallbacks, PivotMode } from './types';

export class GizmoManager {
  private scene: THREE.Scene;
  private overlayScene: THREE.Scene;
  private camera: THREE.Camera;
  private renderer: THREE.WebGPURenderer;
  private gizmoController: GizmoController;
  private currentTarget: THREE.Object3D | null = null;
  private gizmoEnabled: boolean = true;
  private callbacks: GizmoCallbacks = {};
  private cameraControls: any = null; // 相机控制器引用

  constructor(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGPURenderer, options: GizmoOptions = {}, overlayScene?: THREE.Scene) {
    this.scene = scene;
    this.overlayScene = overlayScene ?? scene;
    this.camera = camera;
    this.renderer = renderer;

    // 创建Gizmo控制器
    this.gizmoController = new GizmoController(camera, renderer, options, this.overlayScene);
    
    // 设置回调
    this.gizmoController.setCallbacks({
      onChange: (event) => this.handleGizmoChange(event),
      onChangeStart: (event) => this.handleGizmoChangeStart(event),
      onChangeEnd: (event) => this.handleGizmoChangeEnd(event),
      onObjectChange: (event) => this.handleGizmoObjectChange(event)
    });

    // 附加到场景
    this.gizmoController.attachToScene(this.overlayScene);
    // 初始化 pivot（若传入自定义点则使用之，否则等待 target 设置时用 AABB 中心）
    if (options.pivot) this.gizmoController.setPivot(options.pivot.clone());
    if (options.pivotMode) this.gizmoController.setPivotMode(options.pivotMode);
  }

  /**
   * 设置目标对象
   */
  setTarget(object: THREE.Object3D | null): void {
    this.currentTarget = object;
    this.gizmoController.setTarget(object);
    // 默认根据 AABB 设置 pivot
    if (object && this.getPivotMode() === 'aabb') {
      this.useAabbCenterPivot();
    }
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Target set to:', object?.name || 'null');
    }
  }

  /**
   * 获取当前目标对象
   */
  getTarget(): THREE.Object3D | null {
    return this.currentTarget;
  }

  /**
   * 设置Gizmo模式
   */
  setMode(mode: GizmoMode): void {
    this.gizmoController.setMode(mode);
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Mode set to:', mode);
    }
  }

  /**
   * 获取当前模式
   */
  getMode(): GizmoMode {
    return this.gizmoController.getMode();
  }

  /**
   * 启用/禁用Gizmo
   */
  setEnabled(enabled: boolean): void {
    this.gizmoEnabled = enabled;
    this.gizmoController.setEnabled(enabled);
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Enabled:', enabled);
    }
  }

  /**
   * 是否启用
   */
  getEnabled(): boolean {
    return this.gizmoEnabled && this.gizmoController.getEnabled();
  }

  /**
   * 设置空间模式
   */
  setSpace(space: 'local' | 'world'): void {
    this.gizmoController.setSpace(space);
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log(`[GizmoManager] Space set to: ${space}`);
    }
  }

  /**
   * 获取当前空间模式
   */
  getSpace(): 'local' | 'world' {
    return this.gizmoController.getSpace();
  }

  /**
   * 设置大小
   */
  setSize(size: number): void {
    this.gizmoController.setSize(size);
  }

  // ===== Pivot APIs =====
  setPivotMode(mode: PivotMode): void {
    this.gizmoController.setPivotMode(mode);
  }

  getPivotMode(): PivotMode {
    return this.gizmoController.getPivotMode();
  }

  setPivot(worldPoint: THREE.Vector3): void {
    this.gizmoController.setPivot(worldPoint);
  }

  getPivot(): THREE.Vector3 {
    return this.gizmoController.getPivot();
  }

  useAabbCenterPivot(): void {
    const target = this.currentTarget;
    if (!target) return;
    // 优先从对象计算世界包围盒
    const box = new THREE.Box3().setFromObject(target);
    const center = new THREE.Vector3();
    box.getCenter(center);
    this.gizmoController.setPivot(center);
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Pivot set to AABB center:', center.toArray());
    }
  }

  /**
   * 设置回调
   */
  setCallbacks(callbacks: GizmoCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * 设置相机控制器（用于处理事件冲突）
   */
  setCameraControls(controls: any): void {
    this.cameraControls = controls;
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Camera controls set:', controls);
    }
  }
  
  /**
   * 获取相机控制器
   */
  getCameraControls(): any {
    return this.cameraControls;
  }

  /**
   * 确保获取到相机控制器（支持延迟初始化场景）
   */
  private resolveCameraControls(): any {
    if (this.cameraControls) {
      return this.cameraControls;
    }

    try {
      const globalTools = (globalThis as any)?.globalTools;
      const cameraController = globalTools?.cameraTools?.cameraController;
      if (cameraController) {
        this.cameraControls = cameraController;

        if ((globalThis as any).GS_DEBUG_FLAG) {
          console.log('[Gizmo] Camera controls resolved from globalTools:', cameraController);
        }
      }
    } catch (error) {
      if ((globalThis as any).GS_DEBUG_FLAG) {
        console.warn('[Gizmo] Failed to resolve camera controls automatically:', error);
      }
    }

    return this.cameraControls;
  }

  /**
   * 处理Gizmo变化事件
   */
  private handleGizmoChange(event: GizmoEvent): void {
    if (this.callbacks.onChange) {
      this.callbacks.onChange(event);
    }
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Change:', event);
    }
  }

  /**
   * 处理Gizmo开始变化事件
   */
  private handleGizmoChangeStart(event: GizmoEvent): void {
    // 禁用相机控制器以避免事件冲突
    const controls = this.resolveCameraControls();
    if (controls) {
      // 尝试使用 setEnabled 方法（CameraController）
      if (typeof controls.setEnabled === 'function') {
        controls.setEnabled(false);
      } else if (typeof controls.enabled !== 'undefined') {
        // 兼容 OrbitControls 等直接有 enabled 属性的控制器
        controls.enabled = false;
      }
      
      if ((globalThis as any).GS_DEBUG_FLAG) {
        console.log('[Gizmo] Camera controls disabled during transform');
      }
    }
    
    if (this.callbacks.onChangeStart) {
      this.callbacks.onChangeStart(event);
    }
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Change start:', event);
    }
  }

  /**
   * 处理Gizmo结束变化事件
   */
  private handleGizmoChangeEnd(event: GizmoEvent): void {
    // 重新启用相机控制器
    const controls = this.resolveCameraControls();
    if (controls) {
      // 尝试使用 setEnabled 方法（CameraController）
      if (typeof controls.setEnabled === 'function') {
        controls.setEnabled(true);
      } else if (typeof controls.enabled !== 'undefined') {
        // 兼容 OrbitControls 等直接有 enabled 属性的控制器
        controls.enabled = true;
      }
      
      if ((globalThis as any).GS_DEBUG_FLAG) {
        console.log('[Gizmo] Camera controls re-enabled after transform');
      }
    }
    
    if (this.callbacks.onChangeEnd) {
      this.callbacks.onChangeEnd(event);
    }
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Change end:', event);
    }
  }

  /**
   * 处理Gizmo对象变化事件
   */
  private handleGizmoObjectChange(event: GizmoEvent): void {
    if (this.callbacks.onObjectChange) {
      this.callbacks.onObjectChange(event);
    }
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Object change:', event);
    }
  }

  /**
   * 更新（在渲染循环中调用）
   */
  update(): void {
    this.gizmoController.update();
  }

  /**
   * 处理窗口大小调整
   */
  onResize(): void {
    // TransformControls会自动处理大小调整
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log('[Gizmo] Resize handled');
    }
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.gizmoController.detachFromScene(this.overlayScene);
    this.gizmoController.dispose();
    this.currentTarget = null;
    this.callbacks = {};
  }

  /**
   * 获取Gizmo控制器实例（用于高级操作）
   */
  getGizmoController(): GizmoController {
    return this.gizmoController;
  }

  /**
   * 获取TransformControls实例（用于直接操作）
   */
  getTransformControls(): any {
    return this.gizmoController.getTransformControls();
  }
}
