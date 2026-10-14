# 给 AI 的工作约定

- 新增或搬动 `src/` 下的文件、跨模块加 import、改公开入口之前，先读 `tests/architecture/target-structure.ts`；架构测试（`npm run check` 的一部分）失败时，照失败信息改代码。
- 豁免清单 `tests/architecture/exemptions.ts` 只减不增：修掉一处违规，在同一次修改里删掉或改小对应的行；新的违规靠改代码消掉。
