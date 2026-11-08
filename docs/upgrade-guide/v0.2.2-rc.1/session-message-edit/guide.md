---
kind: upgrade-guide
description: "A Session can rewrite one already-sent human message; Remote and SDK callers must handle the new edit endpoint and its rejection codes."
---

# Human-message edit and the projected rewind

English | [中文](guide.zh.md)

## Change

`session.editMessage` rewrites one already-sent human prompt in place. The rewrite is one `user/message` surface replacement whose source is `user-edit`: it shadows the edited message and every later model-visible node, and the corrected text re-enters through ordinary prompt admission, so the next turn answers the rewritten question. Pending inbox items that followed the edited message are removed and reported. Voids keep the log append-only: events the edit discards stay durable and readable by position, so an older release still opens such a Session. It folds the replacement with the surface rules it already runs for compaction, keeps the discarded turns' derived state, and shows no edit marker, so no Session format version change is required.

Projection units holding state a rewritten conversation re-creates now declare `rewindable: true`, and the registry omits voided events from their fold. Values the conversation does not own — effective directory, permission preset, selected model, turn numbering, title, and token metering — keep their current values, and files, processes, and external calls the discarded turns already performed stay done.

## Migration

1. Remote and SDK callers add `session.editMessage({ sessionId, targetSeq, content })` to every Session face they implement or stub: the Client test fixture throws until a test supplies it, and a LiveShare viewer receives the `owner-only` refusal for the new endpoint.
2. Branch on the returned `session/edit-rejected` error's `code`: `MESSAGE_EDIT_TURN_RUNNING`, `MESSAGE_EDIT_TARGET_NOT_ON_SURFACE`, `MESSAGE_EDIT_TARGET_NOT_USER`, `MESSAGE_EDIT_CONTENT_EMPTY`, or `MESSAGE_EDIT_ATTACHMENT_NEW`. A rewrite needs an idle Session, so stop the running turn first.
3. Log consumers keep falling through unknown `MessageSourceMap` kinds. `user-edit` introduces no event type, so a consumer that ignores it still reconstructs model history; a persisted projection checkpoint whose edit stamp disagrees is refolded from scratch instead of replayed.
