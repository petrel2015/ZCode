import assert from "node:assert/strict";
import test from "node:test";
import {
  ROLLING_TOOLBAR_LABEL_ROOT_CLASS_NAME,
  rollingToolbarLabelInnerClassName,
} from "../src/chat-input-toolbar/rollingToolbarLabelClasses.ts";

const classes = (value: string): string[] => value.split(/\s+/u);

// 回归背景：静态（reduced-motion）分支曾与动画分支 DOM 结构不一致，调用方用
// [&>span>span]:truncate 深层选择器补截断导致 prefix/value 折成两行。这里钉住
// 组件必须自带单行与截断契约，调用方不再依赖内部层级。
test("root class guarantees single-line clipping without caller-side deep selectors", () => {
  const root = classes(ROLLING_TOOLBAR_LABEL_ROOT_CLASS_NAME);
  assert.ok(root.includes("inline-flex"));
  assert.ok(root.includes("overflow-hidden"));
  assert.ok(root.includes("min-w-0"));
  assert.ok(root.includes("max-w-full"));
});

test("truncate inner class is a block box so text-overflow can apply", () => {
  const truncated = classes(rollingToolbarLabelInnerClassName(true));
  assert.ok(truncated.includes("block"));
  assert.ok(truncated.includes("max-w-full"));
  assert.ok(truncated.includes("truncate"));
  assert.ok(!truncated.includes("inline-flex"));
});

test("non-truncate inner class keeps the animated single-line flex layout", () => {
  const flowing = classes(rollingToolbarLabelInnerClassName(false));
  assert.ok(flowing.includes("inline-flex"));
  assert.ok(flowing.includes("whitespace-nowrap"));
  assert.ok(flowing.includes("min-w-0"));
  assert.ok(!flowing.includes("block"));
  assert.ok(!flowing.includes("truncate"));
});
