import { defineConfig, PluginOption } from 'vite';
import path from 'path';

const srcDir = path.resolve(__dirname, 'src').replace(/\\/g, '/');
const chunkSizeLimitInBytes = 5 * 1024 * 1024;
const chunkSizeBypassMatchers = [/onnxruntime-web/, /visionary-core\.umd/];

const sanitizeChunkName = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '-');

const enforceChunkSizeLimit = (): PluginOption => ({
  name: 'enforce-chunk-size-limit',
  apply: 'build',
  generateBundle(_options, bundle) {
    Object.entries(bundle).forEach(([fileName, output]) => {
      if (output.type === 'chunk') {
        if (chunkSizeBypassMatchers.some((matcher) => matcher.test(fileName))) {
          return;
        }
        const size = Buffer.byteLength(output.code, 'utf8');
        if (size > chunkSizeLimitInBytes) {
          const sizeInMb = (size / (1024 * 1024)).toFixed(2);
          this.error(
            `输出的 chunk "${fileName}" 大小为 ${sizeInMb} MB，超过 5MB 限制，请调整 manualChunks 或进行代码拆分。`
          );
        }
      }
    });
  }
});

export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 5120,
    // 构建为库模式
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'VisionaryCore',
      fileName: (format) => `visionary-core.${format}.js`,
      formats: ['es', 'umd']
    },
    rollupOptions: {
      // 确保外部依赖不会被打包进库中
      // external: ['three', 'gl-matrix', 'onnxruntime-web'],
      external: [/^three(\/.*)?$/, 'gl-matrix', /^onnxruntime-web(\/.*)?$/],
      output: [
        {
          format: 'es',
          entryFileNames: 'visionary-core.es.js',
          chunkFileNames: 'visionary-core.[name].js',
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');
            if (normalizedId.includes('/node_modules/three/')) {
              return 'three';
            }
            if (normalizedId.includes('/node_modules/gl-matrix/')) {
              return 'gl-matrix';
            }
            // if (normalizedId.includes('/node_modules/onnxruntime-web/')) {
            //   return 'onnxruntime-web';
            // }
            if (normalizedId.startsWith(srcDir)) {
              const relative = normalizedId.slice(srcDir.length + 1);
              const seg = relative.split('/')[0];
              if (seg) {
                return sanitizeChunkName(`src-${seg}`);
              }
            }
            if (normalizedId.includes('/node_modules/')) {
              const [, remainder] = normalizedId.split('/node_modules/');
              const match = remainder.match(/^(@[^/]+\/[^/]+|[^/]+)/);
              if (match) {
                return sanitizeChunkName(`vendor-${match[1]}`);
              }
            }
          }
        },
        {
          format: 'umd',
          entryFileNames: 'visionary-core.umd.js',
          name: 'VisionaryCore',
          inlineDynamicImports: true,
          globals: {
            'three': 'THREE',
            'three/webgpu': 'THREE',
            'three/examples/jsm/loaders/GLTFLoader.js': 'THREE.GLTFLoader',
            'three/examples/jsm/loaders/OBJLoader.js': 'THREE.OBJLoader',
            'three/examples/jsm/loaders/FBXLoader.js': 'THREE.FBXLoader',
            'three/examples/jsm/loaders/STLLoader.js': 'THREE.STLLoader',
            'three/examples/jsm/loaders/PLYLoader.js': 'THREE.PLYLoader',
            'gl-matrix': 'glMatrix',
            'onnxruntime-web': 'ort',
            'onnxruntime-web/webgpu': 'ort'
          }
        }
      ]
    }
  },
  plugins: [enforceChunkSizeLimit()],
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.wgsl', '**/*.ply'],
});