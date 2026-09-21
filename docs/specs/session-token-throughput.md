# Session token throughput（会话 token 效率）

Status: spec；实现随本 spec 落地。

## 产品规则

会话内两个互补的 token 效率指标：

1. **权威轮级/会话级 TPS**（完成后可查）：`输出 token 数 / 生成时长`。
   - `生成时长 = durationMs - timeToFirstContentMs`（首内容 token 到请求完成，不含排队与首 token 延迟），与既有 `calculateOutputTps` 同口径。
   - 会话级为 token 加权平均 `Σ outputTokens / Σ generationDurationMs`，只统计能算出同源生成时长的完成轮；不用简单算术平均。
   - 数据源：CLI `model_request_completed` 且 `querySource === "main_turn"` 的网络状态事件（既有 session-debug 旁路的同一事件流）。
2. **流式中实时速率**（生成中可见，估算值）：UI 基于 v4 流式行（`assistantText`/`reasoning`，`state === "streaming"`）的 append 文本增长估算。
   - 折算：CJK 字符 ≈ 1 token/字，其他字符 ≈ 1/4 token/字（双语输出下的粗估）。
   - 展示必须带 `≈` 前缀；滚动窗口 4s；窗口内无新增文本（工具调用/思考间隙）时隐藏，不显示 0。
   - 流式轮完成后该估算自然消失，权威值以会话汇总形式在开发者工具可查；两者不同时展示同一数字，互不替代。

## 所有权与边界

- 权威 TPS 事实唯一所有者：CLI session-debug 旁路（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/session-debug.ts`）。沿用其"旁路记录跟随 CLI record 回收，不挂聊天投影"的边界，不新增第二条写入路径。
- 流式实时速率唯一所有者：UI hook（`packages/ui/src/v4/useStreamingTokenRate.ts`）。它是瞬时态：不入 Zustand、不持久化、不回写、不参与重连/恢复语义；v4 投影 store 仍是消息文本的唯一所有者，hook 只读 `snapshot.rows.window`。
- 协议面：仅扩展 session-debug 查询响应（`sessionDebugSnapshotSchema.throughput`，optional additive）；不改 v4 帧协议、不改快照 schema、不引入新 RPC。
- UI 展示位：开发者工具面板 summary（权威值）；composer 发送/停止控制簇（估算值，仅 stop 控件可见时渲染）。

## 接口

```ts
// packages/shared/src/session-debug.ts（additive，optional 保证旧 CLI 响应可解析）
sessionDebugThroughputSchema = {
  countedRounds: count, // 参与统计的完成轮数
  totalOutputTokens: count, // Σ outputTokens（仅计入有生成时长的轮）
  totalGenerationMs: count, // Σ generationDurationMs
  avgTokensPerSecond: count.nullable(), // Σoutput/Σduration；无有效轮时 null
  lastTokensPerSecond: count.nullable(), // 最近有效完成轮
};
```

```ts
// packages/ui/src/v4/useStreamingTokenRate.ts
useStreamingTokenRate(snapshot: ConversationSnapshot | null): number | null
// 返回窗口期估算 token/s（保留 1 位小数）；无流式行或窗口无增长时返回 null。
```

## 时序与失败语义

- CLI 累积发生在 `observeSessionDebug` 的 completed 分支，与 rounds/cache 同一事件顺序、同一去重键（`requestId`）；跟随 WeakMap 随 session record 回收，无持久化。
- `throughput` 为纯累积值，无重置入口；开发者工具数据本就是旁路诊断面，不承诺跨进程一致。
- UI hook 以 500ms 节拍采样（复用 elapsed-clock 的 interval 心跳模式）；采样与展示解耦，快照替换/断档恢复（recovery 重放）导致文本回退时重置基线并清空窗口，宁可短暂无数字也不显示错误速率。

## 验收场景

- 同一会话完成多轮后，开发者工具 summary 显示会话平均与最近一轮 TPS，数值等于 Σoutput/Σduration（含 `timeToFirstContentMs` 缺失轮被跳过的情况）。
- 旧 CLI 响应（无 `throughput` 字段）在新 UI 解析不报错，面板对应项显示 `-`。
- 流式生成中 composer 停止按钮旁出现 `≈ xx token/s`；工具调用执行、流结束或停滞超过窗口后消失。
- 纯函数测试覆盖：加权平均口径、缺失时长轮跳过、CJK/非 CJK 折算、窗口停滞返回 null。
