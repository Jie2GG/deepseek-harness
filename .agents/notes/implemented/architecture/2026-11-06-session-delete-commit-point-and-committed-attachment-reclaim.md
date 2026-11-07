# Agent Note: Delete a Session log as the commit point, and reclaim attachments only from committed references

Status: implemented

English | [中文](2026-11-06-session-delete-commit-point-and-committed-attachment-reclaim.zh.md)

## Problem

Deleting a Session is irreversible, and three properties collide. Session listings, search, and derived reads are all projected from the stored logs, so a Session whose log survives is visible no matter what any accounting record says about it. An attachment object is content-addressed and shared, so removing the last Session that referenced one may or may not make its bytes dead. And a durable write can be interrupted: a process can exit between recording an intent and completing the removal it names, and Windows refuses to delete a file another handle still owns.

Choosing an order for these steps is a decision code cannot express. The wrong order shows a Session that no longer exists, hides one whose bytes are still on disk, or deletes an image another Session is about to reference.

## Decision

### The log removal is the commit point, with a durable intent beside it

`WorkspaceRegistry.deleteSession` records `pendingSessionDeletions` first, then calls `ctx.sessionPersistence.delete`, and only then drops the Session from its workspace record and from the archive and pin sets. The removal is therefore the moment the Session disappears from every read face, because every read face is projected from stored logs.

Startup re-runs removal for every pending id after the ordinary bootstrap, so an interruption converges on the next start instead of needing repair: the log is removed again — absence is not an error — and the accounting drops the id. A removal that still cannot run, because a handle another process owns it, keeps its intent and leaves the Session visible, which is the truth: its log is still there.

`workspace` domain version 2 gains the field with a zod default instead of a version bump. `archivedSessionIds` and `pinnedSessionIds` were introduced the same way: a state written before the field exists reads as an empty set, and no stored shape moved, so no successor generation is owed.

### A reference exists when its event commits

`attachment_refs` records which Sessions reference which object, and learns a reference only from a committed Session event. The ledger is a projection of the logs, never a second authority: a rebuild that cannot read one stored log leaves `builtAt` unset, and an untrusted ledger reclaims nothing. Convergence is by rebuilding.

### Three guards, all required, none sufficient alone

A pass removes a queued object only when the ledger has no holder for it, this process holds no claim for an object it just committed and has not yet seen referenced, and the backend reports the object old enough and free. Each closes a window the others leave open: the holder check catches a reference that landed after the object was queued; the in-process claim covers the interval between publishing bytes and committing the event that names them, which a log-derived ledger cannot see; the backend age check covers that same interval across processes and after a crash, where no claim survives.

The claim is deliberately process memory rather than a durable table. Reclaim stays scoped to what a deletion releases: an object that no log ever named is not swept, because finding it means enumerating the backend's stored digests, which `ctx.attachments` does not expose today.

### In-process owners release the log before it is removed

`deleteSession` dispatches `workspace/session-release` (parallel) after the intent is written and awaits every owner's release, and only then removes the log. The agent loop answers by disposing that Session's live Agent: the driver drains, and closing the write handle gives up the write ownership the removal must claim.

A live Agent owns its log while it is merely open, so write ownership is a different fact from the activity the `workspace/session-activity` waterfall reports. Without the release, the Session a user is currently viewing is the one Session that can never be deleted: the activity check passes because no turn runs, and the removal then refuses because this same process still holds the handle. The release runs before every removal the registry performs, including the one that carries a leftover intent at startup, where a Session an Agent this start resumed would otherwise pin its own log.

Release waits for settlement where stop does not. Archiving writes no log byte, so a stop may return while the work settles in the background; a removal claims the write lease immediately, so the registry has to know the handle is closed before it asks. A failing owner is logged and the removal is still attempted: an owner that cannot release leaves the removal refused as owned, which keeps the intent visible instead of reporting a success that did not happen.

### Deletion is announced, not called

The registry emits `workspace/session-deleted` after its durable writes, and each owner of a derived record about that Session retires its copy: the reference ledger detaches its holders, and the projection cache drops its checkpoint row.

## Alternatives considered

- **Clear the accounting first, then delete the file** — listings and search would resurrect the Session at the next start, because the history bootstrap re-registers every log the scan still finds. The row would vanish and return, and the bytes would outlive the record that said they were gone.
- **A recycle-bin directory with its own retention policy** — a second lifetime for the same bytes, a hidden quota, and a listing rule that hides rows whose data still exists, in exchange for an undo the user was never promised. The confirmation dialog plus the refusal of a running Session carry the risk instead.
- **Recording a reference when the object is saved** — pins an object for an upload whose message was rejected, never sent, or lost when the process died, with nothing to unpin it: the log is the only place that says what a Session contains.
- **Scanning every stored log for the digest at delete time** — correct and stateless, but it re-reads the whole Home on every deletion for an answer the ledger can maintain incrementally.
- **Using the SQLite search index as the authority** — indexed attachment text carries only a shortened digest, so a miss is indistinguishable from an absent reference, and a missing reference deletes an image a Session still shows.
- **A durable in-flight claim table** — needs its own expiry, must be cleared after a crash by whoever comes next, and can outlive the upload it protects, reintroducing the leak it was avoiding. The age guard bounds the cross-process case, and the re-read at removal time is what makes an in-flight reference safe.
- **Bumping the `workspace` domain to version 3** — implies a successor generation and a migration for data that never changed shape, against the adjacent-migration rule that a new version is reserved for stored shapes that cannot parse unchanged.
- **Calling the ledger and the cache from the registry** — inverts the dependency for a notification a declared event already carries, and makes deletion depend on optional plugins being present.
- **Reporting write ownership as a kind of activity** — every open Session would look busy, the stop-and-delete offer would mean "close the editor", and archiving with `stopActivity` would start disposing Agents it currently leaves running.
- **Refusing the current Session in the surface and only correcting the wording** — cheap to implement, but deleting the conversation one is reading is the commonest deletion there is.
- **Closing the handle inside `sessionPersistence.delete`** — the storage layer does not own the Agent, and releasing it needs the loop's whole teardown order: quiesce the driver, retire the session, unwind the scope, then close the handle.
- **Deleting the log while the live Agent keeps running** — its next write recreates an artifact for a Session no listing should show, so the Session returns after every deletion.

## Consequences

A delete either removes the log or says why it did not: there is no state where a Session is hidden while its bytes survive, and no repair step for a crash between the two writes. A Session this process owns is deletable because the delete ends that ownership; only another process holding the log leaves the intent pending and the Session visible until a later start completes it.

Deleting the Session a user is viewing ends its live Agent, and the delete waits for that Agent to drain. That is the same cost the user's own stop pays, and it is what makes the removal safe: the driver commits its closing events through the handle before the handle gives up the log.

Attachments are reclaimed only after a complete rebuild, so a fresh install holds every object until its first successful pass, and a storage fault delays reclamation rather than risking loss. A shared object survives every single-Session deletion by construction: the holder set, not the deleting caller, decides.

Reclaim leaves behind objects that no log ever named, so a Home that accumulated orphans before this package existed keeps them until `ctx.attachments` can enumerate stored digests.
