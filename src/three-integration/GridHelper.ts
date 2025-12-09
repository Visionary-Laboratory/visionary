import * as THREE from "three/webgpu";

/**
 * Unity风格的无限网格辅助工具
 * 使用Three.js GridHelper实现动态LOD和无限延伸的网格
 */
export class GridHelper {
    private grid: THREE.GridHelper;
    private visible: boolean = true;
    private camera: THREE.Camera | null = null;
    
    // 网格参数
    private baseSize: number = 10;
    private baseDivisions: number = 10;
    private colorCenterLine: number = 0x444444;
    private colorGrid: number = 0x888888;
    private opacity: number = 0.8;
    
    // 动态LOD参数
    private minSize: number = 1;
    private maxSize: number = 100;
    private fadeDistance: number = 50;

    constructor(
        size: number = 10,
        divisions: number = 10,
        colorCenterLine: number = 0x444444,
        colorGrid: number = 0x888888
    ) {
        this.baseSize = size;
        this.baseDivisions = divisions;
        this.colorCenterLine = colorCenterLine;
        this.colorGrid = colorGrid;
        
        // 创建超大的网格(万米级别)来模拟无限网格
        const infiniteSize = 100000; // 100公里 x 100公里
        const baseDivisions = 4000; // 基础细分数量
        
        this.grid = new THREE.GridHelper(infiniteSize, baseDivisions, this.colorCenterLine, this.colorGrid);
        this.grid.position.y = 0;
        this.grid.name = "InfiniteGridHelper";
        
        // 设置透明度
        this.setOpacity(this.opacity);
        
        // 修复中心线粗细问题 - 通过修改材质
        this.fixCenterLineThickness();
    }

    /**
     * 更新相机位置(需要在渲染循环中调用)
     * @param camera Three.js相机
     */
    public updateCamera(camera: THREE.Camera): void {
        this.camera = camera;
        
        if (!this.visible) return;
        
        // 获取相机位置
        const cameraPosition = new THREE.Vector3();
        camera.getWorldPosition(cameraPosition);
        
        // 计算相机高度
        const cameraHeight = Math.abs(cameraPosition.y);
        
        // 获取FOV (如果是PerspectiveCamera)
        let fov = 75; // 默认FOV
        if (camera instanceof THREE.PerspectiveCamera) {
            fov = camera.fov;
        }
        
        // 计算FOV对网格密度的影响
        // FOV越大(视野越宽),网格应该越稀疏; FOV越小(视野越窄),网格应该越密集
        const fovFactor = fov / 75; // 75度作为基准FOV
        
        // 根据相机高度计算基础密度 - 阶梯式跳变
        // 1倍、5倍、10倍、20倍、40倍、80倍地跳变
        let baseDensityMultiplier = 1.0;
        
        if (cameraHeight < 0.5) {
            // 极近距离: 1/80倍密度（小值=密集）
            baseDensityMultiplier = 1.0 / 80.0;
        } else if (cameraHeight < 1.0) {
            // 超近距离: 1/40倍密度
            baseDensityMultiplier = 1.0 / 40.0;
        } else if (cameraHeight < 2.0) {
            // 很近距离: 1/20倍密度
            baseDensityMultiplier = 1.0 / 20.0;
        } else if (cameraHeight < 4.0) {
            // 近距离: 1/10倍密度
            baseDensityMultiplier = 1.0 / 10.0;
        } else if (cameraHeight < 8.0) {
            // 中近距离: 1/5倍密度
            baseDensityMultiplier = 1.0 / 5.0;
        } else {
            // 中远距离及以上: 1倍密度
            baseDensityMultiplier = 1.0;
        }
        
        const finalDensityMultiplier = baseDensityMultiplier * fovFactor;
        const clampedDensity = Math.max(0.001, Math.min(100.0, finalDensityMultiplier));
        this.grid.scale.setScalar(clampedDensity);
        
        const distanceFactor = Math.min(1.0, cameraHeight / this.fadeDistance);
        const alpha = Math.max(0.1, 1.0 - distanceFactor * 0.5);
        this.setOpacity(alpha);
    }

    /**
     * 显示网格
     */
    public show(): void {
        this.visible = true;
        this.grid.visible = true;
    }

    /**
     * 隐藏网格
     */
    public hide(): void {
        this.visible = false;
        this.grid.visible = false;
    }

    /**
     * 切换网格显示状态
     */
    public toggle(): void {
        this.visible = !this.visible;
        this.grid.visible = this.visible;
    }

    /**
     * 设置网格可见性
     * @param visible 是否可见
     */
    public setVisible(visible: boolean): void {
        this.visible = visible;
        this.grid.visible = visible;
    }

    /**
     * 获取网格可见性状态
     * @returns 是否可见
     */
    public isVisible(): boolean {
        return this.visible;
    }

    /**
     * 获取Three.js网格对象
     * @returns THREE.GridHelper对象
     */
    public getGrid(): THREE.GridHelper {
        return this.grid;
    }

    /**
     * 设置网格缩放
     * @param scale 缩放值
     */
    public setGridScale(scale: number): void {
        this.grid.scale.setScalar(scale);
    }

    /**
     * 设置淡出距离
     * @param distance 淡出距离
     */
    public setFadeDistance(distance: number): void {
        this.fadeDistance = distance;
    }

    /**
     * 设置网格密度范围
     * @param minSize 最小密度倍数(近距离)
     * @param maxSize 最大密度倍数(远距离)
     */
    public setGridSizeRange(minSize: number, maxSize: number): void {
        this.minSize = minSize;
        this.maxSize = maxSize;
    }

    /**
     * 设置网格颜色
     * @param color 网格线颜色
     */
    public setGridColor(color: THREE.Color): void {
        this.colorGrid = color.getHex();
        this.updateGrid();
    }

    /**
     * 设置中心线颜色
     * @param color 中心线颜色
     */
    public setCenterLineColor(color: THREE.Color): void {
        this.colorCenterLine = color.getHex();
        this.updateGrid();
    }

    /**
     * 设置透明度
     * @param opacity 透明度 (0-1)
     */
    public setOpacity(opacity: number): void {
        this.opacity = Math.max(0, Math.min(1, opacity));
        this.grid.material.opacity = this.opacity;
    }
    
    /**
     * 修复中心线粗细问题
     */
    private fixCenterLineThickness(): void {
        // GridHelper使用LineSegments,有两个材质: 中心线和网格线
        if (this.grid.material instanceof THREE.LineBasicMaterial) {
            // 单个材质的情况
            (this.grid.material as any).linewidth = 2;
        } else if (Array.isArray(this.grid.material)) {
            // 多个材质的情况 - 第一个是中心线,第二个是网格线
            const material0 = this.grid.material[0] as any;
            const material1 = this.grid.material[1] as any;
            
            if (material0 && material0.linewidth !== undefined) {
                material0.linewidth = 3; // 中心线更粗
            }
            if (material1 && material1.linewidth !== undefined) {
                material1.linewidth = 1; // 网格线保持细
            }
        }
    }
    
    /**
     * 更新网格(重新创建以应用颜色变化)
     */
    private updateGrid(): void {
        const oldGrid = this.grid;
        
        // 重新创建万米级别的无限网格
        const infiniteSize = 100000; // 100公里 x 100公里
        const baseDivisions = 1000; // 基础细分数量
        
        this.grid = new THREE.GridHelper(infiniteSize, baseDivisions, this.colorCenterLine, this.colorGrid);
        this.grid.position.y = 0;
        this.grid.name = "InfiniteGridHelper";
        this.grid.visible = this.visible;
        this.grid.material.opacity = this.opacity;
        
        // 修复中心线粗细
        this.fixCenterLineThickness();
        
        // 如果网格已添加到场景中,需要替换
        if (oldGrid.parent) {
            oldGrid.parent.add(this.grid);
            oldGrid.parent.remove(oldGrid);
        }
    }

    /**
     * 设置网格位置
     * @param x X坐标
     * @param y Y坐标
     * @param z Z坐标
     */
    public setPosition(x: number, y: number, z: number): void {
        this.grid.position.set(x, y, z);
    }

    /**
     * 设置网格旋转
     * @param x X轴旋转角度(弧度)
     * @param y Y轴旋转角度(弧度)
     * @param z Z轴旋转角度(弧度)
     */
    public setRotation(x: number, y: number, z: number): void {
        this.grid.rotation.set(x, y, z);
    }

    /**
     * 销毁网格对象
     */
    public dispose(): void {
        if (this.grid.parent) {
            this.grid.parent.remove(this.grid);
        }
        this.grid.dispose();
    }
}
