// Universal loader with format detection and loader registry

import { DataSource, ILoader, LoaderRegistry, LoadingOptions } from './index';
import { PLYLoader } from './ply_loader';
import { createThreeJSAdapters } from './threejs_adapters';

// 导入新的 Gaussian 格式加载器
import { SPZLoader } from './spz_loader';
import { KSplatLoader } from './ksplat_loader';
import { SplatLoader } from './splat_loader';
import { SOGLoader } from './sog_loader';
import { CompressedPLYLoader } from './compressed_ply_loader';

/**
 * Loader type classification
 */
export enum LoaderType {
  GAUSSIAN = 'gaussian',
  THREE = 'three'
}

/**
 * Universal loader that automatically detects file formats and delegates to appropriate loaders
 */
export class UniversalLoader implements ILoader, LoaderRegistry {
  private gaussianLoaders = new Map<string, ILoader>();
  private threeLoaders = new Map<string, ILoader>();
  
  constructor() {
    // ========== Register Gaussian Splatting loaders ==========
    this.register(new PLYLoader(), ['.ply'], LoaderType.GAUSSIAN);
    this.register(new SPZLoader(), ['.spz'], LoaderType.GAUSSIAN);
    this.register(new KSplatLoader(), ['.ksplat'], LoaderType.GAUSSIAN);
    this.register(new SplatLoader(), ['.splat'], LoaderType.GAUSSIAN);
    this.register(new SOGLoader(), ['.sog'], LoaderType.GAUSSIAN);
    this.register(new CompressedPLYLoader(), ['.compressed.ply'], LoaderType.GAUSSIAN);
    
    // ========== Register Three.js model loaders ==========
    const threeJSAdapters = createThreeJSAdapters();
    threeJSAdapters.forEach(adapter => {
      const extensions = adapter.getSupportedExtensions();
      // Three.js的PLY加载器注册到threeLoaders，但不会覆盖Gaussian的PLY加载器
      this.register(adapter, extensions, LoaderType.THREE);
    });
  }
  
  /**
   * Register a loader for specific file extensions
   * @param loader - The loader instance
   * @param extensions - Array of file extensions (e.g., ['.ply', '.glb'])
   * @param type - Loader type: GAUSSIAN or THREE
   */
  register<T extends DataSource>(loader: ILoader<T>, extensions: string[], type: LoaderType = LoaderType.THREE): void {
    const targetMap = type === LoaderType.GAUSSIAN ? this.gaussianLoaders : this.threeLoaders;
    for (const ext of extensions) {
      targetMap.set(ext.toLowerCase(), loader);
    }
  }
  
  /**
   * 核心决策方法：根据文件名和配置获取 Loader
   * 这里是唯一处理 "后缀名 -> Loader" 映射逻辑的地方
   */
  getLoader(filename: string, mimeType?: string, options?: { isGaussian?: boolean }): ILoader | null {
    const lowerName = filename.toLowerCase();
    const ext = this.getFileExtension(lowerName);

    // 1. 特殊优先处理 .compressed.ply (它一定是高斯)
    if (lowerName.endsWith('.compressed.ply')) {
      return this.gaussianLoaders.get('.compressed.ply') || null;
    }

    // 2. 核心路由逻辑：根据 isGaussian 决定查表的优先级
    const isExplicitGaussian = options?.isGaussian === true;
    const isExplicitMesh = options?.isGaussian === false;

    // 如果明确是非高斯模型 (比如检测到了 Mesh PLY)
    if (isExplicitMesh) {
      return this.threeLoaders.get(ext) || null;
    }

    // 如果明确是高斯模型，或者没有明确指定（默认优先尝试高斯表）
    // 注意：这里的 ext 如果是 .ply，会优先拿到 GaussianPLYLoader
    let loader = this.gaussianLoaders.get(ext);
    if (loader) return loader;

    // 3. 如果高斯表里没有（比如 .glb, .fbx），或者上面没命中，查 Three 表
    loader = this.threeLoaders.get(ext);
    if (loader) return loader;

    // 4. 最后的兜底：遍历 canHandle (处理无法通过后缀判断的情况)
    // 只有在没指定 "isGaussian=false" 的情况下才查高斯
    if (!isExplicitMesh) {
      for (const [, loader] of this.gaussianLoaders) {
        if (loader.canHandle(filename, mimeType)) return loader;
      }
    }

    for (const [, loader] of this.threeLoaders) {
      if (loader.canHandle(filename, mimeType)) return loader;
    }

    return null;
  }
  
  /**
   * 辅助方法：对外暴露的异步 Loader 获取 (为了兼容性)
   * 实际上就是 loadFile 逻辑的前半部分
   */
  async getLoaderForFile(file: File, mimeType?: string): Promise<ILoader | null> {
    // 模拟检测逻辑
    let isGaussian: boolean | undefined = undefined;
    if (file.name.toLowerCase().endsWith('.ply')) {
        isGaussian = await this.is3dgsPly(file);
    }
    return this.getLoader(file.name, mimeType, { isGaussian });
  }
  
  /**
   * Get all supported extensions
   */
  getAllSupportedExtensions(): string[] {
    const extensions = new Set<string>();
    for (const ext of this.gaussianLoaders.keys()) {
      extensions.add(ext);
    }
    for (const ext of this.threeLoaders.keys()) {
      extensions.add(ext);
    }
    return Array.from(extensions);
  }
  
  /**
   * 文件加载入口
   * 负责处理 "文件内容检测" 这一异步步骤，然后委托给 getLoader
   */
  async loadFile(file: File, options: LoadingOptions = {}): Promise<DataSource> {
    // 1. 智能检测步骤
    // 如果 options 里没传 isGaussian，且是 .ply，我们需要先读文件头判断
    if (options.isGaussian === undefined && file.name.toLowerCase().endsWith('.ply')) {
       // 注意：这里不判断 .compressed.ply，因为它在 getLoader 里有优先权
       const is3DGS = await this.is3dgsPly(file);
       options.isGaussian = is3DGS; // 更新 options，传给下游
    }

    // 2. 决策步骤
    const loader = this.getLoader(file.name, file.type, options);
    
    if (!loader) {
      throw new Error(`Unsupported file format: ${file.name}`);
    }

    // 3. 执行步骤
    return loader.loadFile(file, options);
  }
  
  /**
   * URL 加载入口
   */
  async loadUrl(url: string, options: LoadingOptions = {}): Promise<DataSource> {
    // URL 加载依赖外部传入 options.isGaussian
    // 这里直接调用 getLoader
    const loader = this.getLoader(url, undefined, options);
    
    if (!loader) {
      throw new Error(`Unsupported file format for URL: ${url}`);
    }

    return loader.loadUrl(url, options);
  }
  
  /**
   * Load from buffer - requires explicit format detection
   */
  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<DataSource> {
    // Try to detect format from buffer content
    const loader = this.detectFormatFromBuffer(buffer);
    if (!loader) {
      throw new Error('Unable to detect file format from buffer');
    }
    
    return loader.loadBuffer(buffer, options);
  }
  
  /**
   * Check if any registered loader can handle this file
   */
  canHandle(filename: string, mimeType?: string, options?: { isGaussian?: boolean }): boolean {
    return this.getLoader(filename, mimeType, options) !== null;
  }
  
  /**
   * Get supported extensions (aggregated from all loaders)
   */
  getSupportedExtensions(): string[] {
    return this.getAllSupportedExtensions();
  }
  
  // ========== Private Helpers ==========
  
  /**
   * Extract file extension from filename
   */
  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
  }
  
  /**
   * Attempt to detect file format from buffer content
   * 通过文件头魔数检测格式
   */
  private detectFormatFromBuffer(buffer: ArrayBuffer): ILoader | null {
    const view = new DataView(buffer);
    const header = new TextDecoder().decode(buffer.slice(0, 100));
    
    // Check for PLY magic header (text: "ply")
    if (header.startsWith('ply\n') || header.startsWith('ply\r\n')) {
      // 检测是否是 3DGS PLY 文件
      const is3DGS = this.is3dgsPlyFromHeader(header);
      if (is3DGS) {
        return this.gaussianLoaders.get('.ply') || null;
      } else {
        return this.threeLoaders.get('.ply') || null;
      }
    }
    
    // Check for GZIP magic (0x1f8b)
    if (buffer.byteLength >= 2) {
      const byte1 = view.getUint8(0);
      const byte2 = view.getUint8(1);
      if (byte1 === 0x1f && byte2 === 0x8b) {
        // GZIP压缩文件，可能是SPZ或compressed.ply
        // 需要部分解压来确定
        // 这里先尝试SPZ
        return this.gaussianLoaders.get('.spz') || null;
      }
    }
    
    // Check for KSplat magic ("KSPL")
    if (buffer.byteLength >= 4) {
      const magic = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
      );
      if (magic === 'KSPL') {
        return this.gaussianLoaders.get('.ksplat') || null;
      }
    }
    
    // Check for SOG magic (SOG is ZIP format, magic: 0x504b0304)
    if (buffer.byteLength >= 4) {
      const zipMagic = view.getUint32(0, true);
      if (zipMagic === 0x04034b50) {
        return this.gaussianLoaders.get('.sog') || null;
      }
    }
    
    // SPLAT format (no specific magic, harder to detect)
    // 如果文件大小是32的倍数，可能是SPLAT
    if (buffer.byteLength > 0 && buffer.byteLength % 32 === 0) {
      // 可能是SPLAT，但不确定
      // 返回null让调用者明确指定
    }
    
    return null;
  }
  
  /**
   * Read file header to detect format
   */
  private async readFileHeader(file: File, maxBytes = 4096): Promise<string> {
    const slice = file.slice(0, maxBytes);
    const arrayBuffer = await slice.arrayBuffer();
    return new TextDecoder('utf-8').decode(arrayBuffer || new ArrayBuffer(0));
  }
  
  /**
   * Check if a PLY file is a 3DGS (3D Gaussian Splatting) file
   * This function checks for required 3DGS properties in the PLY header
   */
  async is3dgsPly(file: File): Promise<boolean> {
    try {
      const header = await this.readFileHeader(file);
      const is3DGS = this.is3dgsPlyFromHeader(header);
      console.log(`PLY 文件 ${file.name} 3DGS 检测结果: ${is3DGS}`);
      return is3DGS;
    } catch (error) {
      console.warn('读取 PLY 头信息失败，按非 3DGS 处理:', file.name, error);
      return false;
    }
  }
  
  /**
   * Check if a PLY header string indicates a 3DGS file
   * This is a synchronous version that works with header strings
   */
  private is3dgsPlyFromHeader(header: string): boolean {
    const lowerHeader = header.toLowerCase();
    
    if (!lowerHeader.startsWith('ply')) {
      return false;
    }

    const requiredKeywords = [
      'property float opacity',
      'property float scale_0',
      'property float scale_1',
      'property float scale_2',
      'property float rot_0',
      'property float rot_1',
      'property float rot_2',
      'property float rot_3'
    ];

    const hasAllBaseProps = requiredKeywords.every(keyword => lowerHeader.includes(keyword));
    return hasAllBaseProps;
  }
}

/**
 * Convenience function to create and configure a universal loader
 */
export function createUniversalLoader(): UniversalLoader {
  return new UniversalLoader();
}

/**
 * Default global loader instance
 */
export const defaultLoader = createUniversalLoader();