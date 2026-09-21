import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeProviderConfigRuntime } from "../src/provider-config-runtime.js";
import { createNetworkProxyFetch } from "../../../apps/zcode-cli/packages/adapters/src/network/proxy-fetch.js";

const bundledFilePath = new URL("../../../config/provider/zcode-builtin.json", import.meta.url)
  .pathname;

test("local provider templates contain no platform account or retired endpoint", async () => {
  const content = await readFile(bundledFilePath, "utf8");
  assert.doesNotMatch(content, /account:|zhipu-account|zcode(?:\\\\)?\.z/);
  const release = JSON.parse(content);
  assert.ok(
    release.config.providerConfigRules.templateRules.some(
      (entry: { config: { api?: { type?: string } } }) =>
        entry.config.api?.type === "anthropic-messages",
    ),
  );
});

test("provider runtime starts with local templates without fetching", async () => {
  const dir = await mkdtemp(join(tmpdir(), "standalone-provider-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Unexpected network request");
  };
  const runtime = new NodeProviderConfigRuntime({
    zcodeBuiltinFilePath: bundledFilePath,
    personalFilePath: join(dir, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
  });
  try {
    await runtime.start();
    assert.equal(await runtime.resolveZCodeBuiltinActiveFilePath(), bundledFilePath);
    assert.ok(await runtime.configService.read());
  } finally {
    runtime.dispose();
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("model transport preserves configured GLM destinations and credentials", async () => {
  for (const url of [
    "https://open.bigmodel.cn/api/anthropic/v1/messages",
    "https://api.z.ai/api/anthropic/v1/messages",
    "https://model.example.test/v1/messages",
  ]) {
    const fetch = createNetworkProxyFetch({
      env: {},
      fetch: async (input, init) => {
        const request = input as Request;
        assert.equal(request.url, url);
        assert.equal(request.headers.get("x-api-key"), "test-key");
        assert.equal(await request.text(), '{"model":"test-model"}');
        return new Response("ok");
      },
    });
    assert.equal(
      await (
        await fetch(url, {
          method: "POST",
          headers: { "x-api-key": "test-key" },
          body: '{"model":"test-model"}',
        })
      ).text(),
      "ok",
    );
  }
});
