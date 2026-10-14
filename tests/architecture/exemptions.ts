import type { RuleId, Violation } from './rules';

/**
 * 引擎今天已有的架构违规。这是欠账，不是许可。
 *
 * 清单只会变短。`tests/architecture.test.ts` 在这些情况下失败：
 * - 出现清单里没有的违规，或次数比清单多；
 * - 某行的违规修掉了或变少了，这一行却还在（同一次修改里删行或改小）；
 * - 某行在 `exemptions-at-start.json` 里没有，或比那里多。那份文件是划线当天
 *   （2026-10-14）的清单，测试钉住了它的哈希，不改。
 *
 * 分组写：一组是同一处欠账，写明它是什么、属于哪一类、由哪个阶段消掉（阶段见
 * visionary-editor 的 `.scratch/first-integration/spec.md` 第 2 节）。每行是
 * `[规则, 文件, 违规的具体内容, 次数]`，规则和内容的含义见 `rules.ts`。
 *
 * S3 搬文件的那个纯移动提交里，文件路径会变：这里和起始清单的路径一起改，同时
 * 更新测试里的哈希；除了路径，什么都不改。
 */

/** 物理：不做就接不上物理。缝：core 与 editor 之间的缝上必须做的整理。不动：只定去处，本路线不做。 */
export type Category = '物理' | '缝' | '不动';
export type Stage = 'S3' | 'S4' | 'S6';

export interface Exemption extends Violation {
  category: Category;
  /** 物理和缝写由哪个阶段消掉；不动没有。 */
  stage?: Stage;
  why: string;
}

interface Group {
  category: Category;
  stage?: Stage;
  why: string;
  rows: [RuleId, string, string, number][];
}

const GROUPS: Group[] = [
  {
    category: '物理',
    stage: 'S3',
    why: 'webgpu-context 把创建 device、与 ORT 共用 device、读全局的 ORT 状态、配置画布混在一起，适配层直接伸进来取。S3 第 2 步拆出 device 模块：内核里只剩合并要求、选卡、请求 device，配置画布移到适配层，适配层经内核入口取用。',
    rows: [
      ['public-entry', 'src/app/three-context.ts', 'src/app/webgpu-context.ts', 1],
      ['kernel-purity', 'src/app/webgpu-context.ts', 'import onnxruntime-web', 3],
      ['kernel-purity', 'src/app/webgpu-context.ts', 'use globalThis', 1],
    ],
  },
  {
    category: '缝',
    stage: 'S3',
    why: '内核的 utils barrel 转出两个 three 工具，凡是从 utils 取值的内核文件都会加载 three。S3 把这两个工具搬进适配层，three 成为可选的 peer 依赖。',
    rows: [
      ['dependency-direction', 'src/utils/index.ts', 'src/utils/env-map-helper.ts', 1],
      ['dependency-direction', 'src/utils/index.ts', 'src/utils/renderer-init-helper.ts', 1],
    ],
  },
  {
    category: '缝',
    stage: 'S3',
    why: '今天的包入口跨模块转出各处的类。S3 删掉它，由四个模块入口取代。',
    rows: [
      ['public-entry', 'src/index.ts', 'src/app/three-context.ts', 1],
      ['public-entry', 'src/index.ts', 'src/renderer/gaussian_renderer.ts', 1],
      ['public-entry', 'src/index.ts', 'src/app/unified-model-loader.ts', 1],
      ['public-entry', 'src/index.ts', 'src/camera/perspective.ts', 1],
      ['public-entry', 'src/index.ts', 'src/camera/CameraAdapter.ts', 1],
      ['public-entry', 'src/index.ts', 'src/io/index.ts', 1],
      ['public-entry', 'src/index.ts', 'src/app/managers/index.ts', 2],
      ['public-entry', 'src/index.ts', 'src/ONNX/onnx_gpu_io.ts', 2],
      ['public-entry', 'src/index.ts', 'src/app/GaussianModel.ts', 1],
      ['public-entry', 'src/index.ts', 'src/utils/env-map-helper.ts', 1],
      ['public-entry', 'src/index.ts', 'src/exportMedia/index.ts', 2],
      ['public-entry', 'src/index.ts', 'src/exportMedia/exportVideo.ts', 1],
      ['public-entry', 'src/index.ts', 'src/config/ort-config.ts', 1],
    ],
  },
  {
    category: '缝',
    stage: 'S3',
    why: 'app/index 是早期 demo 用的 barrel，跨模块转出适配层的类。S3 删掉它。',
    rows: [
      ['public-entry', 'src/app/index.ts', 'src/app/GaussianModel.ts', 2],
      ['public-entry', 'src/app/index.ts', 'src/app/GaussianThreeJSRenderer.ts', 1],
      ['public-entry', 'src/app/index.ts', 'src/app/managers/gaussian-loader.ts', 2],
      ['public-entry', 'src/app/index.ts', 'src/app/managers/file-loader.ts', 1],
      ['public-entry', 'src/app/index.ts', 'src/app/managers/onnx-manager.ts', 1],
      ['public-entry', 'src/app/index.ts', 'src/app/managers/model-manager.ts', 1],
      ['public-entry', 'src/app/index.ts', 'src/app/three-context.ts', 1],
      ['public-entry', 'src/app/index.ts', 'src/app/webgpu-context.ts', 1],
      ['public-entry', 'src/app/index.ts', 'src/models/model-entry.ts', 1],
    ],
  },
  {
    category: '缝',
    stage: 'S3',
    why: '适配层的 managers barrel 转出早期示例 app 的三个管理器，供根入口使用。S3 删掉根入口后，早期示例 app 改为直接 import 它们。',
    rows: [
      ['dependency-direction', 'src/app/managers/index.ts', 'src/app/managers/camera-manager.ts', 1],
      ['dependency-direction', 'src/app/managers/index.ts', 'src/app/managers/animation-manager.ts', 1],
      ['dependency-direction', 'src/app/managers/index.ts', 'src/app/managers/render-loop.ts', 1],
    ],
  },
  {
    category: '缝',
    stage: 'S3',
    why: '适配层直接 import 内核的内部文件。S3 建好内核入口后改经入口；入口里缺的名字按需补上，并更新公开入口快照。',
    rows: [
      ['public-entry', 'src/app/GaussianModel.ts', 'src/point_cloud/index.ts', 1],
      ['public-entry', 'src/app/GaussianModel.ts', 'src/utils/index.ts', 1],
      ['public-entry', 'src/app/GaussianThreeJSRenderer.ts', 'src/camera/index.ts', 1],
      ['public-entry', 'src/app/GaussianThreeJSRenderer.ts', 'src/renderer/index.ts', 1],
      ['public-entry', 'src/app/GaussianThreeJSRenderer.ts', 'src/point_cloud/index.ts', 1],
      ['public-entry', 'src/app/managers/file-loader.ts', 'src/io/index.ts', 1],
      ['public-entry', 'src/app/managers/file-loader.ts', 'src/io/ply_loader.ts', 1],
      ['public-entry', 'src/app/managers/file-loader.ts', 'src/point_cloud/index.ts', 2],
      ['public-entry', 'src/app/managers/gaussian-loader.ts', 'src/io/index.ts', 1],
      ['public-entry', 'src/app/managers/gaussian-loader.ts', 'src/point_cloud/index.ts', 1],
      ['public-entry', 'src/app/managers/onnx-manager.ts', 'src/ONNX/onnx_generator.ts', 1],
      ['public-entry', 'src/app/managers/onnx-manager.ts', 'src/point_cloud/dynamic_point_cloud.ts', 1],
      ['public-entry', 'src/app/managers/onnx-manager.ts', 'src/ONNX/precision-types.ts', 1],
      ['public-entry', 'src/app/unified-model-loader.ts', 'src/io/index.ts', 1],
      ['public-entry', 'src/models/fbx-model-wrapper.ts', 'src/timeline/types.ts', 1],
      ['public-entry', 'src/models/model-entry.ts', 'src/point_cloud/index.ts', 1],
    ],
  },
  {
    category: '缝',
    stage: 'S3',
    why: '录制与导出直接 import 适配层的内部文件。S3 建好适配层入口后改经入口。',
    rows: [
      ['public-entry', 'src/exportMedia/RecordingCamera.ts', 'src/app/GaussianThreeJSRenderer.ts', 1],
      ['public-entry', 'src/exportMedia/RecordingCamera.ts', 'src/app/GaussianModel.ts', 1],
      ['public-entry', 'src/exportMedia/RecordingCamera.ts', 'src/utils/renderer-init-helper.ts', 1],
      ['public-entry', 'src/exportMedia/exportVideo.ts', 'src/app/GaussianThreeJSRenderer.ts', 1],
    ],
  },
  {
    category: '缝',
    stage: 'S3',
    why: '场景存取不是引擎组件。S3 从引擎删掉，S4 原样收进 editor。',
    rows: [
      ['public-entry', 'src/app/scene-fs.ts', 'src/models/model-entry.ts', 1],
    ],
  },
  {
    category: '缝',
    stage: 'S3',
    why: '两个旧测试直接测适配层和解码附属的内部类。S3 有了入口后改经入口。',
    rows: [
      ['public-entry', 'tests/local-gaussian-capacity.test.ts', 'src/app/managers/file-loader.ts', 1],
      ['public-entry', 'tests/local-gaussian-capacity.test.ts', 'src/app/managers/gaussian-loader.ts', 1],
      ['public-entry', 'tests/local-gaussian-capacity.test.ts', 'src/app/managers/model-manager.ts', 1],
      ['public-entry', 'tests/local-gaussian-capacity.test.ts', 'src/app/managers/onnx-manager.ts', 1],
      ['public-entry', 'tests/local-gaussian-capacity.test.ts', 'src/point_cloud/index.ts', 1],
      ['public-entry', 'tests/ply-streaming.test.ts', 'src/io/ply_loader.ts', 1],
      ['public-entry', 'tests/ply-streaming.test.ts', 'src/io/index.ts', 1],
    ],
  },
  {
    category: '缝',
    stage: 'S6',
    why: 'gizmo 给辅助物打 editor 的标记，录制相机按这个标记隐藏辅助物。S6 改用适配层定义的中性"编辑辅助物"约定。',
    rows: [
      ['app-vocabulary', 'src/exportMedia/RecordingCamera.ts', '__visionaryEditorHelper', 1],
      ['app-vocabulary', 'src/gizmo/gizmo-controller.ts', '__visionaryEditorHelper', 4],
    ],
  },
  {
    category: '缝',
    stage: 'S6',
    why: '录制相机自带的浮动预览窗口用 editor 的 i18n。S6 把预览窗口搬进 editor，录制组件只把画面画进应用交来的画布。',
    rows: [
      ['app-vocabulary', 'src/exportMedia/RecordingCamera.ts', 'data-i18n', 2],
      ['app-vocabulary', 'src/exportMedia/RecordingCamera.ts', 'recordingCamera.previewWindowTitle', 1],
      ['app-vocabulary', 'src/exportMedia/RecordingCamera.ts', 'recordingCamera.syncPreviewTitle', 1],
    ],
  },
  {
    category: '不动',
    why: '解码附属原样不动：统一加载器注册 three 的网格加载器；SOG 解码在没有 OffscreenCanvas 时用 document 建画布。',
    rows: [
      ['kernel-purity', 'src/io/sog_loader.ts', 'use document', 1],
      ['kernel-purity', 'src/io/threejs_adapters.ts', 'import three', 6],
    ],
  },
  {
    category: '不动',
    why: '推理附属原样不动：初始化失败时经 globalThis 弹 alert；ORT 的 wasm 路径配置读写 window.ort。',
    rows: [
      ['kernel-purity', 'src/ONNX/onnx_gpu_io.ts', 'use globalThis', 1],
      ['kernel-purity', 'src/ONNX/onnx_gpu_io.ts', 'use alert', 1],
      ['kernel-purity', 'src/config/ort-config.ts', 'use window', 14],
    ],
  },
  {
    category: '不动',
    why: '渲染器往 globalThis 挂单例，并读两个调试开关。本路线不处理。',
    rows: [
      ['kernel-purity', 'src/renderer/gaussian_renderer.ts', 'use globalThis', 3],
    ],
  },
  {
    category: '不动',
    why: '时间轴自己的事件接口与 DOM 的 addEventListener 同名，不是 DOM 依赖。时间轴随 DynamicPointCloud 原样不动。',
    rows: [
      ['kernel-purity', 'src/timeline/AnimationState.ts', 'use addEventListener', 1],
      ['kernel-purity', 'src/timeline/TimelineController.ts', 'use addEventListener', 1],
    ],
  },
  {
    category: '不动',
    why: 'GaussianModel 用 requestAnimationFrame 合并变换更新。本路线没有安排；S6 改适配层时可以顺手去掉。',
    rows: [
      ['kernel-purity', 'src/app/GaussianModel.ts', 'use requestAnimationFrame', 1],
    ],
  },
  {
    category: '不动',
    why: 'ONNX 的测试代码放在推理附属里，并由它的 index 转出。以后移到测试目录。',
    rows: [
      ['dependency-direction', 'src/ONNX/index.ts', 'src/ONNX/test_loader.ts', 1],
      ['dependency-direction', 'src/ONNX/index.ts', 'src/ONNX/integration_test.ts', 1],
      ['dependency-direction', 'src/ONNX/index.ts', 'src/ONNX/test_utils.ts', 1],
      ['public-entry', 'src/ONNX/integration_test.ts', 'src/ONNX/index.ts', 1],
      ['public-entry', 'src/ONNX/test_utils.ts', 'src/ONNX/onnx_generator.ts', 1],
    ],
  },
  {
    category: '不动',
    why: '早期示例 app 以后移出库源码，成为 demo/simple 自己的代码。',
    rows: [
      ['public-entry', 'src/app/app.ts', 'src/renderer/gaussian_renderer.ts', 1],
      ['public-entry', 'src/app/app.ts', 'src/app/webgpu-context.ts', 1],
      ['public-entry', 'src/app/app.ts', 'src/config/ort-config.ts', 1],
      ['public-entry', 'src/app/app.ts', 'src/app/managers/index.ts', 1],
      ['public-entry', 'src/app/app.ts', 'src/io/index.ts', 1],
      ['public-entry', 'src/app/app.ts', 'src/point_cloud/index.ts', 1],
      ['public-entry', 'src/app/managers/animation-manager.ts', 'src/point_cloud/index.ts', 1],
      ['public-entry', 'src/app/managers/animation-manager.ts', 'src/app/managers/model-manager.ts', 1],
      ['public-entry', 'src/app/managers/animation-manager.ts', 'src/models/model-entry.ts', 1],
      ['public-entry', 'src/app/managers/camera-manager.ts', 'src/camera/perspective.ts', 1],
      ['public-entry', 'src/app/managers/camera-manager.ts', 'src/point_cloud/index.ts', 1],
      ['public-entry', 'src/app/managers/camera-manager.ts', 'src/utils/index.ts', 1],
      ['public-entry', 'src/app/managers/render-loop.ts', 'src/renderer/gaussian_renderer.ts', 1],
      ['public-entry', 'src/app/managers/render-loop.ts', 'src/point_cloud/index.ts', 1],
      ['public-entry', 'src/app/managers/render-loop.ts', 'src/app/webgpu-context.ts', 1],
      ['public-entry', 'src/app/managers/render-loop.ts', 'src/app/managers/model-manager.ts', 1],
      ['public-entry', 'src/controls/base-controller.ts', 'src/camera/index.ts', 1],
      ['public-entry', 'src/controls/controller.ts', 'src/camera/index.ts', 1],
      ['public-entry', 'src/controls/fps-controller.ts', 'src/camera/index.ts', 1],
      ['public-entry', 'src/main.ts', 'src/ONNX/index.ts', 1],
      ['public-entry', 'src/main.ts', 'src/config/ort-config.ts', 1],
    ],
  },
  {
    category: '不动',
    why: '没人用的文件，以后删除。',
    rows: [
      ['public-entry', 'src/three-integration/DebugHelpers.ts', 'src/shaders/debug-helpers.wgsl', 1],
      ['public-entry', 'src/three-integration/GaussianSplattingThreeWebGPU.ts', 'src/renderer/gaussian_renderer.ts', 1],
      ['public-entry', 'src/three-integration/GaussianSplattingThreeWebGPU.ts', 'src/point_cloud/index.ts', 1],
      ['public-entry', 'src/three-integration/GaussianSplattingThreeWebGPU.ts', 'src/io/index.ts', 1],
      ['public-entry', 'src/three-integration/ThreeJsCameraAdapter.ts', 'src/camera/index.ts', 1],
    ],
  },
  {
    category: '不动',
    why: '演示代码，以后移到 demo/。',
    rows: [
      ['public-entry', 'src/onnx-precision/demo_onnx_precision.ts', 'src/app/managers/onnx-manager.ts', 1],
      ['public-entry', 'src/onnx-precision/demo_onnx_precision.ts', 'src/point_cloud/dynamic_point_cloud.ts', 1],
      ['public-entry', 'src/onnx-precision/demo_onnx_precision.ts', 'src/ONNX/precision-detector.ts', 1],
      ['public-entry', 'src/onnx-precision/demo_onnx_precision.ts', 'src/app/GaussianModel.ts', 1],
      ['public-entry', 'src/onnx-precision/demo_onnx_precision.ts', 'src/app/GaussianThreeJSRenderer.ts', 1],
      ['public-entry', 'src/onnx-precision/demo_onnx_precision.ts', 'src/app/managers/model-manager.ts', 1],
      ['public-entry', 'src/three-integration/demo.ts', 'src/exportMedia/index.ts', 1],
      ['public-entry', 'src/three-integration/demo_3dgs_params.ts', 'src/app/three-context.ts', 1],
      ['public-entry', 'src/three-integration/demo_fbx_animation.ts', 'src/timeline/index.ts', 1],
      ['public-entry', 'src/three-integration/demo_fbx_animation.ts', 'src/app/managers/fbx-loader.ts', 1],
      ['public-entry', 'src/three-integration/demo_fbx_animation.ts', 'src/app/managers/model-manager.ts', 1],
      ['public-entry', 'src/three-integration/demo_fbx_animation.ts', 'src/models/fbx-model-wrapper.ts', 1],
      ['public-entry', 'src/three-integration/demo_gizmo.ts', 'src/app/three-context.ts', 1],
      ['public-entry', 'src/three-integration/demo_gizmo.ts', 'src/gizmo/gizmo-manager.ts', 1],
      ['public-entry', 'src/three-integration/demo_gizmo.ts', 'src/gizmo/types.ts', 1],
      ['public-entry', 'src/three-integration/demo_gizmo.ts', 'src/app/managers/file-loader.ts', 1],
      ['public-entry', 'src/three-integration/demo_gizmo.ts', 'src/app/managers/onnx-manager.ts', 1],
      ['public-entry', 'src/three-integration/demo_gizmo.ts', 'src/app/managers/model-manager.ts', 1],
      ['public-entry', 'src/three-integration/demo_gizmo.ts', 'src/app/GaussianModel.ts', 1],
      ['public-entry', 'src/three-integration/demo_gizmo.ts', 'src/app/GaussianThreeJSRenderer.ts', 1],
      ['public-entry', 'src/three-integration/demo_gizmo.ts', 'src/utils/index.ts', 1],
      ['public-entry', 'demo/showcase/scripts/ShowcaseScene.ts', 'src/app/three-context.ts', 1],
      ['public-entry', 'demo/showcase/scripts/ShowcaseScene.ts', 'src/app/unified-model-loader.ts', 1],
      ['public-entry', 'demo/showcase/scripts/ShowcaseScene.ts', 'src/config/ort-config.ts', 1],
    ],
  },
];

export const EXEMPTIONS: Exemption[] = GROUPS.flatMap(({ rows, ...group }) =>
  rows.map(([rule, file, detail, count]) => ({ rule, file, detail, count, ...group })));
