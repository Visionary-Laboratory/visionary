/**
 * Visionary 引擎的目标结构：今天的每个源文件将来归哪个模块。
 *
 * 引擎分四个模块，各有一个公开入口：
 *
 *   visionary-core（渲染内核，含推理附属与解码附属）
 *   three.js 适配层 → visionary-core
 *   gizmo → three.js 适配层
 *   录制与导出 → three.js 适配层
 *
 * 文件还没搬，所以这里按今天的路径写"路径 → 模块"映射，依据是
 * core-boundary §3 的去处表（visionary-editor 仓库
 * `.scratch/visionary-sim-integration/issues/06-core-boundary.md`）。
 * 不属于四个模块的文件归为"移出引擎"，写明去处。
 *
 * S3 把文件搬进 `src/core/`、`src/three/`、`src/gizmo/`、`src/recording/` 之后，
 * 这张映射就缩成这四个目录，加上尚未移走的"移出引擎"条目。
 */

export type ModuleId = 'core' | 'three' | 'gizmo' | 'recording';

/** visionary-core 里的三部分。附属各多允许一个第三方包。 */
export type CorePart = 'main' | 'inference' | 'decode';

export type Placement =
  | { module: 'core'; part: CorePart }
  | { module: Exclude<ModuleId, 'core'> }
  | { outside: string };

export const MODULE_NAMES: Record<ModuleId, string> = {
  core: 'visionary-core',
  three: 'three.js 适配层',
  gizmo: 'gizmo',
  recording: '录制与导出',
};

/** S3 之后每个模块的公开入口。从模块外面只能 import 这个文件。 */
export const MODULE_ENTRIES: Record<ModuleId, string> = {
  core: 'src/core/index.ts',
  three: 'src/three/index.ts',
  gizmo: 'src/gizmo/index.ts',
  recording: 'src/recording/index.ts',
};

/** 今天的包入口。S3 删掉它，四个模块入口取而代之。 */
export const ROOT_ENTRY = 'src/index.ts';

/** 公开入口快照记录这些文件里存在的那些。 */
export const PUBLIC_ENTRIES = [ROOT_ENTRY, ...Object.values(MODULE_ENTRIES)];

/** 模块之间允许的依赖：键可以 import 值里的模块。 */
export const ALLOWED_DEPENDENCIES: Record<ModuleId, ModuleId[]> = {
  core: [],
  three: ['core'],
  gizmo: ['three'],
  recording: ['three'],
};

/** visionary-core 各部分可以 import 的第三方包。 */
export const CORE_PACKAGES: Record<CorePart, string[]> = {
  main: ['gl-matrix'],
  inference: ['gl-matrix', 'onnxruntime-web'],
  decode: ['gl-matrix', 'fflate'],
};

const core = (part: CorePart): Placement => ({ module: 'core', part });
const three: Placement = { module: 'three' };
const gizmo: Placement = { module: 'gizmo' };
const recording: Placement = { module: 'recording' };
const outside = (destination: string): Placement => ({ outside: destination });

/**
 * 路径前缀 → 去处。以 `/` 结尾的是目录，其余是单个文件；最长的前缀生效。
 * `src/` 下每个文件都必须落进某一行，每一行也必须至少对上一个文件。
 */
export const PLACEMENTS: ReadonlyArray<readonly [string, Placement]> = [
  // visionary-core 主体
  ['src/shaders/', core('main')],
  ['src/sort/', core('main')],
  ['src/preprocess/', core('main')],
  ['src/renderer/', core('main')],
  ['src/point_cloud/', core('main')],
  ['src/uniform/', core('main')],
  ['src/timeline/', core('main')],
  ['src/camera/', core('main')],
  ['src/utils/', core('main')],
  ['src/webgpu.d.ts', core('main')],
  // 创建 device 的部分留在内核，配置画布的部分移到适配层（S3 拆出 device 模块）
  ['src/app/webgpu-context.ts', core('main')],

  // visionary-core 推理附属
  ['src/ONNX/', core('inference')],
  ['src/config/ort-config.ts', core('inference')],

  // visionary-core 解码附属；three 网格加载器暂时留在这里，由统一加载器注册
  ['src/io/', core('decode')],

  // three.js 适配层
  ['src/camera/CameraAdapter.ts', three],
  ['src/utils/env-map-helper.ts', three],
  ['src/utils/renderer-init-helper.ts', three],
  ['src/app/three-context.ts', three],
  ['src/app/GaussianModel.ts', three],
  ['src/app/GaussianThreeJSRenderer.ts', three],
  ['src/app/unified-model-loader.ts', three],
  ['src/app/managers/', three],
  ['src/models/', three],

  ['src/gizmo/', gizmo],

  ['src/exportMedia/', recording],
  ['src/types/mp4-muxer.d.ts', recording],

  // 移出引擎
  [ROOT_ENTRY, outside('删除：S3 由四个模块入口取代')],
  ['src/app/index.ts', outside('删除：S3 拆掉这个 barrel')],
  ['src/app/scene-fs.ts', outside('visionary-editor：场景存取')],
  ['src/io/unified-scene-saver.ts', outside('visionary-editor：场景存取')],
  ['src/main.ts', outside('demo/simple：早期示例 app')],
  ['src/app/app.ts', outside('demo/simple：早期示例 app')],
  ['src/app/dom-elements.ts', outside('demo/simple：早期示例 app')],
  ['src/app/ui-controller.ts', outside('demo/simple：早期示例 app')],
  ['src/app/managers/render-loop.ts', outside('demo/simple：早期示例 app')],
  ['src/app/managers/camera-manager.ts', outside('demo/simple：早期示例 app')],
  ['src/app/managers/animation-manager.ts', outside('demo/simple：早期示例 app')],
  ['src/controls/', outside('demo/simple：早期示例 app')],
  ['src/three-integration/', outside('demo/：three.js 集成演示')],
  ['src/onnx-precision/', outside('demo/：ONNX 精度转换演示')],
  ['src/three-integration/GaussianSplattingThreeWebGPU.ts', outside('删除：没人用')],
  ['src/three-integration/ThreeJsCameraAdapter.ts', outside('删除：没人用')],
  ['src/three-integration/DebugHelpers.ts', outside('删除：没人用')],
  ['src/app/transform-tracker.ts', outside('删除：没人用')],
  ['src/icons/', outside('删除：没人用')],
  ['src/ONNX/test_loader.ts', outside('测试目录：ONNX 的测试代码')],
  ['src/ONNX/test_utils.ts', outside('测试目录：ONNX 的测试代码')],
  ['src/ONNX/integration_test.ts', outside('测试目录：ONNX 的测试代码')],
];

/** `path` 落进哪一行；不在 `src/` 下或哪一行都对不上时返回 undefined。 */
export function placementOf(path: string): Placement | undefined {
  for (const [module, entry] of Object.entries(MODULE_ENTRIES) as [ModuleId, string][]) {
    if (path === entry) return module === 'core' ? core('main') : { module };
  }
  let best: readonly [string, Placement] | undefined;
  for (const row of PLACEMENTS) {
    const [prefix] = row;
    const hit = prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix;
    if (hit && (!best || prefix.length > best[0].length)) best = row;
  }
  return best?.[1];
}

export function moduleOf(path: string): ModuleId | undefined {
  const placement = placementOf(path);
  return placement && 'module' in placement ? placement.module : undefined;
}
