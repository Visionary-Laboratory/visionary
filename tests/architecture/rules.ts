import { APP_LITERALS, APP_WORD_PATTERNS } from './app-vocabulary';
import type { Source } from './sources';
import { ALLOWED_DEPENDENCIES, CORE_PACKAGES, MODULE_ENTRIES, moduleOf, placementOf } from './target-structure';

export type RuleId = 'kernel-purity' | 'public-entry' | 'dependency-direction' | 'app-vocabulary';

/** 一个文件里同一种违规出现的次数。 */
export interface Violation {
  rule: RuleId;
  file: string;
  detail: string;
  count: number;
}

export function architectureViolations(sources: Source[]): Violation[] {
  const counts = new Map<string, Violation>();
  const add: Report = (rule, file, detail, times = 1) => {
    const key = [rule, file, detail].join('\0');
    const existing = counts.get(key);
    if (existing) existing.count += times;
    else counts.set(key, { rule, file, detail, count: times });
  };
  for (const source of sources) {
    kernelPurity(source, add);
    dependencyDirection(source, add);
    publicEntry(source, add);
    appVocabulary(source, add);
  }
  return [...counts.values()];
}

/** 引擎模块对另一个文件的依赖是否违反方向。不在引擎模块里的文件不受这条限制。 */
function breaksDirection(from: string, to: string): boolean {
  const source = moduleOf(from);
  if (!source) return false;
  const target = moduleOf(to);
  if (target === source) return false;
  return !target || !ALLOWED_DEPENDENCIES[source].includes(target);
}

function dependencyDirection(source: Source, add: Report): void {
  for (const target of source.imports) {
    if ('file' in target && breaksDirection(source.path, target.file)) add('dependency-direction', source.path, target.file);
  }
}

/** 从模块外面 import 模块里的文件，只能是它的公开入口。方向已经错了的依赖归上一条。 */
function publicEntry(source: Source, add: Report): void {
  for (const target of source.imports) {
    if (!('file' in target)) continue;
    const module = moduleOf(target.file);
    if (!module || module === moduleOf(source.path) || target.file === MODULE_ENTRIES[module]) continue;
    if (!breaksDirection(source.path, target.file)) add('public-entry', source.path, target.file);
  }
}

type Report = (rule: RuleId, file: string, detail: string, times?: number) => void;

/** 内核不碰页面、输入和全局状态。`navigator.gpu` 是 WebGPU 的入口，不在此列。 */
const PAGE_NAMES = ['document', 'window', 'globalThis', 'alert', 'addEventListener', 'requestAnimationFrame', 'navigator'];
/** 帧由应用驱动：其余引擎模块可以用应用交来的画布和 DOM，但不自己排帧。 */
const FRAME_NAMES = ['requestAnimationFrame'];

function kernelPurity(source: Source, add: Report): void {
  const placement = placementOf(source.path);
  if (!placement || !('module' in placement)) return;
  if (placement.module === 'core') {
    const allowed = CORE_PACKAGES[placement.part];
    for (const target of source.imports) {
      if ('package' in target && !allowed.includes(target.package)) add('kernel-purity', source.path, `import ${target.package}`);
    }
  }
  const forbidden = placement.module === 'core' ? PAGE_NAMES : FRAME_NAMES;
  for (const [name, count] of source.names) {
    if (forbidden.includes(name)) add('kernel-purity', source.path, `use ${name}`, count);
  }
}

/** 引擎模块里出现应用的名字、标记、DOM id 或 i18n 键。要移出引擎的文件不查。 */
function appVocabulary(source: Source, add: Report): void {
  if (!moduleOf(source.path)) return;
  for (const [name, count] of source.names) {
    if (APP_WORD_PATTERNS.some(pattern => pattern.test(name))) add('app-vocabulary', source.path, name, count);
  }
  for (const text of source.strings) {
    if (APP_LITERALS.has(text)) add('app-vocabulary', source.path, text);
    for (const pattern of APP_WORD_PATTERNS) {
      const match = pattern.exec(text);
      if (match) add('app-vocabulary', source.path, match[0]);
    }
  }
}

/** 每项规则失败时的下一步。 */
const FIXES: Record<RuleId, string> = {
  'kernel-purity': 'visionary-core 只依赖 WebGPU：不 import three 和别的包（推理附属另可用 onnxruntime-web，解码附属另可用 fflate），'
    + '不碰 document、window、输入和全局状态；整个引擎都不调用 requestAnimationFrame，帧由应用驱动。'
    + '需要这些的部分放进 three.js 适配层或应用，再把结果交给内核。',
  'public-entry': '从模块外面只能 import 它的公开入口（tests/architecture/target-structure.ts 的 MODULE_ENTRIES）。'
    + '把要用的名字加进那个入口的导出、更新公开入口快照，再从入口 import。',
  'dependency-direction': '模块之间只允许 录制与导出 → three.js 适配层 → visionary-core、gizmo → three.js 适配层，'
    + '引擎模块也不依赖要移出引擎的文件。反过来要用的东西，改成由上层经参数、回调或接口交进来。',
  'app-vocabulary': '引擎不认识具体的应用：不写 editor 的名字、标记、DOM id 或 i18n 键。'
    + '需要的东西由应用经参数交进来，或改用引擎自己定义的中性约定。',
};

const keyOf = ({ rule, file, detail }: Violation) => [rule, file, detail].join('\0');
const describeRow = ({ rule, file, detail }: Violation) => `${file} [${rule}] ${detail}`;

/**
 * 豁免清单只会变短：列着的违规照常通过；新违规失败；违规修掉或变少了而豁免行还在，也失败；
 * 豁免行不能比划线当天的起始清单多。返回每个问题的说明，空表示通过。
 */
export function auditExemptions(violations: Violation[], exemptions: Violation[], start: Violation[]): string[] {
  const actual = new Map(violations.map(v => [keyOf(v), v.count]));
  const allowed = new Map(exemptions.map(e => [keyOf(e), e.count]));
  const initial = new Map(start.map(s => [keyOf(s), s.count]));
  const problems: string[] = [];

  for (const v of violations) {
    const listed = allowed.get(keyOf(v)) ?? 0;
    if (v.count <= listed) continue;
    problems.push(`新违规：${describeRow(v)} 出现 ${v.count} 次${listed ? `，豁免清单只列了 ${listed} 次` : ''}。\n`
      + `怎么改：${FIXES[v.rule]}\n不要加豁免：豁免清单只收划线当天已有的违规。`);
  }
  for (const e of exemptions) {
    const count = actual.get(keyOf(e)) ?? 0;
    if (count >= e.count) continue;
    problems.push(`${describeRow(e)}：豁免清单列了 ${e.count} 次，实际 ${count} 次。`
      + (count === 0 ? '违规已经修掉，在 tests/architecture/exemptions.ts 里删掉这一行。' : `在 tests/architecture/exemptions.ts 里把次数改成 ${count}。`));
  }
  for (const e of exemptions) {
    const was = initial.get(keyOf(e));
    if (was !== undefined && e.count <= was) continue;
    problems.push(`${describeRow(e)}：豁免行 ${e.count} 次，起始清单${was === undefined ? '里没有这一行' : `只有 ${was} 次`}。`
      + '豁免清单只减不增：修代码，不要加豁免。');
  }
  return problems;
}
