import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSqliteSessionMigrations } from "../src/storage/session-store/migration-runner.js";
import {
  queryAppUsage,
  refreshUsageRollupHourly,
} from "../src/storage/session-store/repositories/usage.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// 临时文件库跑真实 migration（内存库不支持 WAL）；每例独立建库，造最小明细。
function withUsageDb(run: (db: DatabaseSync, now: number) => void | Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-usage-rollup-test-"));
    const db = new DatabaseSync(join(dir, "db.sqlite"));
    try {
      runSqliteSessionMigrations(db);
      await run(db, Date.now());
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function seedUsage(db: DatabaseSync, now: number): number {
  const h0 = Math.floor(now / HOUR_MS) * HOUR_MS - 2 * HOUR_MS;
  db.prepare(
    `insert into session (id, project_id, slug, directory, title, version, time_created, time_updated, task_type)
     values ('s1', 'pj', 'slug', '/tmp', 't', 1, ?, ?, 'interactive')`,
  ).run(h0, h0);
  // 两条模型请求：各 100 output tokens、首 token→完成 10s、wall 12s。
  const insModel = db.prepare(
    `insert into model_usage (
       id, logical_request_id, session_id, query_source, provider_id, model_id, status,
       started_at, first_token_at, completed_at, duration_ms, output_tokens, computed_total_tokens
     ) values (?, ?, 's1', 'main_turn', 'p', 'm', 'completed', ?, ?, ?, ?, 100, 200)`,
  );
  insModel.run("r1", "lr1", h0, h0 + 2000, h0 + 12000, 12000);
  insModel.run("r2", "lr2", h0 + HOUR_MS, h0 + HOUR_MS + 2000, h0 + HOUR_MS + 12000, 12000);
  db.prepare(
    `insert into tool_usage (id, session_id, tool_call_id, tool_name, status, started_at, completed_at, duration_ms)
     values ('t1', 's1', 'tc1', 'Bash', 'completed', ?, ?, 5000)`,
  ).run(h0 + 1000, h0 + 6000);
  db.prepare(
    `insert into turn_usage (session_id, turn_id, status, started_at, completed_at, duration_ms)
     values ('s1', 'turn1', 'completed', ?, ?, 30000)`,
  ).run(h0, h0 + 30000);
  return h0;
}

test(
  "queryAppUsage aggregates rate days in the local-day frame for positive offsets",
  withUsageDb(async (db, now) => {
    seedUsage(db, now);
    const tz = 8 * HOUR_MS;
    const result = await queryAppUsage(db, { since: 0, until: now + HOUR_MS, tzOffsetMs: tz });
    // 回归点：曾用 UTC since/until 过滤 rollup，东八区会把当前本地日的桶整段截掉。
    const lastDay = result.rateDays.at(-1);
    assert.ok(lastDay, "rate day expected");
    assert.equal(lastDay.outputTokens, 200);
    assert.equal(lastDay.generationMs, 20_000);
    assert.equal(lastDay.modelRequestMs, 24_000);
    assert.equal(lastDay.toolExecutionMs, 5_000);
  }),
);

test(
  "queryAppUsage keeps the local-day frame consistent for negative offsets",
  withUsageDb(async (db, now) => {
    seedUsage(db, now);
    const result = await queryAppUsage(db, {
      since: 0,
      until: now + HOUR_MS,
      tzOffsetMs: -7 * HOUR_MS,
    });
    assert.equal(
      result.rateDays.reduce((sum, day) => sum + day.outputTokens, 0),
      200,
    );
  }),
);

test(
  "queryAppUsage returns dense 24 hourly buckets mapped to local hours",
  withUsageDb(async (db, now) => {
    const h0 = seedUsage(db, now);
    const tz = 8 * HOUR_MS;
    const dayIndex = Math.floor((h0 + tz) / DAY_MS);
    const hourlyDate = new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
    const result = await queryAppUsage(db, {
      since: 0,
      until: now + HOUR_MS,
      tzOffsetMs: tz,
      hourlyDate,
    });
    assert.equal(result.rateHours?.length, 24);
    const active = (result.rateHours ?? []).filter((bucket) => bucket.outputTokens > 0);
    // 两个 UTC 小时（now-2h/now-1h）映射为本地 +8 的两个整点小时，各 100 tokens / 10s。
    assert.equal(active.length, 2);
    assert.ok(active.every((bucket) => bucket.outputTokens === 100 && bucket.generationMs === 10_000));
    assert.notEqual(active[0]?.hour, active[1]?.hour);
  }),
);

test(
  "refreshUsageRollupHourly is idempotent across repeated merges",
  withUsageDb((db) => {
    seedUsage(db, Date.now());
    refreshUsageRollupHourly(db);
    const first = db
      .prepare("select sum(output_tokens) as out from usage_rollup_hourly")
      .get() as { out: number };
    refreshUsageRollupHourly(db);
    const second = db
      .prepare("select sum(output_tokens) as out from usage_rollup_hourly")
      .get() as { out: number };
    assert.equal(Number(first.out), 200);
    assert.equal(Number(second.out), 200);
  }),
);
