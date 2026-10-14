import editor from './app-vocabulary.json';

/**
 * 应用的词汇。引擎组件可以用应用交给它的画布、DOM 容器和输入，但不认识任何具体的应用。
 *
 * 名字和标记：在代码里的名字或字符串里出现就算。
 */
export const APP_WORD_PATTERNS: RegExp[] = [
  /visionary[-_]?editor/i, // VisionaryEditor、__visionaryEditorHelper、visionary-editor
  /data-i18n/, // editor 的 i18n 靠这个属性翻译页面
  /i18next/, // editor 用的 i18n 库
];

/** editor 的 DOM id 和 i18n 键：字符串整串相等才算。来源见 app-vocabulary.json 的 source。 */
export const APP_LITERALS: ReadonlySet<string> = new Set([...editor.domIds, ...editor.i18nKeys]);
