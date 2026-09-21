import { createIndependentFetch } from "@zcode/shared";
export { run } from "./run.js";
export type { RunContext, GlobalOptions } from "@zcode/shared-types";

// 同一 Agent 内的模型、插件与 MCP fetch 均执行退休域名拒绝策略。
globalThis.fetch = createIndependentFetch(globalThis.fetch.bind(globalThis));
