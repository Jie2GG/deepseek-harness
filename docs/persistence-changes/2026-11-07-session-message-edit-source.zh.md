---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-07-session-message-edit-source

[English](2026-11-07-session-message-edit-source.md) | 中文

## 概述

新增 `user-edit` 人工消息来源，用于记录对一条已发送提示词的原地改写；改写表现为一条 `user/message` surface 替换，覆盖被编辑的消息及其后的全部节点。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-07-session-message-edit-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "7e5471a381b841f9f0f67f9b7b27a7d01533ccbb65bf0fff22dde211deaa1d8c"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "ec59e5b97a9cc2b823651f26cb31dc548dad76d9b1ad22bd14c13ae88ef40a57"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "39827ba1abe4fdb8d324b721eb18e5c46c349861e40f65a512ea9ab1c6083ef0"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "fc00d685d1b2ce66ae9624eb3de219cb7ea7509203fa94336e22432f6539f9ad"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

旧读取方会遇到它不认识的 `source.kind` 的 `user/message` 事件。消息来源是可声明合并的联合类型，消费方按 `kind` 分支并为未知值保留fall-through 语义，因此该记录仍是 `user/message`，其位置替换由旧读取方为压缩早已实行的 surface 规则折叠：改正后的句子进入模型历史，被替换的范围不再贡献内容。旧读取方没有投影编辑屏障，其按 key 的值仍会统计被丢弃的轮次，这是该读取方在屏障之前的既有行为，而非不安全解读。新读取方遇到不含 `user-edit` 的日志时，联合类型没有变化，折叠结果与之前完全一致。

<a id="verification"></a>
## 验证

packages/core/session/tests/message-edit.spec.ts 固定被遮蔽的 surface 范围、编辑窗口、必须覆盖到尾部要求，以及对已被编辑消息的再次改写。packages/session/session-projection/tests/message-edit-rewind.spec.ts 固定回退单元、保持取值的设置单元、迟到注册，以及按编辑切点打标记的检查点行。packages/core/agent-loop/tests/message-edit.spec.ts 固定仅限空闲时编辑、清空排队输入，以及历史从改正后的文本继续。

<a id="dev-note"></a>
## 开发备注

无。
