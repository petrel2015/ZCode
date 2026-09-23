// 定时任务恢复（standalone）行为测试：cron 解析/下次触发计算与调度规则归一化
// 是纯本地领域逻辑，直接锁定其语义，防止后续改动破坏 scheduler 的派发承诺。
// 注意：croner 按本地时区解析；断言的期望值用本地 Date 构造，避免 CI 时区差异。
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRelativeDelaySchedule,
  computeAutomationNextRunAt,
  computeNextRunAt,
  computeScheduleRuleNextRunAt,
  isOneShotAutomation,
  isValidCronExpr,
} from "../src/session/automationCron.js";

const MINUTE_MS = 60_000;
/** 固定基准：2026-09-23 本地 08:00:00.000（周三）。 */
const BASE_AT = new Date(2026, 8, 23, 8, 0, 0, 0).getTime();

test("isValidCronExpr accepts five-field expressions and rejects garbage", () => {
  assert.equal(isValidCronExpr("0 21 * * *"), true);
  assert.equal(isValidCronExpr("*/20 * * * *"), true);
  assert.equal(isValidCronExpr("0 0 1 1 *"), true);
  assert.equal(isValidCronExpr("not a cron"), false);
  assert.equal(isValidCronExpr(""), false);
  assert.equal(isValidCronExpr("* * * *"), false);
});

test("computeNextRunAt returns strictly-future minute boundary", () => {
  const next = computeNextRunAt("30 * * * *", BASE_AT);
  assert.equal(next, new Date(2026, 8, 23, 8, 30, 0, 0).getTime());
  // 每分钟任务：下一次必须严格晚于基准（基准正落在分钟边界上）。
  const nextMinute = computeNextRunAt("* * * * *", BASE_AT);
  assert.equal(nextMinute, BASE_AT + MINUTE_MS);
});

test("computeNextRunAt resolves cross-day and weekly schedules", () => {
  // 每天 05:00：下一次与再下一次保持 24h 步进。
  const daily = computeNextRunAt("0 5 * * *", BASE_AT);
  assert.ok(daily !== null && daily > BASE_AT);
  assert.equal(computeNextRunAt("0 5 * * *", daily), daily + 24 * 60 * MINUTE_MS);
  // 每周一 09:00：从周三出发应落在下周一。
  const weekly = computeNextRunAt("0 9 * * 1", BASE_AT);
  assert.equal(weekly, new Date(2026, 8, 28, 9, 0, 0, 0).getTime());
});

test("buildRelativeDelaySchedule materializes delayMinutes into a minute rule", () => {
  const schedule = buildRelativeDelaySchedule(20, BASE_AT);
  assert.equal(schedule.scheduleRule.unit, "minute");
  assert.equal(schedule.scheduleRule.interval, 20);
  assert.equal(schedule.scheduleRule.anchorAt, BASE_AT);
});

test("computeScheduleRuleNextRunAt steps by interval from anchor", () => {
  const schedule = buildRelativeDelaySchedule(30, BASE_AT).scheduleRule;
  const step = 30 * MINUTE_MS;
  // 锚点是创建时刻；首次触发 = 锚点 + 间隔（目标时刻），此后按间隔步进。
  assert.equal(computeScheduleRuleNextRunAt(schedule, BASE_AT - 1), BASE_AT + step);
  assert.equal(computeScheduleRuleNextRunAt(schedule, BASE_AT), BASE_AT + step);
  assert.equal(computeScheduleRuleNextRunAt(schedule, BASE_AT + step), BASE_AT + 2 * step);
});

test("isOneShotAutomation identifies non-recurring single-run tasks", () => {
  assert.equal(isOneShotAutomation({ recurring: false, maxRuns: 1 }), true);
  assert.equal(isOneShotAutomation({ recurring: false }), true);
  assert.equal(isOneShotAutomation({ recurring: false, maxRuns: 3 }), false);
  assert.equal(isOneShotAutomation({ recurring: true, maxRuns: 1 }), false);
});

test("computeAutomationNextRunAt prefers scheduleRule over cronExpr", () => {
  const { cronExpr, scheduleRule } = buildRelativeDelaySchedule(45, BASE_AT);
  const fromRule = computeAutomationNextRunAt({ cronExpr, scheduleRule }, BASE_AT + 10 * MINUTE_MS);
  assert.equal(fromRule, computeScheduleRuleNextRunAt(scheduleRule, BASE_AT + 10 * MINUTE_MS));
  // 无 scheduleRule 时回退 cronExpr。
  const fromCron = computeAutomationNextRunAt(
    { cronExpr: "0 12 * * *", scheduleRule: undefined },
    BASE_AT,
  );
  assert.equal(fromCron, computeNextRunAt("0 12 * * *", BASE_AT));
});
