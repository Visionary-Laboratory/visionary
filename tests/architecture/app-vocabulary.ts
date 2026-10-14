import editor from './app-vocabulary.json';

/**
 * 应用的词汇。引擎组件可以用应用交给它的画布、DOM 容器和输入，但不认识任何具体的应用。
 *
 * DOM id 和 i18n 键取自 editor 某一刻的快照（来源见 app-vocabulary.json 的 source）：
 * editor 以后新加的 id 和键，要重新收集才会被认出来。名字和标记的规则不受快照限制。
 */

/** 应用的名字和标记：在代码里的名字或字符串里出现就算。 */
const APP_WORD_PATTERNS: RegExp[] = [
  /visionary[-_]?editor/i, // VisionaryEditor、__visionaryEditorHelper、visionary-editor
  /data-i18n/, // editor 的 i18n 靠这个属性翻译页面
  /i18next/, // editor 用的 i18n 库
];
const DOM_IDS: ReadonlySet<string> = new Set(editor.domIds);
const I18N_KEYS: ReadonlySet<string> = new Set(editor.i18nKeys);

/** 代码里的一个名字是否是应用的名字或标记。 */
export function isAppName(name: string): boolean {
  return APP_WORD_PATTERNS.some(pattern => pattern.test(name));
}

/** 一个字符串里出现的应用词汇：名字和标记、整串是 DOM id 或 i18n 键、选择器里的 `#id`。 */
export function appWordsIn(text: string): string[] {
  const words = APP_WORD_PATTERNS.flatMap(pattern => pattern.exec(text)?.[0] ?? []);
  if (DOM_IDS.has(text) || I18N_KEYS.has(text)) return [...words, text];
  return [...words, ...[...text.matchAll(/#([A-Za-z][\w-]*)/g)].map(match => match[1]).filter(id => DOM_IDS.has(id))];
}
