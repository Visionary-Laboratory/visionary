import { appWordsIn, isAppName } from './app-vocabulary';
import type { Source } from './sources';
import {
  ALLOWED_DEPENDENCIES, CORE_PACKAGES, MODULE_ENTRIES, MODULE_NAMES, moduleOf, placementOf, type ModuleId,
} from './target-structure';

/**
 * 内核纯度、帧归应用、依赖方向、只经公开入口、应用词表。
 * 第五项架构测试"公开入口快照"不报违规，见 entry-exports.ts。
 */
export type RuleId = 'kernel-purity' | 'frame-ownership' | 'dependency-direction' | 'public-entry' | 'app-vocabulary';

/** 一个文件里同一种违规出现的次数。 */
export interface Violation {
  rule: RuleId;
  file: string;
  detail: string;
  count: number;
}

/** 同一处违规的身份：规则、文件和违规的具体内容。 */
export const violationKey = ({ rule, file, detail }: Pick<Violation, 'rule' | 'file' | 'detail'>) => [rule, file, detail].join('\0');

export function architectureViolations(sources: Source[]): Violation[] {
  const counts = new Map<string, Violation>();
  const add: Report = (rule, file, detail, times = 1) => {
    const found = { rule, file, detail, count: times };
    const existing = counts.get(violationKey(found));
    if (existing) existing.count += times;
    else counts.set(violationKey(found), found);
  };
  for (const source of sources) {
    kernelPurity(source, add);
    frameOwnership(source, add);
    dependencyDirection(source, add);
    publicEntry(source, add);
    appVocabulary(source, add);
  }
  return [...counts.values()];
}

type Report = (rule: RuleId, file: string, detail: string, times?: number) => void;

/**
 * 内核不碰页面、输入和全局状态。只认自由出现的名字：`navigator.gpu` 是 WebGPU 的入口，不算；
 * 内核自己类上同名的方法（例如时间轴的 `addEventListener`）也不算。
 */
const PAGE_NAMES = ['document', 'window', 'globalThis', 'alert', 'addEventListener', 'navigator'];

function kernelPurity(source: Source, add: Report): void {
  const placement = placementOf(source.path);
  if (!placement || !('module' in placement) || placement.module !== 'core') return;
  const allowed = CORE_PACKAGES[placement.part];
  for (const target of source.imports) {
    if ('package' in target && !allowed.includes(target.package)) add('kernel-purity', source.path, `import ${target.package}`);
  }
  for (const [name, count] of source.names) {
    if (PAGE_NAMES.includes(name)) add('kernel-purity', source.path, `use ${name}`, count);
  }
}

/** 帧由应用驱动：Visionary 引擎的任何模块都不排帧，经 `window.` 调用也算。 */
function frameOwnership(source: Source, add: Report): void {
  if (!moduleOf(source.path)) return;
  const count = (source.names.get('requestAnimationFrame') ?? 0) + (source.members.get('requestAnimationFrame') ?? 0);
  if (count) add('frame-ownership', source.path, 'requestAnimationFrame', count);
}

/** Visionary 引擎的模块对另一个文件的依赖是否违反方向。不在这些模块里的文件不受这条限制。 */
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

/** Visionary 引擎的模块里出现应用的名字、标记、DOM id 或 i18n 键。要移出引擎的文件不查。 */
function appVocabulary(source: Source, add: Report): void {
  if (!moduleOf(source.path)) return;
  for (const names of [source.names, source.members]) {
    for (const [name, count] of names) {
      if (isAppName(name)) add('app-vocabulary', source.path, name, count);
    }
  }
  for (const text of source.strings) {
    for (const word of appWordsIn(text)) add('app-vocabulary', source.path, word);
  }
}

const extraPackages = (part: 'inference' | 'decode') => CORE_PACKAGES[part].filter(name => !CORE_PACKAGES.main.includes(name)).join('、');
const edges = (Object.entries(ALLOWED_DEPENDENCIES) as [ModuleId, ModuleId[]][])
  .flatMap(([from, targets]) => targets.map(to => `${MODULE_NAMES[from]} → ${MODULE_NAMES[to]}`)).join('、');

/** 每项规则失败时的下一步。 */
const FIXES: Record<RuleId, string> = {
  'kernel-purity': `visionary-core 只依赖 WebGPU：主体只 import ${CORE_PACKAGES.main.join('、')}，`
    + `推理附属另可用 ${extraPackages('inference')}，解码附属另可用 ${extraPackages('decode')}；`
    + `不碰 ${PAGE_NAMES.join('、')}（navigator.gpu 除外）。需要这些的部分放进 three.js 适配层或应用，再把结果交给内核。`,
  'frame-ownership': '帧由应用驱动：Visionary 引擎里不调用 requestAnimationFrame。按帧要做的事写成一个方法，由应用在自己的帧循环里调用。',
  'dependency-direction': `模块之间只允许 ${edges}；Visionary 引擎的模块也不依赖要移出引擎的文件。`
    + '反过来要用的东西，改成由上层经参数、回调或接口交进来。',
  'public-entry': `从模块外面只能 import 它的公开入口（${Object.values(MODULE_ENTRIES).join('、')}）。`
    + '把要用的名字加进那个入口的导出、更新公开入口快照，再从入口 import。',
  'app-vocabulary': '引擎组件不认识具体的应用：不写 editor 的名字、标记、DOM id 或 i18n 键。'
    + '需要的东西由应用经参数交进来，或改用 Visionary 引擎自己定义的中性约定。',
};

const describeRow = ({ rule, file, detail }: Violation) => `${file} [${rule}] ${detail}`;

/**
 * 豁免清单只会变短：列着的违规照常通过；新违规失败；违规修掉或变少了而豁免行还在，也失败；
 * 豁免行不能比划线当天的起始清单多。返回每个问题的说明，空表示通过。
 */
export function auditExemptions(violations: Violation[], exemptions: Violation[], start: Violation[]): string[] {
  const actual = new Map(violations.map(v => [violationKey(v), v.count]));
  const allowed = new Map(exemptions.map(e => [violationKey(e), e.count]));
  const initial = new Map(start.map(s => [violationKey(s), s.count]));
  const problems: string[] = [];

  for (const v of violations) {
    const listed = allowed.get(violationKey(v)) ?? 0;
    if (v.count <= listed) continue;
    problems.push(`新违规：${describeRow(v)} 出现 ${v.count} 次${listed ? `，豁免清单只列了 ${listed} 次` : ''}。\n`
      + `怎么改：${FIXES[v.rule]}\n不要加豁免：豁免清单只收划线当天已有的违规。`);
  }
  for (const e of exemptions) {
    const count = actual.get(violationKey(e)) ?? 0;
    if (count >= e.count) continue;
    problems.push(`${describeRow(e)}：豁免清单列了 ${e.count} 次，实际 ${count} 次。`
      + (count === 0 ? '违规已经修掉，在 tests/architecture/exemptions.ts 里删掉这一行。' : `在 tests/architecture/exemptions.ts 里把次数改成 ${count}。`));
  }
  for (const e of exemptions) {
    const was = initial.get(violationKey(e));
    if (was !== undefined && e.count <= was) continue;
    problems.push(`${describeRow(e)}：豁免行 ${e.count} 次，起始清单${was === undefined ? '里没有这一行' : `只有 ${was} 次`}。`
      + '豁免清单只减不增：修代码，不要加豁免。');
  }
  return problems;
}
