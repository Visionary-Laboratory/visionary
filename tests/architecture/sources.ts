import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import ts from 'typescript';

/** 一个仓库文件：相对仓库根的路径；代码文件另带内容。 */
export interface RepoFile {
  path: string;
  text?: string;
}

export type ImportTarget = { file: string } | { package: string } | { unresolved: string };

/** 架构规则看到的一个代码文件。 */
export interface Source {
  path: string;
  /** 每条 import 一项，包括只为类型的 import、`export … from` 和 `import()`。 */
  imports: ImportTarget[];
  /** 代码里出现的名字及次数，不含注释和字符串。`navigator.gpu` 记作 `navigator.gpu`。 */
  names: Map<string, number>;
  /** 字符串字面量和模板字符串的各段。 */
  strings: string[];
}

/** 架构测试检查的目录。`src/ort/` 是 postinstall 拷进来的 ORT 文件，不算源码。 */
const SCANNED = ['src', 'tests', 'demo'];
const SKIPPED = new Set(['src/ort', '.DS_Store']);
const CODE = /\.(ts|tsx|mts|js|mjs)$/;

export function readRepository(root: string): RepoFile[] {
  const walk = (dir: string): RepoFile[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
      const path = posix.join(dir, entry.name);
      if (SKIPPED.has(path) || SKIPPED.has(entry.name)) return [];
      if (entry.isDirectory()) return walk(path);
      return [{ path, text: CODE.test(path) ? readFileSync(join(root, path), 'utf8') : undefined }];
    });
  return SCANNED.flatMap(walk);
}

export function analyze(files: RepoFile[]): Source[] {
  const known = new Set(files.map(file => file.path));
  return files.flatMap(file => (file.text === undefined ? [] : [analyzeOne(file.path, file.text, known)]));
}

function analyzeOne(path: string, text: string, known: Set<string>): Source {
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports: ImportTarget[] = [];
  const names = new Map<string, number>();
  const strings: string[] = [];

  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifier(node);
    if (specifier !== undefined) imports.push(resolve(path, specifier, known));
    if (ts.isIdentifier(node)) {
      const name = isNavigatorGpu(node) ? 'navigator.gpu' : node.text;
      names.set(name, (names.get(name) ?? 0) + 1);
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      strings.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { path, imports, names, strings };
}

function moduleSpecifier(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [argument] = node.arguments;
    return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
    return node.argument.literal.text;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
    && ts.isStringLiteral(node.moduleReference.expression)) {
    return node.moduleReference.expression.text;
  }
  return undefined;
}

function isNavigatorGpu(node: ts.Identifier): boolean {
  const parent = node.parent;
  return node.text === 'navigator' && ts.isPropertyAccessExpression(parent)
    && parent.expression === node && parent.name.text === 'gpu';
}

function resolve(from: string, specifier: string, known: Set<string>): ImportTarget {
  const bare = specifier.split('?')[0];
  let base: string;
  if (bare.startsWith('@/')) base = posix.join('src', bare.slice(2));
  else if (bare.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), bare));
  else return { package: bare.startsWith('@') ? bare.split('/').slice(0, 2).join('/') : bare.split('/')[0] };

  const candidates = [base, `${base}.ts`, `${base}.d.ts`, `${base}/index.ts`, base.replace(/\.js$/, '.ts')];
  const file = candidates.find(candidate => known.has(candidate));
  return file ? { file } : { unresolved: base };
}
