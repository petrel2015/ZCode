/** 永久退休的平台域名；仅用于旧配置识别和出网拒绝，不是服务默认地址。 */
const RETIRED_PLATFORM_HOSTS = ["zcode.z.ai", "cdn-zcode.z.ai"] as const;

export function isRetiredPlatformUrl(input: string | URL): boolean {
  try {
    const hostname = new URL(input).hostname.toLowerCase().replace(/\.+$/, "");
    return RETIRED_PLATFORM_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

export function assertIndependentEndpoint(input: string | URL): void {
  if (isRetiredPlatformUrl(input)) {
    throw new Error("RETIRED_PLATFORM_ENDPOINT: configure a direct model or plugin endpoint");
  }
}

/** 在调用 fetch 之前拒绝旧端点；逐跳校验重定向，避免浏览器/undici 自动跳转绕过校验。 */
export function createIndependentFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    let request = new Request(input, init);
    const redirectMode = request.redirect;
    for (let hop = 0; ; hop++) {
      assertIndependentEndpoint(request.url);
      const replay = request.clone();
      const response = await fetchImpl(request, { redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location || redirectMode === "manual") return response;
      await response.body?.cancel();
      if (redirectMode === "error" || hop >= 20)
        throw new TypeError("Redirect is not allowed or limit exceeded");
      const next = new URL(location, request.url);
      assertIndependentEndpoint(next);
      const headers = new Headers(replay.headers);
      if (next.origin !== new URL(request.url).origin) {
        for (const key of ["authorization", "proxy-authorization", "cookie", "x-api-key"])
          headers.delete(key);
      }
      const toGet =
        ((response.status === 301 || response.status === 302) && replay.method === "POST") ||
        (response.status === 303 && replay.method !== "GET" && replay.method !== "HEAD");
      if (toGet) {
        for (const key of [
          "content-type",
          "content-length",
          "content-encoding",
          "content-language",
          "content-location",
        ])
          headers.delete(key);
      }
      request = new Request(next, {
        method: toGet ? "GET" : replay.method,
        headers,
        signal: replay.signal,
        credentials: replay.credentials,
        redirect: redirectMode,
        ...(!toGet && replay.method !== "GET" && replay.method !== "HEAD"
          ? { body: await replay.arrayBuffer() }
          : {}),
      });
    }
  };
}
