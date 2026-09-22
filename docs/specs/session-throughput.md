# 规范：当前会话实时 Token Throughput（tokens/s）

## 1. 背景与目标

Agent 聊天场景下，用户希望像 Hermes 那样感知「当前 session 的 token 效率」，以 tokens/s
（每秒输出 token 数）作为生成速度的实时指标。

已有的能力：

- CLI 端 `calculateOutputTps(outputTokens, generationDurationMs)`（`packages/shared/src/session-debug.ts:86`）
  实现了同源算法，但只用于开发者调试面板（DeveloperToolsPane）。
- v4 协议 `ModelRequestCompletedStatusEvent`（`contracts/src/model/index.ts:210`）已携带
  `durationMs`、`usage`、`timeToFirstContentMs`，计算 TPS 的原料齐全。
- v4 投影的 `sessionUsageState`（`shared/src/zcode-protocol-v4/snapshot.ts:176`）承载会话级用法状态，
  通过 `state.updated` 下发，UI 已消费 `contextWindow/cumulative`（`V4ComposerToolbar.tsx`）。

本次新增一个「当前会话实时生成速度」指标，补齐聊天主界面的性能可见性。

## 2. 关键定义

- **生成速度（throughput）**：单个主轮次（main_turn）内 `outputTokens ÷ generationDurationMs`，
  单位 tokens/s。`generationDurationMs = durationMs − timeToFirstContentMs`（首出后耗时，
  排除首 token 等待，与 `calculateOutputTps` 一致）。
- **当前会话实时值**：最近一次完成的 main_turn 的 tokens/s。无完成轮次（纯输入、刚新建会话）时为 `null`。
- **非目标**：不做流内分段估算（chunk 级 TPS）；只用轮次级完成事件，保证数值与开发者面 TPS 同源可比。

## 3. 数据流与状态所有权

单一所有者：`product-projection.ts` 的 `ConversationProjection` 是会话级状态的唯一所有者。

事件顺序（desktop continuous 实时链路 / mobile replayable 恢复链路均适用）：

1. CLI `ModelStreaming` 首个 `text_delta/reasoning_delta` → core 记录 `firstModelTokenAt`（`usage-observability.ts:373`）。
2. `ModelRequestCompletedStatusEvent` 到达 bootstrap（`model_request_completed`，带 `durationMs` / `usage` / `timeToFirstContentMs`）。
3. `product-projection.ts` 在 main_turn 的 `ModelComplete` 处理中累计 `outputTokens` 与 `generationDurationMs`，
   计算 `recentTps`，随 `usage` 状态一起通过 `state.updated` 下发。
4. UI `V4ComposerToolbar` 读取 `sessionUsageState.cumulative` / `contextWindow` 的同时读取 `recentTps`，渲染 token/s 徽章。
5. `recentTps` 在 `ModelComplete` 结算前为 `null`（生成中），结算后瞬间更新，随后随下次 `ModelRequestStarted` 清零（避免过期值悬挂）。

```text
ModelRequestCompleted ──┐
                        ▼
              product-projection (owner)
                        │  累计 outputTokens / duration → recentTps
                        ▼
            state.updated(usage.recentTps) ── UI 徽章显示（null → 隐藏）
```

## 4. 接口

### 4.1 协议类型（`shared/src/zcode-protocol-v4/snapshot.ts`）

`sessionUsageStateSchema.cumulative` 新增可选字段：

- `recentOutputTokens`: 最近 main_turn 的 outputTokens（累计到当前轮次）。
- `recentTps`: 最近 main_turn 的生成速度（tokens/s），`number | null`。

conflation 策略：与 `cumulative` 现有字段一致——值未变不下发。`recentTps` 由 CLI 生产端计算后写入，UI 只读。

### 4.2 CLI 投影（`bootstrap/.../product-projection.ts`）

`ConversationProjection` 新增侧状态（不进入 schema 持久化）：

- `currentTurnOutputTokens: number` — 当前 main_turn 累计 outputTokens。
- `currentTurnDurationMs: number` — 当前 main_turn 累计生成时长（首出后）。
- 在 main_turn `ModelComplete` 处理处（`onModelComplete` / `ModelComplete` 负载）：用本次 `usage.outputTokens` 和
  `ModelRequestCompleted` 的 `durationMs − timeToFirstContentMs` 更新侧状态，计算 `recentTps`，随 `usage` patch 一起下发。
- 在 main_turn `ModelRequestStarted` 处重置侧状态、清零 `recentTps`（新轮次开始时）。
- 会话重置/新建会话时重置。

### 4.3 UI（`packages/ui/src/v4/composer/V4ComposerToolbar.tsx`）

- `taskUsage` 旁新增 token/s 小徽章，值来自 `snapshot.usage.cumulative.recentTps`。
- 值为 `null` 时不渲染（与 context meter 共用显隐逻辑：会话无完成轮次时隐藏）。
- 格式：`> 1` 显示 `{value.toFixed(1)} tokens/s`；`0 < value ≤ 1` 显示 `1 token/s`；`null` 不显示。

### 4.4 i18n（`packages/ui/src/i18n/locales/zh-CN.ts`、`en-US.ts`）

新增 message id：

- `chat.throughput`: `生成速度 {value} tokens/s`（zh-CN） / `Throughput {value} tokens/s`（en-US）。
- `chat.throughputTooltip`: 提示文案，说明算法口径（output tokens ÷ 首出后耗时）。

## 5. 验收场景

1. **新建会话**：未完成轮次，工具条无 token/s 徽章（`recentTps = null`）。
2. **主轮次生成中**：`ModelRequestCompleted` 未到达前徽章隐藏；到达后瞬间显示正确数值。
3. **数值口径**：手动复算 `outputTokens / (durationMs − timeToFirstContentMs)` 与 UI 显示一致。
4. **轮次切换**：新主轮次开始后旧值清零，新轮次完成后再更新为新值。
5. **子代理轮次**：`querySource !== main_turn` 的 ModelComplete 不计入主会话 throughput（与存量 `recordModelUsage` 口径一致）。
6. **DeveloperToolsPane**：已有 TPS 列数值不受影响（数据源为 session-debug，独立快照）。

## 6. 范围与边界

- 不修改 `sessionUsageStateSchema` 的既有字段语义；新增字段均为可选，后向兼容。
- 不新增协议方法、不改 `ModelRequestCompletedStatusEvent` 字段（已在 CLI 侧可用）。
- 不改存量 usage-stats / quota 快照逻辑。
- 桌面端 continuous 与移动端 replayable 共享同一份状态下发，消费方式一致。

## 7. 待办/非目标

- 流内分段速率（chunk 级）不在本轮范围——用户能感知的是轮次级完成速度。
- 不把 throughput 用于速率限制或调度决策（纯展示）。
