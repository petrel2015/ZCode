import type { ZCodeEnv } from "./env.js";
export const DEFAULT_BIGMODEL_API_ORIGIN = "https://bigmodel.cn";
// 构建仅注入公开链接；Node 调用方仍可显式传 env，避免读取另一进程的配置。

export interface RuntimeZCodeEndpointEnv {
  [key: string]: string | undefined;
  ZCODE_ENV?: string;
  ZCODE_BASE_URL?: string;
  ZCODE_ENDPOINT_ORIGIN?: string;
}

export interface RuntimeBigModelApiEnv {
  [key: string]: string | undefined;
  ZCODE_ENV?: string;
  BIGMODEL_API_BASE_URL?: string;
}

function readRuntimeEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normalizeZCodeEndpointOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("ZCode endpoint origin is empty");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("ZCode endpoint origin must use http or https");
  }
  return parsed.origin;
}

export function resolveRuntimeZCodeEnv(
  env: RuntimeZCodeEndpointEnv = typeof process === "undefined" ? {} : process.env,
): ZCodeEnv {
  // 产品身份仅用于既有展示与安装标识，不参与地址解析。
  return env.ZCODE_ENV?.trim().toLowerCase() === "test" ? "test" : "production";
}

export function resolveBigModelApiOrigin(
  env: RuntimeBigModelApiEnv = typeof process === "undefined" ? {} : process.env,
): string {
  return normalizeZCodeEndpointOrigin(
    readRuntimeEnvValue(env, "BIGMODEL_API_BASE_URL") ?? DEFAULT_BIGMODEL_API_ORIGIN,
  );
}

export function buildBigModelApiUrl(
  env: RuntimeBigModelApiEnv = typeof process === "undefined" ? {} : process.env,
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveBigModelApiOrigin(env)}${normalizedPath}`;
}

export function buildBigModelCodingPlanPersonalManageUrl(
  env: RuntimeBigModelApiEnv = typeof process === "undefined" ? {} : process.env,
): string {
  // 管理页与业务 API 共用显式 origin，避免把已登录账号带到另一个部署。
  return buildBigModelApiUrl(env, "/coding-plan/personal/overview");
}

export function buildBigModelCodingPlanTeamManageUrl(
  env: RuntimeBigModelApiEnv = typeof process === "undefined" ? {} : process.env,
): string {
  return buildBigModelApiUrl(env, "/coding-plan/team/plans");
}
