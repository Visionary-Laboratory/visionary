import { ILoader, LoadingOptions } from './index';
import { PLYGaussianData } from './GaussianData';
import { PLYLoader } from './ply_loader';
import { CompressedPLYLoader } from './compressed_ply_loader';
import { SplatLoader } from './splat_loader';
import { KSplatLoader } from './ksplat_loader';
import { SPZLoader } from './spz_loader';
import { SOGLoader } from './sog_loader';

export class UniversalGaussianLoader implements ILoader<PLYGaussianData> {
  private loaders: Map<string, ILoader<PLYGaussianData>>;

  constructor() {
    this.loaders = new Map([
      ['ply', new PLYLoader()],
      ['sog', new SOGLoader()],
      ['compressed.ply', new CompressedPLYLoader()],
      ['ksplat', new KSplatLoader()],
      ['splat', new SplatLoader()],
      ['spz', new SPZLoader()],
    ]);
  }

  async loadFile(file: File, options?: LoadingOptions): Promise<PLYGaussianData> {
    const loader = this.detectLoader(file.name);
    return loader.loadFile(file, options);
  }

  async loadUrl(url: string, options?: LoadingOptions): Promise<PLYGaussianData> {
    const loader = this.detectLoader(url);
    return loader.loadUrl(url, options);
  }

  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    throw new Error('Use loadFile or loadUrl for automatic format detection');
  }

  canHandle(filename: string, mimeType?: string): boolean {
    return Array.from(this.loaders.values()).some(l => l.canHandle(filename, mimeType));
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.loaders.values()).flatMap(l => l.getSupportedExtensions());
  }

  private detectLoader(filename: string): ILoader<PLYGaussianData> {
    const lower = filename.toLowerCase();
    
    // 优先匹配更具体的扩展名
    if (lower.endsWith('.compressed.ply')) return this.loaders.get('compressed.ply')!;
    if (lower.endsWith('.ksplat')) return this.loaders.get('ksplat')!;
    if (lower.endsWith('.splat')) return this.loaders.get('splat')!;
    if (lower.endsWith('.spz')) return this.loaders.get('spz')!;
    if (lower.endsWith('.sog')) return this.loaders.get('sog')!;
    if (lower.endsWith('.ply')) return this.loaders.get('ply')!;

    throw new Error(`Unsupported file format: ${filename}`);
  }
}