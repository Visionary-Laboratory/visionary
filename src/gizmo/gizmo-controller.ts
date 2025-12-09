/**
 * Gizmo Controller - 基于Three.js TransformControls的Gizmo控制器
 */
import * as THREE from "three/webgpu";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GizmoOptions, GizmoMode, GizmoEvent, GizmoCallbacks, PivotMode } from './types';

export class GizmoController {
  private transformControls: TransformControls;
  private camera: THREE.Camera;
  private renderer: THREE.WebGPURenderer;
  private overlayScene: THREE.Scene | null;
  private currentObject: THREE.Object3D | null = null;
  private pivotProxy: THREE.Object3D | null = null; // 辅助对象，用于显示 Gizmo 在 pivot 位置
  private callbacks: GizmoCallbacks = {};
  private options: Required<GizmoOptions>;
  // Pivot support
  private pivotMode: PivotMode = 'aabb';
  private pivotWorld: THREE.Vector3 = new THREE.Vector3();
  private pivotHelper: THREE.Object3D | null = null;
  private isDragging: boolean = false;
  private lastPivotWorld: THREE.Vector3 = new THREE.Vector3(); // 用于检测 pivot 是否改变
  private changeStartSnapshot: {
    objPosW: THREE.Vector3;
    objQuatW: THREE.Quaternion;
    objScaleW: THREE.Vector3;
    pivotProxyPosW: THREE.Vector3;
    pivotProxyQuatW: THREE.Quaternion;
    pivotProxyScaleW: THREE.Vector3;
    parentInvMatrix: THREE.Matrix4;
  } | null = null;

  constructor(camera: THREE.Camera, renderer: THREE.WebGPURenderer, options: GizmoOptions = {}, overlayScene?: THREE.Scene) {
    this.camera = camera;
    this.renderer = renderer;
    this.overlayScene = overlayScene ?? null;
    
    // 默认选项
    this.options = {
      mode: 'translate',
      showX: true,
      showY: true,
      showZ: true,
      space: 'local',
      snap: false,
      translationSnap: 1,
      rotationSnap: Math.PI / 4,
      scaleSnap: 0.1,
      showHelper: true,
      size: 1,
      colors: {
        x: '#ff0000',
        y: '#00ff00',
        z: '#0000ff'
      },
      pivotMode: 'aabb',
      pivot: undefined as any,
      showPivotHelper: true,
      ...options
    };
    if (this.options.pivot) this.pivotWorld.copy(this.options.pivot);

    // 创建TransformControls
    this.transformControls = new TransformControls(camera, renderer.domElement);
    this.setupTransformControls();
    this.setupEventListeners();
    // 创建 pivot 代理对象
    this.pivotProxy = new THREE.Object3D();
    this.pivotProxy.name = 'VisionaryPivotProxy';
    this.pivotProxy.userData = this.pivotProxy.userData || {};
    this.pivotProxy.userData.__visionaryEditorHelper = true;
  }

  /**
   * 设置TransformControls
   */
  private setupTransformControls(): void {
    const controls = this.transformControls;
    
    // 应用选项
    type TransformControlsMode = 'translate' | 'rotate' | 'scale';
    const mapMode = (mode: GizmoMode): TransformControlsMode => (mode === 'normal' ? 'translate' : mode);

    controls.setMode(mapMode(this.options.mode));
    controls.setSpace(this.options.space);
    controls.setSize(this.options.size);
    controls.showX = this.options.showX;
    controls.showY = this.options.showY;
    controls.showZ = this.options.showZ;
    
    // 设置吸附
    if (this.options.snap) {
      controls.translationSnap = this.options.translationSnap;
      controls.rotationSnap = this.options.rotationSnap;
      controls.scaleSnap = this.options.scaleSnap;
    }

    // 设置颜色（TransformControls可能不支持这些方法，暂时注释）
    // if (this.options.colors.x) controls.setXAxisColor(this.options.colors.x);
    // if (this.options.colors.y) controls.setYAxisColor(this.options.colors.y);
    // if (this.options.colors.z) controls.setZAxisColor(this.options.colors.z);
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    const controls = this.transformControls;

    controls.addEventListener('change', () => {
      if (this.currentObject) {
        // 将变换从 pivotProxy 同步到目标对象
        this.syncTransformFromProxyToTarget();
        if (this.callbacks.onChange) {
          this.callbacks.onChange(this.createEvent('change'));
        }
      }
    });

    controls.addEventListener('dragging-changed', (event) => {
      if (this.currentObject) {
        this.isDragging = (event.value as boolean);
        if (event.value) {
          // 开始拖拽，记录快照
          this.snapshotChangeStart();
          if (this.callbacks.onChangeStart) this.callbacks.onChangeStart(this.createEvent('changeStart'));
        } else {
          // 结束拖拽
          if (this.callbacks.onChangeEnd) this.callbacks.onChangeEnd(this.createEvent('changeEnd'));
          // 重置 proxy 的位置、旋转和缩放，准备下次拖拽（旋转/缩放模式）
          if (this.options.mode !== 'translate') {
            this.updatePivotProxyTransform();
          }
          // 清理快照
          this.changeStartSnapshot = null;
        }
      }
    });

    controls.addEventListener('objectChange', () => {
      if (this.currentObject) {
        this.syncTransformFromProxyToTarget();
        if (this.callbacks.onObjectChange) {
          this.callbacks.onObjectChange(this.createEvent('objectChange'));
        }
      }
    });
  }

  /**
   * 创建事件对象
   */
  private createEvent(type: GizmoEvent['type']): GizmoEvent {
    if (!this.currentObject) {
      throw new Error('No current object set');
    }

    return {
      type,
      target: this.currentObject,
      mode: this.options.mode,
      translation: this.currentObject.position.clone(),
      rotation: this.currentObject.rotation.clone(),
      scale: this.currentObject.scale.clone(),
      pivot: this.pivotWorld.clone()
    };
  }

  /**
   * 附加到场景
   */
  attachToScene(scene: THREE.Scene): void {
    this.overlayScene = scene;
    const helper = this.transformControls.getHelper();
    helper.name = helper.name || 'VisionaryTransformControls';
    helper.userData = helper.userData || {};
    helper.userData.__visionaryEditorHelper = true;
    scene.add(helper);
    helper.traverse((obj: any) => {
      if (obj && obj.isObject3D) {
        obj.renderOrder = 9999;
        const material = (obj as any).material;
        if (material) {
          const mats = Array.isArray(material) ? material : [material];
          mats.forEach((mat: any) => {
            if (mat && mat.isMaterial) {
              mat.depthTest = false;
              mat.depthWrite = false;
              mat.transparent = true;
            }
          });
        }
      }
    });
    if (this.pivotProxy && !this.pivotProxy.parent) {
      scene.add(this.pivotProxy);
    }
    if (this.options.showPivotHelper) {
      this.ensurePivotHelper(scene);
    }
  }

  /**
   * 从场景移除
   */
  detachFromScene(scene: THREE.Scene): void {
    scene.remove(this.transformControls.getHelper());
    if (this.pivotProxy && this.pivotProxy.parent === scene) {
      scene.remove(this.pivotProxy);
    }
    if (this.pivotHelper && this.pivotHelper.parent === scene) {
      scene.remove(this.pivotHelper);
    }
  }

  /**
   * 设置目标对象
   */
  setTarget(object: THREE.Object3D | null): void {
    this.currentObject = object;
    if (object) {
      // 将 pivotProxy 添加到 overlay 场景（如果还没有）
      if (this.pivotProxy) {
        const targetScene = this.overlayScene ?? object.parent ?? (object as any).scene ?? null;
        if (targetScene && this.pivotProxy.parent !== targetScene) {
          this.pivotProxy.parent?.remove(this.pivotProxy);
          targetScene.add(this.pivotProxy);
        }
      }
      // 让 TransformControls attach 到 pivotProxy，而不是目标对象
      if (this.pivotProxy) {
        this.transformControls.attach(this.pivotProxy);
        this.updatePivotProxyTransform();
      }
      // 当目标变更时，如果使用 AABB 模式，需在上层设定 pivot；这里保持现有 pivot 值，仅更新 helper 位置
      this.updatePivotHelper();
    } else {
      this.transformControls.detach();
    }
  }

  /**
   * 获取当前目标对象
   */
  getTarget(): THREE.Object3D | null {
    return this.currentObject;
  }

  /**
   * 设置模式
   */
  setMode(mode: GizmoMode): void {
    this.options.mode = mode;
    type TransformControlsMode = 'translate' | 'rotate' | 'scale';
    const mapped: TransformControlsMode = mode === 'normal' ? 'translate' : mode;
    this.transformControls.setMode(mapped);
  }

  /**
   * 获取当前模式
   */
  getMode(): GizmoMode {
    return this.options.mode;
  }

  /**
   * 设置空间
   */
  setSpace(space: 'local' | 'world'): void {
    this.options.space = space;
    this.transformControls.setSpace(space);
    if (!this.isDragging) {
      this.updatePivotProxyTransform();
    }
    
    if ((globalThis as any).GS_DEBUG_FLAG) {
      console.log(`[GizmoController] Space set to: ${space}`);
      console.log(`[GizmoController] TransformControls.space: ${this.transformControls.space}`);
    }
  }

  /**
   * 获取当前空间模式
   */
  getSpace(): 'local' | 'world' {
    return this.options.space;
  }

  /**
   * 设置大小
   */
  setSize(size: number): void {
    this.options.size = size;
    this.transformControls.setSize(size);
  }

  /**
   * 启用/禁用
   */
  setEnabled(enabled: boolean): void {
    this.transformControls.enabled = enabled;
  }

  /**
   * 是否启用
   */
  getEnabled(): boolean {
    return this.transformControls.enabled;
  }

  /**
   * 设置回调
   */
  setCallbacks(callbacks: GizmoCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * 更新（在渲染循环中调用）
   */
  update(): void {
    // TransformControls会自动更新，这里可以添加额外的更新逻辑
    // 只在 pivot 改变时更新 proxy 位置（避免干扰 TransformControls）
    if (!this.pivotWorld.equals(this.lastPivotWorld)) {
      if (!this.isDragging) {
        this.updatePivotProxyTransform();
      }
      this.lastPivotWorld.copy(this.pivotWorld);
    }
    this.updatePivotHelper();
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.transformControls.dispose();
    this.currentObject = null;
    this.callbacks = {};
  }

  /**
   * 获取TransformControls实例（用于高级操作）
   */
  getTransformControls(): TransformControls {
    return this.transformControls;
  }

  // ===== Pivot APIs =====
  setPivotMode(mode: PivotMode): void {
    this.pivotMode = mode;
  }

  getPivotMode(): PivotMode {
    return this.pivotMode;
  }

  setPivot(worldPoint: THREE.Vector3): void {
    this.pivotWorld.copy(worldPoint);
    this.updatePivotProxyTransform();
    this.updatePivotHelper();
    // 更新 lastPivotWorld，避免 update() 重复更新
    this.lastPivotWorld.copy(worldPoint);
  }

  getPivot(): THREE.Vector3 {
    return this.pivotWorld.clone();
  }

  // ===== Internals =====
  private snapshotChangeStart(): void {
    if (!this.currentObject || !this.pivotProxy) return;
    const obj = this.currentObject;
    const proxy = this.pivotProxy;
    
    obj.updateWorldMatrix(true, false);
    proxy.updateWorldMatrix(true, false);
    
    const objWorldMatrix = obj.matrixWorld.clone();
    const proxyWorldMatrix = proxy.matrixWorld.clone();
    
    const objPos = new THREE.Vector3();
    const objQuat = new THREE.Quaternion();
    const objScl = new THREE.Vector3();
    objWorldMatrix.decompose(objPos, objQuat, objScl);
    
    const proxyPos = new THREE.Vector3();
    const proxyQuat = new THREE.Quaternion();
    const proxyScl = new THREE.Vector3();
    proxyWorldMatrix.decompose(proxyPos, proxyQuat, proxyScl);
    
    const parentInv = new THREE.Matrix4();
    if (obj.parent) {
      const parentWorld = obj.parent.matrixWorld.clone();
      parentInv.copy(parentWorld).invert();
    } else {
      parentInv.identity();
    }
    
    this.changeStartSnapshot = {
      objPosW: objPos.clone(),
      objQuatW: objQuat.clone(),
      objScaleW: objScl.clone(),
      pivotProxyPosW: proxyPos.clone(),
      pivotProxyQuatW: proxyQuat.clone(),
      pivotProxyScaleW: proxyScl.clone(),
      parentInvMatrix: parentInv
    };
  }

  // ===== Transform sync =====
  private updatePivotProxyTransform(): void {
    if (!this.pivotProxy) return;
    const proxy = this.pivotProxy;
    const target = this.currentObject;

    const pivotRotation = new THREE.Quaternion();
    if (this.options.space === 'local' && target) {
      target.updateWorldMatrix(true, false);
      const decomposedPos = new THREE.Vector3();
      const decomposedScale = new THREE.Vector3();
      target.matrixWorld.decompose(decomposedPos, pivotRotation, decomposedScale);
    } else {
      pivotRotation.identity();
    }

    const worldMatrix = new THREE.Matrix4().compose(
      this.pivotWorld,
      pivotRotation,
      new THREE.Vector3(1, 1, 1)
    );

    if (proxy.parent) {
      proxy.parent.updateMatrixWorld();
      const parentWorldInv = new THREE.Matrix4().copy(proxy.parent.matrixWorld).invert();
      worldMatrix.premultiply(parentWorldInv);
    }

    const decomposedPos = new THREE.Vector3();
    const decomposedQuat = new THREE.Quaternion();
    const decomposedScale = new THREE.Vector3();
    worldMatrix.decompose(decomposedPos, decomposedQuat, decomposedScale);

    proxy.position.copy(decomposedPos);
    proxy.quaternion.copy(decomposedQuat);
    proxy.scale.set(1, 1, 1);
  }

  private syncTransformFromProxyToTarget(): void {
    if (!this.currentObject || !this.pivotProxy || !this.changeStartSnapshot) return;
    const obj = this.currentObject;
    const proxy = this.pivotProxy;
    const { objPosW: startObjPos, objQuatW: startObjQuat, objScaleW: startObjScale, pivotProxyPosW: startProxyPos, pivotProxyQuatW: startProxyQuat, pivotProxyScaleW: startProxyScale, parentInvMatrix } = this.changeStartSnapshot;

    // 获取 proxy 的当前世界变换
    proxy.updateWorldMatrix(true, false);
    const proxyWorldMatrix = proxy.matrixWorld.clone();
    const curProxyPos = new THREE.Vector3();
    const curProxyQuat = new THREE.Quaternion();
    const curProxyScale = new THREE.Vector3();
    proxyWorldMatrix.decompose(curProxyPos, curProxyQuat, curProxyScale);

    if (this.options.mode === 'translate') {
      // 平移：计算 proxy 的位置变化，应用到目标对象
      const deltaPos = new THREE.Vector3().subVectors(curProxyPos, startProxyPos);
      const newObjWorldPos = new THREE.Vector3().addVectors(startObjPos, deltaPos);
      // 转换到本地坐标
      const newLocalPos = new THREE.Vector3().copy(newObjWorldPos).applyMatrix4(parentInvMatrix);
      obj.position.copy(newLocalPos);
      // 更新 pivot 位置（平移时 pivot 跟随移动）
      this.pivotWorld.copy(curProxyPos);
      // 注意：不在 change 事件中重置 proxy，让 TransformControls 继续工作
    } else if (this.options.mode === 'rotate') {
      // 旋转：计算 proxy 的旋转增量
      const deltaQuat = new THREE.Quaternion().multiplyQuaternions(curProxyQuat, startProxyQuat.clone().invert());
      // 计算目标对象相对于 pivot 的向量
      const deltaFromPivot = new THREE.Vector3().subVectors(startObjPos, startProxyPos);
      // 应用旋转到相对向量
      const rotatedDelta = deltaFromPivot.clone().applyQuaternion(deltaQuat);
      // 计算新世界位置
      const newObjWorldPos = new THREE.Vector3().addVectors(curProxyPos, rotatedDelta);
      // 转换到本地坐标
      const newLocalPos = new THREE.Vector3().copy(newObjWorldPos).applyMatrix4(parentInvMatrix);
      obj.position.copy(newLocalPos);
      // 应用旋转
      obj.quaternion.multiplyQuaternions(deltaQuat, startObjQuat);
      // 注意：不在 change 事件中重置 proxy，让 TransformControls 继续工作
    } else if (this.options.mode === 'scale') {
      // 缩放：计算 proxy 的缩放增量
      const deltaScale = new THREE.Vector3(
        curProxyScale.x / (startProxyScale.x || 1),
        curProxyScale.y / (startProxyScale.y || 1),
        curProxyScale.z / (startProxyScale.z || 1)
      );
      // 计算目标对象相对于 pivot 的向量
      const deltaFromPivot = new THREE.Vector3().subVectors(startObjPos, startProxyPos);
      // 应用缩放到相对向量
      const scaledDelta = deltaFromPivot.clone().multiply(deltaScale);
      // 计算新世界位置
      const newObjWorldPos = new THREE.Vector3().addVectors(curProxyPos, scaledDelta);
      // 转换到本地坐标
      const newLocalPos = new THREE.Vector3().copy(newObjWorldPos).applyMatrix4(parentInvMatrix);
      obj.position.copy(newLocalPos);
      // 应用缩放
      obj.scale.multiplyVectors(startObjScale, deltaScale);
      // 注意：不在 change 事件中重置 proxy，让 TransformControls 继续工作
    }
  }

  private ensurePivotHelper(scene: THREE.Scene): void {
    if (this.pivotHelper) {
      this.pivotHelper.userData = this.pivotHelper.userData || {};
      this.pivotHelper.userData.__visionaryEditorHelper = true;
      this.pivotHelper.name = this.pivotHelper.name || 'VisionaryPivotHelper';
      if (!scene.children.includes(this.pivotHelper)) scene.add(this.pivotHelper);
      this.pivotHelper.renderOrder = 9999;
      const material = (this.pivotHelper as any).material;
      if (material) {
        const mats = Array.isArray(material) ? material : [material];
        mats.forEach((mat: any) => {
          if (mat && mat.isMaterial) {
            mat.depthTest = false;
            mat.depthWrite = false;
            mat.transparent = true;
          }
        });
      }
      return;
    }
    const helper = new THREE.AxesHelper(0.3 * (this.options.size || 1));
    helper.matrixAutoUpdate = true;
    helper.name = 'VisionaryPivotHelper';
    helper.userData = helper.userData || {};
    helper.userData.__visionaryEditorHelper = true;
    helper.renderOrder = 9999;
    const material = (helper as any).material;
    if (material) {
      const mats = Array.isArray(material) ? material : [material];
      mats.forEach((mat: any) => {
        if (mat && mat.isMaterial) {
          mat.depthTest = false;
          mat.depthWrite = false;
          mat.transparent = true;
        }
      });
    }
    this.pivotHelper = helper;
    scene.add(helper);
    this.updatePivotHelper();
  }

  private updatePivotHelper(): void {
    if (!this.pivotHelper) return;
    this.pivotHelper.position.copy(this.pivotWorld);
    this.pivotHelper.visible = !!this.options.showPivotHelper;
  }
}
