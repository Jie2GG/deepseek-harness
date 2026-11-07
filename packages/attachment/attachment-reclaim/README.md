---
description: "Which Sessions reference each content-addressed attachment, and how an object is reclaimed only after the last Session naming it is deleted."
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-reclaim

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

This package answers whether any Session still references a content-addressed attachment object, and removes the object from disk when none does. Attachment storage is content-addressed: two Sessions that upload the same bytes share one object, so deleting one Session must not cost the other its image. References are read from committed Session events, never from a second account that has to be kept in step, and reclaim runs in the background with a trust gate, an in-process claim, and an object-age guard, so a failure costs disk space and never costs a Session its bytes.

<a id="table-of-contents"></a>
## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside an attachment backend in every composition that deletes Sessions. It writes no Session event and adds no prompt or tool schema.

### When to choose it

Choose it wherever a deleted Session would otherwise strand its bytes: the ledger is the only component that knows which Session referenced which object. A composition that never deletes Sessions can omit it, and omission changes nothing else — the ledger is consulted by nothing but its own sweep. A deployment that trades disk for a shorter wait lowers `minAgeMs`; one that would rather keep an orphan than risk a miss raises it.

### Minimal configuration

```yaml
- id: attachment-reclaim
  name: '@deepseek-ai/dsh-attachment-reclaim'
  config:
    reclaimIntervalMs: 60000
    minAgeMs: 600000
    batchSize: 50
    concurrency: 4
```

`minAgeMs` is the shortest age an object reaches before a pass may remove it, and the lifetime of a claim this process holds for an object it has just committed. `reclaimIntervalMs` sets how often a pass runs, `batchSize` how many queued objects one pass handles, and `concurrency` how many backend calls it keeps in flight.

### What becomes durable

The `attachment_refs` domain in `per-record` layout: a `refs` record naming the Sessions that reference one object, and a `reclaim` record for an object waiting to be removed, carrying its queue time, attempt count, and last failure reason. Both tables are keyed by the bare 64-hex digest, because a per-record key must be path-safe. A global slot holds `builtAt`, the marker that the records were last rebuilt from every stored Session log.

### Observable behavior and failures

A reference is recorded only when a Session event commits, so a rejected message or an abandoned upload leaves no record. When the Workspace registry announces `workspace/session-deleted`, this package drops that Session from every record naming it, and queues each object that loses its last holder. A pass removes a queued object only when four conditions hold together: the ledger is trusted, no `refs` record names a holder, no object this process committed is still awaiting its reference, and the backend confirms the object is old enough and not busy. A removal failure keeps the queue entry and its recorded reason for a later pass.

A rebuild that cannot read one stored log leaves the ledger untrusted and the sweep idle, because a missing reference could delete an image a Session still shows. The next complete rebuild restores trust, so a transient storage fault delays reclamation instead of risking loss.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Session log is the only authority on what references what, so the ledger is a projection of it. References enter at a committed event, leave when a log removal is announced, and the whole projection can be rebuilt from the logs when the durable records are missing, stale, or suspect. Removal is deferred and re-checked at the moment of deletion for the same reason: an extra object costs bytes, a wrong deletion costs a transcript.

### Design concept

Three rules decide every case. First, only committed events create references, which keeps a claim that never reached a log from pinning an object forever. Second, an object is removed only after a pass re-reads the ledger, so a Session that referenced it again in the meantime keeps its image. Third, the ledger is usable for deletion only when it is complete: an absent or partially rebuilt `refs` table proves nothing, and completeness is established by reading every stored log, which is why `builtAt` gates the sweep rather than merely recording when one ran.

### Source map

| File | Responsibility |
| --- | --- |
| `src/index.ts` | The `ctx.attachmentReferences` service: `Config`, reference recording, detach on deletion, rebuild, and the reclaim pass. |
| `src/spec.ts` | The `attachment_refs` domain declaration and its record schemas. |
| `src/refs.ts` | The structural walk that collects the content addresses one committed event names. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workspace entities](../../workspace/README.md) — the registry that owns Session accounting and announces `workspace/session-deleted`.
- [Durable attachment storage](../attachment/README.md) — the backend that stores objects by digest and removes one on request.
- [Session persistence](../../session/session-persistence/README.md) — the log whose committed events are the only source of a reference.

-----

<a id="model-experience"></a>
## Model Experience

### A Session is deleted

#### What the model sees

Nothing changes in a Session that survives. The deleted Session never appears in a later request, and a reference to it from another Session's transcript is reported as an unavailable source rather than a corrupt log. Images that Session still references keep resolving, because an object is reclaimed only after `workspace/session-deleted` leaves it with no holder in any log.

#### Token effect

No tokens are added or removed: the ledger writes no Session event, so no transcript grows and nothing is injected into a prompt.

#### KV Cache effect

None. Reclaim runs outside the request path and cannot rewrite prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where reclamation stops. They are current package constraints, not a task backlog.

- **Reclaim is scoped to a deletion** — an object that no log ever referenced is not swept, because discovering it requires enumerating the backend's stored digests, which `ctx.attachments` does not expose.
- **A saved-but-uncommitted object is protected only in this process** — another process that committed bytes and died before its event lands leaves the object referenced by nothing; the object-age window bounds that exposure rather than eliminating it.
- **A storage fault delays reclamation** — while the ledger is untrusted the sweep is idle, so disk can be held longer than `minAgeMs` promises.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The queue records keep their attempt count and last failure so a stuck object is diagnosable from the medium alone. A sweep never throws for one object: it retries on the next pass, which is why the pass reports counts rather than a rejected promise.

</details>
