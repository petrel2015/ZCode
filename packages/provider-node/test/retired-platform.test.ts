import assert from "node:assert/strict";
import test from "node:test";
import { createIndependentFetch, isRetiredPlatformUrl } from "@zcode/shared";

test("retired hosts are rejected before transport including case, ports and subdomains", async () => {
  let calls = 0;
  const fetch = createIndependentFetch(async () => {
    calls++;
    return new Response();
  });
  for (const url of [
    "https://zcode.z.ai/a",
    "http://ZCODE.Z.AI.:80",
    "https://cdn-zcode.z.ai/a",
    "https://sub.zcode.z.ai",
  ]) {
    await assert.rejects(fetch(url), /RETIRED_PLATFORM_ENDPOINT/);
  }
  assert.equal(calls, 0);
  assert.equal(isRetiredPlatformUrl("https://zcode.z.ai.example.test"), false);
  assert.equal(isRetiredPlatformUrl("https://api.z.ai"), false);
});

test("redirect cannot send a request to a retired platform", async () => {
  const urls: string[] = [];
  const fetch = createIndependentFetch(async (input) => {
    urls.push((input as Request).url);
    return new Response(null, { status: 307, headers: { location: "https://zcode.z.ai/api" } });
  });
  await assert.rejects(fetch("https://model.example.test"), /RETIRED_PLATFORM_ENDPOINT/);
  assert.deepEqual(urls, ["https://model.example.test/"]);
});

test("permitted cross-origin redirect strips credentials", async () => {
  let calls = 0;
  const fetch = createIndependentFetch(async (input) => {
    const request = input as Request;
    if (!calls++)
      return new Response(null, {
        status: 302,
        headers: { location: "https://other.example.test/" },
      });
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("x-api-key"), null);
    return new Response("ok");
  });
  assert.equal(
    await (
      await fetch("https://model.example.test", {
        method: "POST",
        body: "test",
        headers: { authorization: "Bearer test", "x-api-key": "test" },
      })
    ).text(),
    "ok",
  );
});
