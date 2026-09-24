# Session token throughput（会话 token 效率）

Status: spec；实现随本 spec 落地（第二版：composer 双表盘常驻；第三版：轮级工时拆分 workTiming）。

## 产品规则

会话内两个互补的 token 效率指标，像骑行运动手表一样**双表盘常驻**展示在 composer：

1. **实时速度**（流式输出中可见，估算值）：UI 基于 v4 流式行（`assistantText`/`reasoning`，`state === "streaming"`）的 append 文本增长估算。
   - 折算：CJK 字符 ≈ 1 token/字，其他字符 ≈ 1/4 token/字（双语输出下的粗估）。
   - 滚动窗口 4s；估算值 > 0 时带 `≈` 前缀（粗估标识）。
   - 输出结束、用户手动停止或流停滞（窗口无增长）时**显示 0 并保留，不隐藏**：估算器在停滞时返回 null（口径不变），由 chip 显示层把 null 映射为精确值 `0`（无 `≈` 前缀）。实时读数只在会话视图渲染，草稿态（snapshot 为 null）不渲染。
2. **平均速度**（会话级权威值）：同一会话内只按调大模型的生成时间加权的平均 token/s。
   - `平均 = Σ outputTokens ÷ Σ 生成时长`，`生成时长 = 首 token（首个非空 text/reasoning delta）→ 请求完成`，不含工具执行、轮间等待、用户思考时间与首 token 延迟；与 session-debug 旁路 `calculateOutputTps` 同口径（token 加权，不做简单算术平均）。
   - 仅 `querySource === "main_turn"` 的主轮完成计入；compact、标题生成、验证等旁路调用不计入（与 cacheHit 同门槛）。
   - **常驻显示在主界面 composer**（不再只藏在开发者工具）；首轮完成前显示 `—`；每轮完成后更新并维持固定值，直到下一轮完成。
   - 开发者工具面板的 TPS 明细保持现状（debug 旁路不动），可与常驻平均值对账。

## 所有权与边界

- **平均速度事实唯一所有者：CLI core runtime 聚合器**（`runtime.mainTurnThroughputAggregate`）。在主轮 `ModelComplete` 发射点累积（与 cacheHit 同一位置），经 `ModelComplete.throughput` → bootstrap product-projection 写入 v4 快照 `usage.throughput` → UI 只读 `snapshot.usage.throughput`。UI 不自行累计、不回写。
- session-debug 旁路（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/session-debug.ts`）保持独立累积与展示边界不变：它是诊断明细面（rounds/network 列表），与 core 聚合器同事件源、同口径、互不写入；对账时数值一致（允许毫秒级事件时点差异）。
- 实时速度唯一所有者：UI hook（`packages/ui/src/v4/useStreamingTokenRate.ts`）。它是瞬时态：不入 Zustand、不持久化、不回写、不参与重连/恢复语义；v4 投影 store 仍是消息文本的唯一所有者，hook 只读 `snapshot.rows.window`。
- 协议面：`ModelCompletePayload.throughput`（contracts，additive optional）与 `sessionUsageStateSchema.throughput`（shared，additive + default null）。不改 v4 帧协议、不引入新 RPC。
- UI 展示位：composer 发送/停止控制簇左侧的双读数 chip（`实时 {live} · 平均 {avg} token/s`）；chip 与 memo 的 submitControlNode 为兄弟节点，速率高频变化不重建控制簇子树。

## 接口

```ts
// apps/zcode-cli/packages/core/src/runtime/types.ts
MainTurnThroughputAggregate = {
  countedRounds: number; // 参与统计的完成轮数
  totalOutputTokens: number; // Σ outputTokens（仅计入有效轮）
  totalGenerationMs: number; // Σ 生成时长
};
// runtime.mainTurnThroughputAggregate —— 与 mainTurnCacheHitAggregate 同位置初始化（internal.ts / agent-runtime.ts）
```

```ts
// apps/zcode-cli/packages/core/src/runtime/methods/turn-model-step-usage.ts
recordMainTurnThroughput(runtime, {
  startedAt,                // model step 开始时间（诊断保留字段）
  events,                   // state.events；firstTokenAt 用导出的 firstModelTokenAt(events, networkEventStartIndex) 取
  networkEventStartIndex,
  usage,                    // result.usage；outputTokens 缺失时整轮跳过
}): { countedRounds, avgTokensPerSecond: number | null, lastTokensPerSecond: number | null } | undefined
// generationMs = Date.now() - firstTokenAt；缺 firstTokenAt、缺 outputTokens 或 generationMs ≤ 0
// 时返回 undefined（整轮跳过，不污染累计）。
```

```ts
// apps/zcode-cli/packages/contracts/src/events/session.events.ts（additive，对齐 cacheHit 风格）
ModelCompletePayload.throughput?: {
  countedRounds: number;
  avgTokensPerSecond: number | null;
  lastTokensPerSecond: number | null;
};
```

```ts
// packages/shared/src/zcode-protocol-v4/snapshot.ts（additive + default，旧快照/旧 CLI 可解析）
sessionUsageStateSchema.throughput = z
  .object({
    countedRounds: count,
    avgTokensPerSecond: count.nullable(),
    lastTokensPerSecond: count.nullable(),
  })
  .strict()
  .nullable()
  .default(null);
```

```ts
// packages/ui/src/v4/StreamingTokenRateChip.tsx
// 双读数映射（纯函数，便于单测）：live>0 → "≈ x.x"，live=0 → "0"；avg=null → "—"，avg>0 → "x.x"
```

## 时序与失败语义

- CLI 累积发生在主轮 ModelComplete 发射点（`querySource === "main_turn"` 时调用 `recordMainTurnThroughput`），早于事件 append；payload 携带累积后汇总。事件重放（hydration）按事件序重放同一累积，恢复快照值。
- 快照 `usage` 是 `state.updated` patch 的整体替换对象：`onModelComplete` 写入 `payload.throughput ?? 既有值`（缺值轮不抹掉已累计平均）；其余 usage 写入点（seedUsage 两处、onModelSelected、compact 成功回落）必须透传既有 `throughput`，漏一处即把值抹掉（TS 必填字段在编译期兜底）。
- 聚合器是 CLI 进程内事实：**不跨 CLI 重启持久化**（cacheHit 的消息级重建依赖 message tokens，生成时序没有对应持久化字段，故 resume/rewind 也不重建，重启后从零累积，快照回落为 null → UI 显示 `—`）。
- `throughput` 为纯累积值，无重置入口。
- UI hook 以 500ms 节拍采样；快照替换/断档恢复（recovery 重放）导致文本回退时重置基线并清空窗口。实时读数的 null（无流式行/停滞）由 chip 映射为 `0`，估算器本身语义不变。

## 验收场景

- 会话视图 composer 常驻显示「实时 x · 平均 y token/s」；草稿态不显示。
- 流式生成中实时值持续变化（带 `≈`）；点停止/输出结束后实时值归 0（无 `≈`）且 chip 仍在。
- 首轮完成前平均为 `—`；每轮完成后更新并固定；多发消息后平均值只反映模型生成时段（可用开发者工具 TPS 明细对账）。
- compact、标题生成等旁路调用不改变平均值。
- 旧快照（usage 无 throughput 字段）经新 schema 解析得到 `throughput: null`，UI 平均显示 `—`；旧 CLI 的 ModelComplete（无 throughput payload）不抹掉快照已有值。
- 纯函数测试覆盖：core 累积器（缺值轮跳过、token 加权平均、last 值）、schema 旧快照兼容解析、chip 的 null→0 / avg `—` 映射；既有 streamingTokenRate 10 例保持通过。

## 轮级工时拆分（workTiming，第三版）

### 产品规则

轮历史触发行「已工作 {duration}」追加速率与工时归因，回答「瓶颈在本地还是大模型」：

- **运行中（工作中）**：主行 `工作中 {duration} · 实时 {live} · 平均 {avg} · 思考 {think} token/s`。
  - 实时：对该轮流式行的本地估算（复用 `StreamingRateEstimator`，行级 hook 独立 500ms 采样，重渲染隔离在状态行内）。
  - 平均：**自会话开始的活跃工时平均** = 会话累计 outputTokens（`usage.cumulative`）÷（Σ 已完成轮 `turnHeader.activeMs` + 当前运行轮已进行时长），与完成后「整体」同口径（排除用户输入等待）、跨轮累计；completedActiveMs 只统计 rows 窗口内的轮头，超长会话为近似值。
  - 思考平均：会话累计生成口径（`usage.throughput.avgTokensPerSecond`，与 composer「平均」同源同值；首轮完成前显示 `—`）。
  - 悬停注明两个口径与切换时机（本轮结束后均切换为本轮权威数据）。
  - 注入方式：SessionPane 在 Timeline 外层经 `ConversationRunningWorkRateContext`（facts：思考平均 + tokens + completedActiveMs）注入；整体平均的除法在状态行内按每秒跳动的 durationMs 现算。context 更新穿透 memo 只重渲染状态行，不给 Timeline 增加高频 prop。
- **完成后（已工作）**：主行直接常驻双速率 `已工作 {duration} · 整体 {overall} · 思考 {model} token/s`（不藏悬停）；任一速率缺事实时降级为单速率或纯时长。
- 悬停（title）与展开的历史区头部常显同款拆分行（触屏/无 hover 兜底）：
  `本地执行 {local} · 模型请求 {model} · 思考 {modelRate} token/s（并行时段累计）`。
- 口径：
  - **整体速率（轮）** = 轮 outputTokens ÷ `turnHeader.activeMs`（权威工时，已排除权限/用户输入等待）。
  - **思考速率（轮）** = 轮 outputTokens ÷ Σ 模型请求 wall 时长（`durationMs`，含首 token 等待与失败请求）；文案用「思考」指代模型交互时段，tooltip 以「模型请求」注明实际口径。
  - **本地执行时长** = Σ 每次工具调用 `duration`；**模型请求时长** = Σ 每次模型请求 `durationMs`。并行工具、streaming-tool 与模型流重叠时按**累计口径**（重复计入），UI 注明，不冒充 wall 时长。
  - 任一时长为 0 或 tokens 缺失时对应速率不显示（undefined，不显示 0）。
- 轮级 outputTokens 复用 `TurnCompletePayload.usage`（`createModelUsageSummaryFromEvents` 轮级汇总，与 turn_usage 同源）。

### 所有权与边界

- **事实唯一所有者：CLI core runtime**。聚合函数（`usage-observability.ts`）在 TurnComplete 发射点从轮事件流计算 Σ`model_request_completed/failed.durationMs` 与 Σ`ToolCallResult.duration`，随 `TurnCompletePayload.workTiming`（additive optional）下发。
- 接线点：`turn.ts` 成功路径与 hook 阻断路径、`turn-errors.ts` 取消路径（TurnComplete resultType:"cancelled"）。control-only、compact、rewind 的合成 TurnComplete 不带 workTiming（无真实模型/工具工作）。
- 投影：bootstrap `product-projection.onTurnComplete` 把 `payload.workTiming` 写入 v4 `turnHeaderRow.workTiming`（additive optional）；`splitProductTurn` 不拆分——workTiming 是整轮口径，guide 分段不细分。旧快照缺字段 → optional 解析为缺席，UI 回退现状显示。
- UI 只读派生：`conversationTurnWorkSegments` 以纯函数由 `header.workTiming` + `activeMs` + tokens 派生速率；不自行累计、不回写、不入 Zustand。
- 协议面：`TurnCompletePayload.workTiming`（contracts）、`zcodeTurnCompletedEventPayloadSchema.workTiming`（shared 旧协议，additive optional）、`turnHeaderRowSchema.workTiming`（v4 rows，additive optional）。不改帧协议、不引入新 RPC、不动 turn_usage 表结构与 session-debug 旁路。

### 接口

```ts
// apps/zcode-cli/packages/contracts/src/events/session.events.ts（additive optional）
TurnCompletePayload.workTiming?: {
  modelRequestMs: number;   // Σ 模型请求 wall 时长（completed + failed）
  toolExecutionMs: number;  // Σ 工具调用 duration（累计口径）
};

// apps/zcode-cli/packages/core/src/runtime/methods/usage-observability.ts
aggregateTurnWorkTiming(events): { modelRequestMs: number; toolExecutionMs: number }

// packages/shared/src/zcode-protocol-v4/rows.ts（additive optional）
turnHeaderRowSchema.workTiming?: {
  modelRequestMs: number; toolExecutionMs: number;
}
```

### 验收场景

- 运行中的轮：主行显示 `工作中 {duration} · 实时 ≈x.x · 平均 y · 思考 z token/s`；流式生成中实时值变化，停滞/结束后归 0；平均随会话 tokens/工时累计更新，首轮完成前平均与思考均为 `—`。
- 完成一轮含工具调用的对话：主行显示 `已工作 X · 整体 Y · 思考 Z token/s`；悬停与展开区显示 `本地执行 A · 模型请求 B · 思考 C token/s（并行时段累计）`。
- 用户中途取消的轮（resultType:"cancelled"）同样带 workTiming 与双速率。
- 旧 CLI（payload 无 workTiming）与旧快照（rows 无 workTiming）：UI 回退现状文案，不报错。
- 纯函数测试：聚合器（多请求/多工具累加、失败请求计入、缺 duration 跳过）、速率派生（任一时长 0 → 速率 undefined）、完成态标签降级（双速率→单速率→纯时长）、schema 旧数据兼容。
