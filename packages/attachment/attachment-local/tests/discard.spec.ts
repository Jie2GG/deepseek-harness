/**
 * Removal sweep behaviour for content-addressed attachment objects: shared
 * display aliases, both object layouts, young-object protection, and the
 * residue a rival sweep leaves behind.
 * @module @deepseek-ai/dsh-attachment-local/tests/discard
 */

import { createHash } from 'node:crypto'
import { mkdir, rmdir, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Injected storage fault: one exact call fails with one exact errno. */
const fault = vi.hoisted(() => ({
  statPath: undefined as string | undefined,
  unlinkPath: undefined as string | undefined,
  rmdirPath: undefined as string | undefined,
  /** Listed paths a rival removed first: the sweep must treat absence as done. */
  missingUnlinkPaths: [] as string[],
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const inject = (target: unknown, failing: string | undefined, code: string) => {
    if (typeof target === 'string' && target === failing) {
      throw Object.assign(new Error(`injected ${code}`), { code })
    }
  }
  return {
    ...actual,
    async stat(...args: Parameters<typeof actual.stat>) {
      inject(args[0], fault.statPath, 'EIO')
      return actual.stat(...args)
    },
    async unlink(target: Parameters<typeof actual.unlink>[0]) {
      inject(target, fault.unlinkPath, 'EIO')
      if (typeof target === 'string' && fault.missingUnlinkPaths.includes(target)) {
        throw Object.assign(new Error('injected ENOENT'), { code: 'ENOENT' })
      }
      return actual.unlink(target)
    },
    async rmdir(target: Parameters<typeof actual.rmdir>[0]) {
      inject(target, fault.rmdirPath, 'EIO')
      return actual.rmdir(target)
    },
  }
})
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { discardStoredAttachment } from '../src/discard.ts'
import {
  saveFileStreamVerbatim, saveFileVerbatim, storedFileAliasDirectory, storedFileObjectPath, storedFilePath,
} from '../src/file-store.ts'
import { imageObjectPath, publishImmutableAlias, saveImageFile } from '../src/store.ts'
import LocalAttachmentStore from '../src/index.ts'

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC',
  'base64',
))

const limits = {
  maxImageBytes: 1024 * 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 4 * 1024 * 1024,
  maxImagePixels: 1024,
  maxImageDimension: 64,
  mediaTypes: ['image/png'] as const,
}
const policy = { maxPixels: 1024, maxDimension: 64, maxBytes: 1024 * 1024 }

/** Roots to delete after each test. */
const cleanup: string[] = []
/** Live plugin contexts to dispose after each test. */
const contexts: Context[] = []

async function makeRoot(): Promise<string> {
  const base = join(await mkdtemp(join(tmpdir(), 'dsh-discard-')), 'attachments', 'v1')
  cleanup.push(base)
  return base
}

function idOf(data: Uint8Array): AttachmentId {
  return AttachmentId(`sha256:${createHash('sha256').update(data).digest('hex')}`)
}

function digestOf(id: AttachmentId): string {
  return String(id).slice('sha256:'.length)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Age one stored object so the minimum-age guard lets a sweep remove it. */
async function age(path: string): Promise<void> {
  const past = new Date(Date.now() - 3_600_000)
  await utimes(path, past, past)
}

async function* chunks(...parts: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part
}

beforeEach(() => {
  fault.statPath = undefined
  fault.unlinkPath = undefined
  fault.rmdirPath = undefined
  fault.missingUnlinkPaths = []
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of cleanup.splice(0)) {
    await rm(join(root, '..', '..'), { recursive: true, force: true, maxRetries: 3 })
  }
})

describe('discardStoredAttachment', () => {
  it('removes one verbatim file object with its display alias', async () => {
    const root = await makeRoot()
    const data = Buffer.from('discard-single-file')
    const ref = await saveFileVerbatim(root, { data, name: 'notes.txt' })
    const digest = digestOf(ref.attachmentId)
    expect(await exists(storedFileObjectPath(root, digest))).toBe(true)
    expect(await exists(storedFilePath(root, ref))).toBe(true)

    expect(await discardStoredAttachment(root, ref.attachmentId)).toBe('removed')
    expect(await exists(storedFileObjectPath(root, digest))).toBe(false)
    expect(await exists(storedFileAliasDirectory(root, digest))).toBe(false)
  })

  it('removes every display alias one shared digest carries', async () => {
    const root = await makeRoot()
    const data = Buffer.from('discard-shared-digest')
    const first = await saveFileVerbatim(root, { data, name: 'first.txt' })
    const second = await saveFileStreamVerbatim(root, { data: chunks(data), name: 'second.txt' })
    const digest = digestOf(first.attachmentId)
    expect(digestOf(second.attachmentId)).toBe(digest)
    expect(await readdir(storedFileAliasDirectory(root, digest))).toEqual(['first.txt', 'second.txt'])

    expect(await discardStoredAttachment(root, first.attachmentId)).toBe('removed')
    expect(await exists(storedFileObjectPath(root, digest))).toBe(false)
    expect(await exists(storedFileAliasDirectory(root, digest))).toBe(false)
  })

  it('removes a normalized image object', async () => {
    const root = await makeRoot()
    const ref: ImageAttachmentRef = await saveImageFile(root, { data: PNG, mediaType: 'image/png' }, limits, policy)
    const digest = digestOf(ref.attachmentId)

    expect(await discardStoredAttachment(root, ref.attachmentId)).toBe('removed')
    expect(await exists(imageObjectPath(root, digest))).toBe(false)
  })

  it('reports absence for an unstored digest without publishing any path', async () => {
    const root = await makeRoot()
    const id = idOf(Buffer.from('discard-never-stored'))
    expect(await discardStoredAttachment(root, id)).toBe('absent')
    expect(await exists(join(root, 'objects', digestOf(id).slice(0, 2), digestOf(id)))).toBe(false)
  })

  it('keeps an object younger than the caller minimum age and removes it once aged', async () => {
    const root = await makeRoot()
    const data = Buffer.from('discard-young-object')
    const ref = await saveFileVerbatim(root, { data, name: 'young.txt' })
    const objectPath = storedFileObjectPath(root, digestOf(ref.attachmentId))

    expect(await discardStoredAttachment(root, ref.attachmentId, { minAgeMs: 3_600_000 })).toBe('held')
    expect(await exists(objectPath)).toBe(true)

    await age(objectPath)
    await age(join(storedFileAliasDirectory(root, digestOf(ref.attachmentId)), 'young.txt'))
    expect(await discardStoredAttachment(root, ref.attachmentId, { minAgeMs: 3_600_000 })).toBe('removed')
  })

  it('refuses an identifier that carries no content address', async () => {
    const root = await makeRoot()
    await expect(discardStoredAttachment(root, AttachmentId('opaque-id')))
      .rejects.toThrow('Attachment identifier is invalid.')
  })

  it('treats a file standing where aliases live as no aliases and keeps it', async () => {
    const root = await makeRoot()
    const data = Buffer.from('discard-alias-not-directory')
    const ref = await saveFileVerbatim(root, { data, name: 'leaf.txt' })
    const digest = digestOf(ref.attachmentId)
    const directory = storedFileAliasDirectory(root, digest)
    await unlink(storedFilePath(root, ref))
    await rmdir(directory)
    await writeFile(directory, 'foreign residue')

    expect(await discardStoredAttachment(root, ref.attachmentId)).toBe('removed')
    expect(await exists(storedFileObjectPath(root, digest))).toBe(false)
    expect((await stat(directory)).isFile()).toBe(true)
  })

  it('treats an alias a rival removed first as already gone', async () => {
    const root = await makeRoot()
    const data = Buffer.from('discard-vanished-alias')
    const ref = await saveFileVerbatim(root, { data, name: 'gone.txt' })
    const digest = digestOf(ref.attachmentId)
    const objectPath = storedFileObjectPath(root, digest)
    // A second holder linked another name and unlinked it between this sweep's
    // listing and its unlink: absence is the outcome the sweep wanted.
    const rival = join(storedFileAliasDirectory(root, digest), 'rival.txt')
    await publishImmutableAlias(root, objectPath, rival, digest)
    fault.missingUnlinkPaths = [rival]

    expect(await discardStoredAttachment(root, ref.attachmentId)).toBe('removed')
    expect(await exists(objectPath)).toBe(false)
  })

  it('reports absence when a rival removed every listed path first', async () => {
    const root = await makeRoot()
    const data = Buffer.from('discard-rival-cleared-all')
    const ref = await saveFileVerbatim(root, { data, name: 'last.txt' })
    const digest = digestOf(ref.attachmentId)
    const objectPath = storedFileObjectPath(root, digest)
    const alias = storedFilePath(root, ref)
    fault.missingUnlinkPaths = [alias, objectPath, imageObjectPath(root, digest)]

    expect(await discardStoredAttachment(root, ref.attachmentId)).toBe('absent')
  })

  it('surfaces a storage fault while observing an object path', async () => {
    const root = await makeRoot()
    const id = idOf(Buffer.from('discard-stat-fault'))
    await mkdir(imageObjectPath(root, digestOf(id)), { recursive: true })
    fault.statPath = imageObjectPath(root, digestOf(id))

    await expect(discardStoredAttachment(root, id)).rejects.toThrow('injected EIO')
  })

  it('surfaces a storage fault while unlinking an object', async () => {
    const root = await makeRoot()
    const data = Buffer.from('discard-unlink-fault')
    const ref = await saveFileVerbatim(root, { data, name: 'stuck.txt' })
    fault.unlinkPath = storedFilePath(root, ref)

    await expect(discardStoredAttachment(root, ref.attachmentId)).rejects.toThrow('injected EIO')
  })

  it('surfaces a storage fault while removing the alias directory', async () => {
    const root = await makeRoot()
    const data = Buffer.from('discard-rmdir-fault')
    const ref = await saveFileVerbatim(root, { data, name: 'last.txt' })
    fault.rmdirPath = storedFileAliasDirectory(root, digestOf(ref.attachmentId))

    await expect(discardStoredAttachment(root, ref.attachmentId)).rejects.toThrow('injected EIO')
  })
})

describe('LocalAttachmentStore removal', () => {
  async function mount(): Promise<Context> {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-discard-store-'))
    cleanup.push(join(dshHome, 'attachments', 'v1'))
    const ctx = new Context()
    await ctx.plugin(LocalAttachmentStore, { dshHome })
    contexts.push(ctx)
    return ctx
  }

  it('announces every committed object so reference trackers claim it early', async () => {
    const ctx = await mount()
    const saved: AttachmentId[] = []
    ctx.on('attachments/saved', (id: AttachmentId) => { saved.push(id) })

    const image = await ctx.attachments.saveImage({ data: PNG, mediaType: 'image/png' })
    const batch = await ctx.attachments.saveImages([
      { data: PNG, mediaType: 'image/png' },
      { data: PNG, mediaType: 'image/png' },
    ])
    const file = await ctx.attachments.saveFile({ data: Buffer.from('stored-file'), name: 'a.txt' })
    const streamed = await ctx.attachments.saveFileStream({
      data: chunks(Buffer.from('streamed-file')), name: 'b.txt',
    })

    expect(saved).toEqual([
      image.attachmentId,
      (batch[0] as ImageAttachmentRef).attachmentId,
      (batch[1] as ImageAttachmentRef).attachmentId,
      file.attachmentId,
      streamed.attachmentId,
    ])
  })

  it('discards one stored object through the service face, then reports absence', async () => {
    const ctx = await mount()
    const root = (ctx.attachments as LocalAttachmentStore).root
    const file = await ctx.attachments.saveFile({ data: Buffer.from('service-discard'), name: 'c.txt' })
    const digest = digestOf(file.attachmentId)

    expect(await exists(join(root, 'file-objects', digest.slice(0, 2), digest))).toBe(true)
    expect(await ctx.attachments.discard(file.attachmentId, { minAgeMs: 3_600_000 })).toBe('held')
    expect(await ctx.attachments.discard(file.attachmentId)).toBe('removed')
    expect(await exists(storedFilePath(root, file))).toBe(false)
    expect(await ctx.attachments.discard(file.attachmentId)).toBe('absent')
  })

})
