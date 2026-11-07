---
kind: upgrade-guide
description: "会话可原地改写一条已发送的人工消息；Remote 与 SDK 调用方必须处理新的编辑端点及其拒绝码。"
---

# 人工消息编辑与投影回退

[English](guide.md) | 中文

## 变更

`session.editMessage` 会原地改写一条已发送的人工提示词。该次改写是一条来源为 `user-edit` 的 `user/message` surface 替换：它会遮蔽被编辑的消息以及其后所有模型可见节点，而改正后的文本经普通 prompt 准入重新进入，因此下一轮次回答的是改写后的问题。排在被改写消息之后的待处理 inbox 条目会被移除并上报。作废操作保持日志只追加：编辑丢弃的事件仍然持久且可按位置读取，因此旧版本仍可打开这样的 Session。它会用早已为 compaction 实行的 surface 规则折叠这条替换，保留被丢弃轮次的派生状态，并且不显示编辑标记，因此不需要变更 Session 格式版本。

持有可被改写对话重新创建的投影单元现在声明 `rewindable: true`，注册表会把被作废的事件从其折叠中排除。不由对话拥有的取值——有效工作目录、权限预设、所选模型、轮次编号、标题、token 计量——保持当前值，而被丢弃轮次已经完成的文件、进程与外部调用仍然有效。

## 迁移

1. Remote 与 SDK 调用方需在自己实现或打桩的每个 Session 接口上增加 `session.editMessage({ sessionId, targetSeq, content })`：Client 测试替身在测试提供实现之前会抛出异常，LiveShare 观看方对新端点会收到 `owner-only` 拒绝。
2. 对返回的 `session/edit-rejected` 错误的 `code` 分支处理：`MESSAGE_EDIT_TURN_RUNNING`、`MESSAGE_EDIT_TARGET_NOT_ON_SURFACE`、`MESSAGE_EDIT_TARGET_NOT_USER`、`MESSAGE_EDIT_CONTENT_EMPTY` 或 `MESSAGE_EDIT_ATTACHMENT_NEW`。改写要求 Session 空闲，因此需先停止正在运行的轮次。
3. 日志消费方继续为未知 `MessageSourceMap` 取值保留 fall-through。`user-edit` 不引入新事件类型，忽略它的消费方仍能重建模型历史；编辑标记不一致的持久投影 checkpoint 会从头重折，而不再做后缀回放。
