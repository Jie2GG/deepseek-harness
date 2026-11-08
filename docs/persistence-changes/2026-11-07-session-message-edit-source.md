---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-07-session-message-edit-source

English | [中文](2026-11-07-session-message-edit-source.zh.md)

## Summary

Adds the `user-edit` human-message source, which records one in-place rewrite of a sent prompt; the rewrite is one `user/message` surface replacement over the edited message and its tail.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

An old reader meets a `user/message` event whose `source.kind` it does not name. Message sources are a merge-extensible union that consumers switch on with a documented fall-through, so the record keeps its `user/message` identity and its positional replacement is folded by the surface rules an old reader already runs for compaction: the corrected sentence enters model history and the replaced range stops contributing. An old reader folds no projection edit barrier, so its per-key values keep counting the discarded turns, which is that reader's pre-barrier behavior rather than an unsafe interpretation. A new reader meeting a log without `user-edit` records finds the union unchanged and folds exactly as before.

<a id="verification"></a>
## Verification

packages/core/session/tests/message-edit.spec.ts pins the shadowed surface range, the edit window, the tail requirement, and a second rewrite of an already edited message. packages/session/session-projection/tests/message-edit-rewind.spec.ts pins a rewound unit, a settings unit that keeps its value, late registration, and the checkpoint row stamped at the edit cut. packages/core/agent-loop/tests/message-edit.spec.ts pins the idle-only rule, queue clearing, and history continuing from the corrected text.

<a id="dev-note"></a>
## Dev Note

None.
