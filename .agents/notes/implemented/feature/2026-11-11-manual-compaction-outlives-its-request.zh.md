# Agent Note: 手动压缩活过发起它的那次请求

状态：implemented

[English](2026-11-11-manual-compaction-outlives-its-request.md) | 中文

## 问题

手动 `/compact` 会把浏览器的请求一直占到摘要模型跑完，于是 `compaction/basic` 的 seam 收到的是发起分发的 UI 请求的取消信号。Web 宿主在连接关闭时会不带原因地中止请求信号，而命令执行器又把处理器结果与同一个信号赛跑。于是关闭或刷新页面就会取消一次预填充已经付出代价的压缩：持久的尝试在摘要中途死去，会话里只留下一句光秃秃的 `This operation was aborted`，而每次重试都要重新预填充。长上下文上的一次手动压缩要消耗几分钟模型时间，所以这不是一个装饰性的取消。

## 决策

- `CompactionEngine.compactNow(agent, signal, sourceCommandId)` 同步给出预约结果，并返回 `ManualCompactionStart`：一旦保留住 agent 的 idle task 且选出有效范围，就是 `{ kind: `"running`", done }`；没有有效范围时是 `{ kind: `"nothing`" }`。`done` 在持久的 `compaction/start` ... `compaction/end` 标记对闭合时落定，并用一个原本等待完整尝试的调用者本会看到的同一个 `ManualCompactionError` 拒绝。
- 命令在这次预约处返回，且不等待 `done`。它用自己的 `AbortController` 承载这次尝试，而不是用请求的信号，因此该操作承认的取消只剩两种：agent 的停止（它会中止 maintenance 任务）和进程拆除。`dsh-command-compact` 会把脱离后的失败写日志；持久的标记对本身已经报告了它。
- 对话界面从标记对读取尝试状态：没有落地检查点的 `compaction/start` 呈现为进行中，携带 `error` 的 `compaction/end` 呈现为失败并带上那句已记录的原因。手动命令的结算不再写 `sourceEventSeq`；关联关系继续放在每个 `compaction/*` 事件本来就带的 `sourceCommandId` 里。
- 持久格式没有变化：没有新会话事件、没有新字段、没有格式版本步进，空操作尝试仍然不写标记对。移动的只是已记录的 `command/done` 文本与位置，因此 `snapshots/sdk/manual-compact` 是手工重排的，必须再用密钥重录一次确认。
- `/export` 保留原有绑定。它的结算内容就是产物本身，所以生命归它自己归发起它的那次请求。

## 考虑过的替代方案

**只给请求信号的 abort 带上原因，并显示 `Compaction cancelled.`。** 最便宜，也确实提升可诊断性，但它仍然丢掉一次已经付出长预填充代价的尝试。带原因的 abort 本身仍然值得单独做。

**保持请求绑定，让 Client 重新挂接到正在运行的尝试。** 那需要一套与请求无关的任务身份，外加进度与取消端点，等于把持久标记对与 agent 停止已经提供的东西再做一份。

**只对 Web 路径立即返回。** SDK 与 CLI 调用方本来就从 `done` 拿到完整核算。按调用者拆分行为会让同一条命令拥有两种生命周期和两种失败面，却换不来好处。

**异步等待预约，而不是同步完成它。** 在 `runMaintenance` 之前任何 await 都会重新打开一个窗口，在那里命令分不清 `busy` 与已经开始的尝试，而命令必须在返回前给出这个答案。

## 后果

手动压缩现在可以在发起它的页面消失之后继续消耗模型时间，而要停下它得显式按停止，不是靠一次导航。成功核算（被替换条目数与估算 token 数）出现在落地的检查点行上，而不是命令行上。`compactNow` 签名属于未稳定期的宿主 seam 改动：它唯一的消费方（命令）与三个测试引擎一起改了，生成的 `api-catalog` 与 `docs/subsystems/compaction` 签名区块已重新生成。脱离的尝试在拆除时仍会停稳，因为 `dsh-command-compact` 继续跟踪这些 operation promise，并在 dispose 完成前排空它们。

## 测试

`packages/compaction/compaction-basic/tests/manual-compaction.spec.ts` 证明摘要仍在进行中时预约已经答完，证明操作在标记对闭合前不落定，证明空操作回答 `nothing` 且不写入，也证明取消与失败分类照样送达。`packages/compaction/command-compact/tests/command-compact.spec.ts` 证明命令在预约处回答，证明它传下去的信号不是请求信号且请求离开后也不会被中止，证明 busy 与无历史直接给出结果，并证明它会记日志、会在销毁前排空脱离的尝试。`packages/client/ui-chat/tests/compaction-command-card.client.spec.ts` 与 `conversation-node-definitions` 的用例证明这一行会从标记对事件读出进行中、失败与已落地三种状态。
