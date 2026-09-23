import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// 静态产品边界检查：避免重新引入平台默认地址或已移除的后台构建入口。
const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoots = [
  "packages/shared/src",
  "packages/services/src",
  "packages/ui/src",
  "packages/web/src",
  "packages/desktop/src",
  "packages/provider-node/src",
  "apps/zcode-cli/packages",
];
const failures = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      ["node_modules", "dist", "out", "test", "tests", "__tests__", ".turbo"].includes(entry.name)
    )
      continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(file);
      continue;
    }
    if (!/\.(ts|tsx|mjs|json)$/.test(file) || /\.(test|spec)\./.test(file)) continue;
    const name = relative(root, file);
    if (name === "packages/shared/src/retiredPlatform.ts") continue;
    if (/(?:cdn-)?zcode\.z\.ai/i.test(await readFile(file, "utf8"))) failures.push(name);
  }
}
await Promise.all(sourceRoots.map((path) => scan(join(root, path))));
assert.deepEqual(failures, [], "Runtime source must not contain retired platform defaults");
const desktop = JSON.parse(await readFile(join(root, "packages/desktop/package.json"), "utf8"));
for (const dependency of ["electron-updater", "@arms/rum-electron"])
  assert.equal(desktop.dependencies[dependency], undefined);
const build = await readFile(join(root, "packages/desktop/tsup.config.ts"), "utf8");
// 定时任务（cron scheduler）已随 standalone 恢复本地调度，scheduler 构建入口合法；
// codingPlanWebview 仍属平台计费面，继续禁止。
assert.equal(/preload\/codingPlanWebview/.test(build), false);
const templates = await readFile(join(root, "config/provider/zcode-builtin.json"), "utf8");
assert.equal(/zhipu-account|account:/.test(templates), false);
console.log(
  "Standalone surface: passed (runtime domains, dependencies, build entries, local templates)",
);
