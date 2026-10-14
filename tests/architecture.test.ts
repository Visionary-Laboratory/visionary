import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { entryExports } from './architecture/entry-exports';
import { EXEMPTIONS, type Exemption } from './architecture/exemptions';
import { architectureViolations, auditExemptions, type RuleId, type Violation } from './architecture/rules';
import { analyze, readRepository, type RepoFile } from './architecture/sources';
import { PLACEMENTS, PUBLIC_ENTRIES, placementOf } from './architecture/target-structure';

const ROOT = join(import.meta.dirname, '..');
const here = (name: string) => join(import.meta.dirname, 'architecture', name);
const repository = readRepository(ROOT);

describe('今天的源码树', () => {
  const sources = analyze(repository);

  it('src/ 下每个文件都在目标结构里有去处，映射里每一行都对得上文件', () => {
    const unplaced = repository.filter(file => file.path.startsWith('src/') && !placementOf(file.path)).map(file => file.path);
    expect(unplaced, '新文件先在 tests/architecture/target-structure.ts 的 PLACEMENTS 里写明它归哪个模块，或者移出引擎去哪里').toEqual([]);
    const unused = PLACEMENTS.map(([prefix]) => prefix)
      .filter(prefix => !repository.some(file => (prefix.endsWith('/') ? file.path.startsWith(prefix) : file.path === prefix)));
    expect(unused, '这些映射行已经对不上任何文件，从 PLACEMENTS 里删掉').toEqual([]);
  });

  it('每条相对路径的 import 都解析得到文件，规则没有漏看的依赖', () => {
    const unresolved = sources.flatMap(source => source.imports.flatMap(target =>
      ('unresolved' in target ? [`${source.path} → ${target.unresolved}`] : [])));
    expect(unresolved, 'tests/architecture/sources.ts 解析不了这些 import：补上解析规则，或者修正路径').toEqual([]);
  });

  it('没有豁免清单之外的违规，也没有用不着或新加的豁免行', () => {
    const start = (JSON.parse(readFileSync(here('exemptions-at-start.json'), 'utf8')) as [RuleId, string, string, number][])
      .map(([rule, file, detail, count]) => ({ rule, file, detail, count }));
    const problems = auditExemptions(architectureViolations(sources), EXEMPTIONS, start);
    expect(problems, `\n${problems.join('\n\n')}\n`).toEqual([]);
  });

  it('起始清单保持划线当天的样子', () => {
    // 只减不增的底线就是这份文件。它不改；要变短的是 exemptions.ts。
    // 唯一的例外是 S3 的纯移动提交：路径跟着文件改，同时更新这里的哈希。
    const digest = createHash('sha256').update(readFileSync(here('exemptions-at-start.json'))).digest('hex');
    expect(digest, 'tests/architecture/exemptions-at-start.json 被改了：恢复它，去改 exemptions.ts')
      .toBe('7f3753ee1bb6b51a2f728a7a77f84cacf702d03e9dcab2d8cc997a9c3900c468');
  });

  it('每行豁免都写明属于哪一类；物理和缝写明由哪个阶段消掉，不动没有阶段', () => {
    const malformed = EXEMPTIONS.filter(({ category, stage, why }) =>
      !why || (category === '不动' ? stage !== undefined : stage === undefined));
    expect(malformed).toEqual([]);
    const keys = EXEMPTIONS.map(({ rule, file, detail }) => [rule, file, detail].join(' '));
    expect(keys.filter((key, i) => keys.indexOf(key) !== i), '同一处违规只写一行').toEqual([]);
  });
});

describe('公开入口快照', () => {
  it('每个公开入口导出的名字都与入库的清单一致', () => {
    const recorded = JSON.parse(readFileSync(here('public-entries.json'), 'utf8'));
    const present = PUBLIC_ENTRIES.filter(entry => repository.some(file => file.path === entry));
    expect(entryExports(ROOT, present), [
      '公开入口导出的名字变了。确认是有意的改动之后，把 tests/architecture/public-entries.json 改成实际值，',
      '和这次改动放在同一个提交里。入口新增或删除时，清单里也增删对应的一项。',
    ].join('')).toEqual(recorded);
  }, 60_000);
});

/** 规则看到的一个合成文件。 */
const file = (path: string, text: string): RepoFile => ({ path, text });
const violationsOf = (...files: RepoFile[]) => architectureViolations(analyze(files));

describe('内核纯度', () => {
  it('内核 import three 算违规，只为类型的 import 也算', () => {
    expect(violationsOf(file('src/point_cloud/point_cloud.ts', [
      "import * as THREE from 'three/webgpu';",
      "import type { Camera } from 'three';",
    ].join('\n')))).toContainEqual({
      rule: 'kernel-purity', file: 'src/point_cloud/point_cloud.ts', detail: 'import three', count: 2,
    });
  });

  it('推理附属可以用 onnxruntime-web，解码附属可以用 fflate，主体两个都不行', () => {
    expect(violationsOf(
      file('src/ONNX/onnx_gpu_io.ts', "import * as ort from 'onnxruntime-web/webgpu';"),
      file('src/io/sog_loader.ts', "import { unzipSync } from 'fflate';\nimport { vec3 } from 'gl-matrix';"),
    )).toEqual([]);
    expect(violationsOf(file('src/renderer/gaussian_renderer.ts', [
      "import * as ort from 'onnxruntime-web/webgpu';",
      "import { unzipSync } from 'fflate';",
    ].join('\n')))).toEqual([
      { rule: 'kernel-purity', file: 'src/renderer/gaussian_renderer.ts', detail: 'import onnxruntime-web', count: 1 },
      { rule: 'kernel-purity', file: 'src/renderer/gaussian_renderer.ts', detail: 'import fflate', count: 1 },
    ]);
  });

  it('内核里用到页面和输入的名字算违规，navigator.gpu 不算，注释和字符串里的也不算', () => {
    expect(violationsOf(file('src/renderer/gaussian_renderer.ts', [
      '// document.body 和 window 只在这行注释里',
      "const label = 'requestAnimationFrame';",
      'const adapter = await navigator.gpu.requestAdapter();',
      'globalThis.gaussianRenderer = this;',
      "window.addEventListener('resize', () => requestAnimationFrame(draw));",
      "const canvas = document.createElement('canvas');",
      'if (!adapter) alert(navigator.userAgent);',
    ].join('\n'))).map(({ detail, count }) => [detail, count])).toEqual([
      ['use globalThis', 1],
      ['use window', 1],
      ['use addEventListener', 1],
      ['use requestAnimationFrame', 1],
      ['use document', 1],
      ['use alert', 1],
      ['use navigator', 1],
    ]);
  });

  it('帧归应用：其余引擎模块也不准调用 requestAnimationFrame，但可以用应用交来的 DOM', () => {
    expect(violationsOf(
      file('src/app/GaussianModel.ts', 'requestAnimationFrame(() => this.flush());'),
      file('src/gizmo/gizmo-controller.ts', "canvas.addEventListener('pointerdown', onDown); window.devicePixelRatio;"),
      file('src/main.ts', 'requestAnimationFrame(loop);'),
    )).toEqual([
      { rule: 'kernel-purity', file: 'src/app/GaussianModel.ts', detail: 'use requestAnimationFrame', count: 1 },
    ]);
  });
});

/** 规则按目标结构判断，被 import 的文件要在合成的文件集里才能解析。 */
const target = (path: string) => file(path, '');
const directionOf = (...files: RepoFile[]) => violationsOf(...files).filter(v => v.rule === 'dependency-direction');

describe('依赖方向', () => {
  it('内核不依赖任何引擎组件，引擎模块不依赖要移出引擎的文件', () => {
    expect(directionOf(
      file('src/utils/index.ts', "export * from './env-map-helper';"),
      file('src/ONNX/index.ts', "export { ONNXModelTester } from './test_loader';"),
      target('src/utils/env-map-helper.ts'),
      target('src/ONNX/test_loader.ts'),
    )).toEqual([
      { rule: 'dependency-direction', file: 'src/utils/index.ts', detail: 'src/utils/env-map-helper.ts', count: 1 },
      { rule: 'dependency-direction', file: 'src/ONNX/index.ts', detail: 'src/ONNX/test_loader.ts', count: 1 },
    ]);
  });

  it('只允许 录制与导出 → three.js 适配层 → visionary-core 和 gizmo → three.js 适配层', () => {
    expect(directionOf(
      file('src/app/GaussianThreeJSRenderer.ts', "import { GaussianRenderer } from '../renderer';"),
      file('src/exportMedia/exportVideo.ts', "import type { GaussianThreeJSRenderer } from '../app/GaussianThreeJSRenderer';"),
      file('src/gizmo/gizmo-manager.ts', [
        "import type { GaussianModel } from '../app/GaussianModel';",
        "import { Aabb } from '../utils/aabb';",
      ].join('\n')),
      file('src/exportMedia/RecordingCamera.ts', "import { GizmoManager } from '../gizmo';"),
      target('src/renderer/index.ts'),
      target('src/app/GaussianThreeJSRenderer.ts'),
      target('src/app/GaussianModel.ts'),
      target('src/utils/aabb.ts'),
      target('src/gizmo/index.ts'),
    )).toEqual([
      { rule: 'dependency-direction', file: 'src/gizmo/gizmo-manager.ts', detail: 'src/utils/aabb.ts', count: 1 },
      { rule: 'dependency-direction', file: 'src/exportMedia/RecordingCamera.ts', detail: 'src/gizmo/index.ts', count: 1 },
    ]);
  });
});

const entryOf = (...files: RepoFile[]) => violationsOf(...files).filter(v => v.rule === 'public-entry');

describe('只经公开入口', () => {
  it('从模块外面只能 import 它的公开入口，模块里面随便', () => {
    expect(entryOf(
      file('src/app/GaussianThreeJSRenderer.ts', [
        "import { GaussianRenderer } from '../renderer';",
        "import { PointCloud } from '../core';",
        "import { GaussianModel } from './GaussianModel';",
      ].join('\n')),
      target('src/renderer/index.ts'),
      target('src/core/index.ts'),
      target('src/app/GaussianModel.ts'),
    )).toEqual([
      { rule: 'public-entry', file: 'src/app/GaussianThreeJSRenderer.ts', detail: 'src/renderer/index.ts', count: 1 },
    ]);
  });

  it('测试、演示和要移出引擎的文件也只能经公开入口', () => {
    expect(entryOf(
      file('tests/ply-streaming.test.ts', "import { PLYLoader } from '../src/io/ply_loader';"),
      file('demo/showcase/scripts/ShowcaseScene.ts', "import { initThreeContext } from '@/app/three-context';"),
      file('src/app/app.ts', "import { GaussianRenderer } from '../renderer/gaussian_renderer';\nimport { DOMElements } from './dom-elements';"),
      target('src/io/ply_loader.ts'),
      target('src/app/three-context.ts'),
      target('src/renderer/gaussian_renderer.ts'),
      target('src/app/dom-elements.ts'),
    ).map(({ file, detail }) => [file, detail])).toEqual([
      ['tests/ply-streaming.test.ts', 'src/io/ply_loader.ts'],
      ['demo/showcase/scripts/ShowcaseScene.ts', 'src/app/three-context.ts'],
      ['src/app/app.ts', 'src/renderer/gaussian_renderer.ts'],
    ]);
  });

  it('方向本身就错的依赖只报依赖方向，不再重复报入口', () => {
    expect(violationsOf(
      file('src/point_cloud/point_cloud.ts', "import { GaussianModel } from '../app/GaussianModel';"),
      target('src/app/GaussianModel.ts'),
    ).map(v => v.rule)).toEqual(['dependency-direction']);
  });
});

const vocabularyOf = (...files: RepoFile[]) => violationsOf(...files).filter(v => v.rule === 'app-vocabulary');

describe('应用词表', () => {
  it('引擎源码里出现 editor 的名字、标记、DOM id 或 i18n 键都算违规', () => {
    expect(vocabularyOf(
      file('src/gizmo/gizmo-controller.ts', 'helper.userData.__visionaryEditorHelper = true;'),
      file('src/app/GaussianThreeJSRenderer.ts', [
        "const panel = document.getElementById('mainViewContainer');",
        "const meta = { app: 'VisionaryEditor' };",
      ].join('\n')),
      file('src/exportMedia/RecordingCamera.ts', [
        "title.setAttribute('data-i18n', 'recordingCamera.previewWindowTitle');",
        'const text = `${i18next.t("recordingCamera.syncPreviewTitle")}`;',
      ].join('\n')),
    ).map(({ file, detail }) => `${file} ${detail}`).sort()).toEqual([
      ['src/gizmo/gizmo-controller.ts', '__visionaryEditorHelper'],
      ['src/app/GaussianThreeJSRenderer.ts', 'mainViewContainer'],
      ['src/app/GaussianThreeJSRenderer.ts', 'VisionaryEditor'],
      ['src/exportMedia/RecordingCamera.ts', 'data-i18n'],
      ['src/exportMedia/RecordingCamera.ts', 'recordingCamera.previewWindowTitle'],
      ['src/exportMedia/RecordingCamera.ts', 'i18next'],
      ['src/exportMedia/RecordingCamera.ts', 'recordingCamera.syncPreviewTitle'],
    ].map(([file, detail]) => `${file} ${detail}`).sort());
  });

  it('普通字符串和注释不算；要移出引擎的文件不查', () => {
    expect(vocabularyOf(
      file('src/exportMedia/RecordingCamera.ts', [
        '// 预览窗口以后搬进 VisionaryEditor',
        "const canvas = container.querySelector('canvas');",
      ].join('\n')),
      file('src/app/scene-fs.ts', "const meta = { app: 'VisionaryEditor' };"),
    )).toEqual([]);
  });
});

describe('豁免清单的核对', () => {
  const violation = (detail: string, count: number): Violation => ({ rule: 'kernel-purity', file: 'src/io/sog_loader.ts', detail, count });
  const exempted = (detail: string, count: number): Exemption => ({ ...violation(detail, count), category: '不动', why: 'SOG 解码的 document 兜底' });

  it('列着的违规照常通过', () => {
    expect(auditExemptions([violation('use document', 2)], [exempted('use document', 2)], [violation('use document', 2)])).toEqual([]);
  });

  it('没列着的违规、比清单多出来的次数都失败，并写明该怎么改', () => {
    const problems = auditExemptions(
      [violation('use document', 3), violation('import three', 1)],
      [exempted('use document', 2)],
      [violation('use document', 2)],
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/src\/io\/sog_loader\.ts.*use document.*3.*2/s);
    expect(problems[1]).toMatch(/src\/io\/sog_loader\.ts.*import three/s);
    for (const problem of problems) expect(problem).toMatch(/不要加豁免/);
  });

  it('违规修掉或变少了而豁免行还在，失败并要求删行或改小', () => {
    const problems = auditExemptions([violation('use document', 1)], [exempted('use document', 2), exempted('use window', 1)], [
      violation('use document', 2), violation('use window', 1),
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/use document.*改成 1/s);
    expect(problems[1]).toMatch(/use window.*删掉这一行/s);
  });

  it('起始清单里没有或比它多的豁免行失败：清单只减不增', () => {
    const problems = auditExemptions(
      [violation('use document', 3), violation('import three', 1)],
      [exempted('use document', 3), exempted('import three', 1)],
      [violation('use document', 2)],
    );
    expect(problems).toHaveLength(2);
    for (const problem of problems) expect(problem).toMatch(/起始清单/);
  });
});
