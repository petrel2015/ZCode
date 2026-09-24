import assert from "node:assert/strict";
import test from "node:test";
import zhCN from "../src/i18n/locales/zh-CN.js";
import enUS from "../src/i18n/locales/en-US.js";
import {
  consumeInitialSettingsSection,
  consumePendingSettingsUsageTab,
  setPendingSettingsUsageIntent,
} from "../src/lib/settingsNavigation.js";

// settingsNavigation 依赖浏览器存储与 CustomEvent；node 环境下用最小 stub 驱动纯逻辑分支。
function installWindowStub() {
  const sessionStorage = new Map<string, string>();
  const localStorage = new Map<string, string>();
  globalThis.CustomEvent = class CustomEventStub {
    type: string;
    detail?: unknown;
    constructor(type: string, options?: { detail?: unknown }) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
  globalThis.window = {
    sessionStorage: {
      getItem: (key: string) => sessionStorage.get(key) ?? null,
      setItem: (key: string, value: string) => void sessionStorage.set(key, value),
      removeItem: (key: string) => void sessionStorage.delete(key),
    },
    localStorage: {
      getItem: (key: string) => localStorage.get(key) ?? null,
      setItem: (key: string, value: string) => void localStorage.set(key, value),
      removeItem: (key: string) => void localStorage.delete(key),
    },
    dispatchEvent: () => true,
  } as unknown as typeof globalThis.window;
  return { sessionStorage, localStorage };
}

test("使用统计菜单入口的 i18n key 在两份 locale 中齐备", () => {
  // 菜单项引用 sidebar.usage.plan.openStats；standalone 化曾把引用方删成孤儿 key，
  // 这里锁住「key 与入口并存」的契约，避免后续清理再误删。
  assert.equal(zhCN["sidebar.usage.plan.openStats"], "使用统计");
  assert.equal(enUS["sidebar.usage.plan.openStats"], "Usage stats");
});

test("setPendingSettingsUsageIntent 直达 usage 分区且不覆盖统计 tab", () => {
  const { sessionStorage } = installWindowStub();
  setPendingSettingsUsageIntent();
  assert.equal(sessionStorage.get("zcode-settings-section-intent"), "usage");
  // 头像菜单入口只负责打开 Usage 分区，不得写入 usageTab 意图覆盖用户上次查看的 tab。
  assert.equal(consumePendingSettingsUsageTab(), undefined);
  assert.equal(consumeInitialSettingsSection(), "usage");
});
