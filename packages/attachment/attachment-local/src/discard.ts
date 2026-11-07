/**
 * Sweep that removes one content-addressed object and every display alias of
 * it below one attachment root. Reference tracking lives elsewhere: a digest
 * is shared by every Session that stored the same bytes, so the caller proves
 * no Session still names the object before handing it here.
 * @module @deepseek-ai/dsh-attachment-local/discard
 */

import { readdir, rmdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentDiscardResult, AttachmentDiscardOptions, AttachmentId,
} from '@deepseek-ai/dsh-attachment'
import { imageObjectPath } from './store.ts'
import { storedFileAliasDirectory, storedFileObjectPath } from './file-store.ts'

const DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/

/** Whether one filesystem error means the path is already gone. */
function isENOENT(error: unknown): boolean {
  // Every filesystem call in this sweep rejects with an ErrnoException.
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** Extract the lowercase digest one attachment identifier carries. */
function ensureDigest(id: AttachmentId): string {
  const match = DIGEST_PATTERN.exec(String(id))
  if (match?.[1] === undefined) {
    throw new AttachmentError('Attachment identifier is invalid.', 'INVALID_ATTACHMENT_REF')
  }
  return match[1]
}

/** One object the sweep found, with its age at discovery. */
interface Candidate {
  path: string
  ageMs: number
}

/** Observe one existing path, treating absence and a vanished sweep rival alike. */
async function observe(path: string, now: number): Promise<Candidate | undefined> {
  try {
    const identity = await stat(path)
    return { path, ageMs: now - identity.mtimeMs }
  } catch (error: unknown) {
    if (isENOENT(error)) return undefined
    throw error
  }
}

/** List one digest directory's alias leaves, refusing to descend into a non-directory. */
async function aliasPaths(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory)
    return entries.map(name => join(directory, name))
  } catch (error: unknown) {
    if (isENOENT(error)) return []
    // A non-directory standing where aliases live is foreign layout residue:
    // removing a symlink target the sweep never created would lose data.
    if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') return []
    /* v8 ignore next -- every other readdir fault is an external permission or I/O fault */
    throw error
  }
}

/** Unlink one path, whether it is an object or one linked display name; a rival that removed it first is not an error. */
async function unlinkIdempotent(path: string): Promise<boolean> {
  try {
    await unlink(path)
    return true
  } catch (error: unknown) {
    if (isENOENT(error)) return false
    throw error
  }
}

/**
 * Remove one digest's alias directory. Absence, a foreign file standing where
 * the aliases live, and a display name a second process linked after this sweep
 * listed the directory are all settled outcomes; any other fault surfaces.
 * @param directory - the digest's alias directory below the attachment root.
 */
async function removeAliasDirectory(directory: string): Promise<void> {
  try {
    await rmdir(directory)
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code
    /* v8 ignore next -- a second process links another display name between listing and removal */
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENOTEMPTY') return
    throw error
  }
}

/**
 * Remove every object stored under one digest: the normalized-image object, the
 * verbatim-file object, and each sanitized display name linked to it. An object
 * younger than `minAgeMs` is kept so a Session that saved the same bytes moments
 * ago and has not committed its reference yet still resolves it.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param id - content-addressed identifier naming the objects to remove.
 * @param options - minimum object age.
 * @returns `removed` for at least one removal, `absent` when nothing was stored,
 *   or `held` when every found object was too young.
 */
export async function discardStoredAttachment(
  root: string,
  id: AttachmentId,
  options: AttachmentDiscardOptions = {},
): Promise<AttachmentDiscardResult> {
  const sha256 = ensureDigest(id)
  const directory = storedFileAliasDirectory(root, sha256)
  const now = Date.now()
  const candidates: Candidate[] = []
  for (const path of [
    ...await aliasPaths(directory),
    storedFileObjectPath(root, sha256),
    imageObjectPath(root, sha256),
  ]) {
    const found = await observe(path, now)
    if (found !== undefined) candidates.push(found)
  }
  if (candidates.length === 0) return 'absent'
  const minAgeMs = options.minAgeMs ?? 0
  if (candidates.some(candidate => candidate.ageMs < minAgeMs)) return 'held'

  let removed = false
  for (const candidate of candidates) {
    // Alias leaves go first: a linked name keeps the object inode alive, and a
    // removed object with a surviving name would still read fine and hide the leak.
    removed = await unlinkIdempotent(candidate.path) || removed
  }
  // The digest directory is private to this one digest, so an empty leftover is
  // this sweep's own residue. rmdir never removes a directory holding a rival's
  // alias that was committed after the sweep listed it.
  await removeAliasDirectory(directory)

  return removed ? 'removed' : 'absent'
}
