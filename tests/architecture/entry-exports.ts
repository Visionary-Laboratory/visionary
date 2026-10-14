import { join } from 'node:path';
import ts from 'typescript';

export type ExportKind = 'value' | 'type';

/**
 * 每个入口导出的全部名字，按名字排序，标明是值还是只有类型。
 * 用 TypeScript 自己解析，`export *` 和多层转出都算进去。
 */
export function entryExports(root: string, entries: string[]): Record<string, Record<string, ExportKind>> {
  const configPath = join(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  const program = ts.createProgram(entries.map(entry => join(root, entry)), { ...options, noEmit: true });
  const checker = program.getTypeChecker();

  const result: Record<string, Record<string, ExportKind>> = {};
  for (const entry of entries) {
    const module = checker.getSymbolAtLocation(program.getSourceFile(join(root, entry))!)!;
    const names = checker.getExportsOfModule(module)
      .map(symbol => [symbol.name, kindOf(symbol, checker)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    result[entry] = Object.fromEntries(names);
  }
  return result;
}

function kindOf(symbol: ts.Symbol, checker: ts.TypeChecker): ExportKind {
  if (symbol.declarations?.some(ts.isTypeOnlyImportOrExportDeclaration)) return 'type';
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return target.flags & ts.SymbolFlags.Value ? 'value' : 'type';
}
