// @vitest-environment jsdom
import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { GeneralSectionComponentProps } from '../src/client/GeneralSection.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import type { TriggerContentProps } from '../src/client/chrome.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import { SignInSection } from '../src/client/SignInSection.tsx'
import { DesktopChannelRow, DesktopChannelToast } from '../src/client/DesktopChannelRow.tsx'
import { DesktopChannelSource } from '../src/client/desktop-channel-source.ts'
import type { DesktopChannelChangeResult, DesktopChannelState } from '../src/types.ts'
import { DeveloperToolsRow } from '../src/client/DeveloperToolsRow.tsx'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

/** Store over a real mirror derived from the same scripted context. */
function derivedDocumentStore(remote: object) {
  const ctx = { remote } as never
  return new SettingsDocumentStore(ctx, new SettingsDescribeMirror(ctx))
}
import { en, zh } from '../src/client/locales.ts'
import { CurrentVersionRow } from '../src/client/CurrentVersionRow.tsx'
import { DesktopUpdateBadge } from '../src/client/DesktopUpdateIndicator.tsx'
import { HostReleasePrompt, type HostReleasePromptProps } from '../src/client/HostReleasePrompt.tsx'
import type { DesktopUpdateView } from '../src/types.ts'

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

// The seat's key domain is settings ∪ common; the stub answers from the
// package dictionary and falls back to the key like the real chain.
const t: TriggerContentProps['t'] = key => (en as Record<string, string>)[key] ?? key

// Global standard kit stubs: none of these components consume the hooks.
const unusedHook = (() => { throw new Error('unused by settings-general components') }) as never
type AttentionSnapshot = Parameters<Parameters<TriggerContentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: TriggerContentProps['useSessionStatus'] = selector => selector(noAttention)
const kit = {
  useSessions: unusedHook, useSessionStatus,
  usePanelInfo, useSessionRetainInfo: () => undefined, useResource, useWorkspaces: unusedHook,
  ...allowAllAccess,
  useContextMenu: contextMenuHook(),
}

describe('Desktop collapsed update badge', () => {
  it('shows update and retry status and yields to connection feedback', () => {
    let state: DesktopUpdateView = { failed: false, opening: false }
    let connection: 'connected' | 'connecting' | 'disconnected' = 'connected'
    const props = { ...kit, t,
      useDesktopUpdate: (select => select(state)) as Parameters<typeof DesktopUpdateBadge>[0]['useDesktopUpdate'],
      useConnectionState: (select => select(connection)) as Parameters<typeof DesktopUpdateBadge>[0]['useConnectionState'],
    }
    const view = render(<DesktopUpdateBadge {...props} />)
    expect(screen.queryByRole('img')).toBeNull()
    state = { ...state, presentation: { phase: 'available', version: '1.0.1' } }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.getByRole('img', { name: 'Update' })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    state = { ...state, failed: true }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.getByRole('img', { name: en['desktop.update.retry'] })).toBeTruthy()
    state = { failed: true, opening: false }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.getByRole('img', { name: en['desktop.update.retry'] })).toBeTruthy()
    state = { failed: false, opening: false, presentation: { phase: 'error', failure: 'install' } }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.getByRole('img', { name: en['desktop.update.retry'] })).toBeTruthy()
    state = { failed: false, opening: false, presentation: { phase: 'idle', configurationError: 'format' } }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.getByRole('img', { name: en['desktop.channel.unavailable'] })).toBeTruthy()
    state = { ...state, presentation: { phase: 'idle' } }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.queryByRole('img')).toBeNull()
    for (const value of ['connecting', 'disconnected'] as const) {
      connection = value
      view.rerender(<DesktopUpdateBadge {...props} />)
      expect(screen.queryByRole('img')).toBeNull()
    }
  })
})

it('toggles developer tools using the accepted setting and disables duplicate writes', async () => {
  const state = createSnapshotStore(false)
  let finish!: () => void
  const setEnabled = vi.fn((enabled: boolean) => new Promise<void>((resolve) => {
    finish = () => { state.set(enabled); resolve() }
  }))
  render(<DeveloperToolsRow {...kit} t={t} useDeveloperTools={bindSnapshotSelector(state)} setEnabled={setEnabled} />)
  const toggle = screen.getByRole('switch', { name: 'Show coding view' })
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(toggle)
  expect(setEnabled).toHaveBeenCalledWith(true)
  expect(toggle.hasAttribute('disabled')).toBe(true)
  finish()
  await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('true') })
  expect(toggle.hasAttribute('disabled')).toBe(false)
})

describe('chrome content', () => {
  it('TriggerContent renders the icon with the label in the wide column', () => {
    const { container } = render(<TriggerContent {...kit} wide t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('TriggerContent drops the label in the rail state', () => {
    const { container } = render(<TriggerContent {...kit} wide={false} t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('HeaderContent and CloseLabel render their translated text', () => {
    render(<HeaderContent {...kit} t={t} />)
    render(<CloseLabel {...kit} t={t} />)
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })
})

describe('GeneralSection', () => {
  function mount() {
    const renderSlot = vi.fn(
      ((key: string) => <div data-testid={`slot-${key}`} />) as GeneralSectionComponentProps['renderSlot'],
    )
    const props: GeneralSectionComponentProps = { ...kit, renderSlot, close: vi.fn() }
    const view = render(<GeneralSection {...props} />)
    return { view, renderSlot }
  }

  it('renders the item slot as the section body', () => {
    const { renderSlot } = mount()
    expect(renderSlot).toHaveBeenCalledWith('settings.general.item', {})
    expect(screen.getByTestId('slot-settings.general.item')).toBeTruthy()
  })
})

describe('SettingsDocumentAction', () => {
  it('appears only for a file-backed provider and requests its Host-owned document', async () => {
    const openDocument = vi.fn(() => Promise.resolve({
      ok: true as const, value: { opened: true as const },
    }))
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          ok: true as const,
          value: { writable: true, hasDocument: true, namespaces: [] },
        })),
        openSettingsDocument: openDocument,
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    const action = await screen.findByRole('button', { name: 'Open configuration file' })
    fireEvent.click(action)
    await waitFor(() => { expect(openDocument).toHaveBeenCalledWith() })
  })

  it('stays absent without a document and follows a mirror refresh to available', async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } })
      .mockResolvedValueOnce({ ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } })
    const ctx = { remote: { settings: { describe, openSettingsDocument: vi.fn() } } } as never
    const mirror = new SettingsDescribeMirror(ctx)
    const controller = new SettingsDocumentStore(ctx, mirror)
    const first = render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(screen.queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    first.unmount()
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    // A remount alone re-reads nothing; availability moves with the mirror's
    // own refresh (a document commit or reconnect in production).
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(describe).toHaveBeenCalledTimes(1)
    await mirror.load()
    expect(await screen.findByRole('button', { name: 'Open configuration file' })).toBeTruthy()
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('keeps the action available and reports a native-open failure', async () => {
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          ok: true as const,
          value: { writable: true, hasDocument: true, namespaces: [] },
        })),
        openSettingsDocument: vi.fn(() => Promise.resolve({
          ok: false as const,
          error: new RemoteError('gateway/internal', 'xdg-open missing', {}),
        })),
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open configuration file')
    expect(screen.getByRole('button', { name: 'Open configuration file' })).toBeTruthy()
  })
})

it('reports a failed developer-tool write and allows retry', async () => {
  const state = createSnapshotStore(false)
  const setEnabled = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async (enabled: boolean) => { state.set(enabled) })
  render(<DeveloperToolsRow {...kit} t={t} useDeveloperTools={bindSnapshotSelector(state)} setEnabled={setEnabled} />)
  const toggle = screen.getByRole('switch', { name: 'Show coding view' })
  fireEvent.click(toggle)
  expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Please try again.')
  expect(toggle.hasAttribute('disabled')).toBe(false)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(toggle)
  await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('true') })
  expect(screen.queryByRole('alert')).toBeNull()
})

describe('current version', () => {
  it.each([
    ['Current version: 1.2.3-rc.4', en],
    ['当前版本：1.2.3-rc.4', zh],
  ])('renders the localized release label %s', (expected, dictionary) => {
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3-rc.4')
    const translate: TriggerContentProps['t'] = (key, params) => {
      let text = (dictionary as Record<string, string>)[key] ?? key
      for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value))
      return text
    }
    render(<CurrentVersionRow {...kit} t={translate} />)
    expect(screen.getByText(expected)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('omits the row when a partial build has no version metadata', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', undefined)
    const view = render(<CurrentVersionRow {...kit} t={t} />)
    expect(view.container.textContent).toBe('')
  })
})

describe('Host release change confirmation', () => {
  type Release = { version: string; commit?: string }
  type Change = { page: Release | undefined; previous: Release | undefined; host: Release | undefined } | undefined
  function prompt(change: Change, dictionary: Record<string, string> = en) {
    const dismissRelease = vi.fn()
    const reloadPage = vi.fn()
    const props: HostReleasePromptProps = {
      ...kit,
      t: key => dictionary[key] ?? key,
      useReleaseChange: select => select(change),
      dismissRelease,
      reloadPage,
    }
    return { dismissRelease, reloadPage, view: render(<HostReleasePrompt {...props} />) }
  }

  it('stays hidden while no release change is announced', () => {
    prompt(undefined)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the service and page transitions and either reloads or keeps the page', () => {
    const { dismissRelease, reloadPage } = prompt({
      page: { version: '0.2.1' }, previous: { version: '0.2.2' }, host: { version: '0.2.3', commit: 'abc1234' },
    })
    const dialog = screen.getByRole('dialog', { name: 'Service version changed' })
    // Changed versions show only the versions.
    expect(dialog.textContent).toContain('Service0.2.20.2.3Page0.2.10.2.3')
    expect(dialog.textContent).toContain(en['hostRelease.description'])
    // The dialog opens without a user gesture; initial focus keeps the page.
    expect(document.activeElement?.textContent).toBe('Not now')
    fireEvent.click(screen.getByRole('button', { name: 'Reload to load the new version' }))
    expect(reloadPage).toHaveBeenCalledOnce()
    expect(dismissRelease).not.toHaveBeenCalled()
    const keep = screen.getAllByRole('button', { name: 'Not now' })
    // The footer action and the dialog's close control both keep the page.
    expect(keep).toHaveLength(2)
    for (const button of keep) fireEvent.click(button)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dismissRelease).toHaveBeenCalledTimes(3)
  })

  it('shows commits for a transition within one version and labels what the Host did not publish', () => {
    prompt({
      page: { version: '0.2.0' },
      previous: { version: '0.2.1', commit: 'aaaaaaa' },
      host: { version: '0.2.1', commit: 'bbbbbbb' },
    })
    expect(screen.getByRole('dialog').textContent).toContain('Serviceaaaaaaabbbbbbb' + 'Page0.2.00.2.1')
    cleanup()
    prompt({ page: { version: '0.2.1' }, previous: { version: '0.2.1' }, host: { version: '0.2.1', commit: 'bbbbbbb' } }, zh)
    expect(screen.getByRole('dialog', { name: '服务版本变化' }).textContent)
      .toContain('服务未解析bbbbbbb页面未解析bbbbbbb')
    cleanup()
    prompt({ page: undefined, previous: undefined, host: { version: '0.2.1' } })
    expect(screen.getByRole('dialog').textContent).toContain('ServiceUnknown0.2.1PageUnknown0.2.1')
    cleanup()
    prompt({ page: { version: '0.2.1' }, previous: { version: '0.2.1' }, host: undefined })
    expect(screen.getByRole('dialog').textContent).toContain('Service0.2.1UnknownPage0.2.1Unknown')
  })
})

it('shows channel load errors and waits for an explicit selection to settle', async () => {
  let state: { state?: DesktopChannelState; failed: boolean; pending?: 'stable' } = { failed: false }
  const pending = Promise.withResolvers<undefined>()
  const select = vi.fn(() => pending.promise)
  const props = { ...kit, t, select, useChannel: bindSnapshotSelector(createSnapshotStore(state)) }
  const view = render(<DesktopChannelRow {...props} />)
  const control = screen.getByRole('button', { name: 'Update channel' })
  expect(control.hasAttribute('disabled')).toBe(true)
  state = { failed: true }
  view.rerender(<DesktopChannelRow {...props} useChannel={bindSnapshotSelector(createSnapshotStore(state))} />)
  expect(screen.getByRole('alert').textContent).toBe(en['desktop.channel.readError'])
  state = { failed: false, state: { channel: null, packagedChannel: 'nightly', changing: false, error: 'format' } }
  view.rerender(<DesktopChannelRow {...props} useChannel={bindSnapshotSelector(createSnapshotStore(state))} />)
  expect(control.textContent).toContain('Configuration unavailable')
  fireEvent.click(control)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Stable' }))
  expect(select).toHaveBeenCalledWith('stable')
  state = { ...state, pending: 'stable' }
  view.rerender(<DesktopChannelRow {...props} useChannel={bindSnapshotSelector(createSnapshotStore(state))} />)
  expect(control.textContent).toBe('Stable')
  expect(control.getAttribute('aria-busy')).toBe('true')
  pending.resolve(undefined)
  state = { failed: false, state: { channel: 'stable', packagedChannel: 'nightly', changing: false } }
  view.rerender(<DesktopChannelRow {...props} useChannel={bindSnapshotSelector(createSnapshotStore(state))} />)
  expect(control.textContent).toBe('Stable')
  fireEvent.click(control)
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  fireEvent.click(control)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Development' }))
  await waitFor(() => { expect(select).toHaveBeenLastCalledWith('nightly') })
  state = { failed: false, state: { channel: 'nightly', packagedChannel: 'nightly', changing: true } }
  view.rerender(<DesktopChannelRow {...props} useChannel={bindSnapshotSelector(createSnapshotStore(state))} />)
  expect(control.hasAttribute('disabled')).toBe(true)
  state = { ...state, state: { ...state.state!, changing: false } }
  view.rerender(<DesktopChannelRow {...props} useChannel={bindSnapshotSelector(createSnapshotStore(state))} />)
  await waitFor(() => { expect(control.textContent).toBe('Development') })
})

it('keeps the failure toast after Settings unmounts and rolls back the remounted selector', async () => {
  const state: DesktopChannelState = { channel: 'nightly', packagedChannel: 'nightly', changing: false }
  const reply = Promise.withResolvers<DesktopChannelChangeResult>()
  const source = new DesktopChannelSource({ get: async () => state, set: () => reply.promise, subscribe: () => () => {} })
  const useChannel = bindSnapshotSelector(source.store)
  const select = (channel: 'nightly' | 'stable') => source.select(channel)
  const row = render(<DesktopChannelRow {...kit} t={t} useChannel={useChannel} select={select} />)
  const toast = render(<DesktopChannelToast openConfiguration={() => {}} {...kit} t={t} useChannel={useChannel}
    dismiss={(sequence) => { source.dismissNotice(sequence) }} />)
  try {
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Update channel' }).textContent).toBe('Development') })
    fireEvent.click(screen.getByRole('button', { name: 'Update channel' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stable' }))
    expect(screen.getByRole('button', { name: 'Update channel' }).textContent).toBe('Stable')
    expect(screen.getByRole('button', { name: 'Update channel' }).getAttribute('aria-busy')).toBe('true')
    row.unmount()
    reply.resolve({ kind: 'failed', state, reason: 'permission' })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('Could not save: permission denied') })
    render(<DesktopChannelRow {...kit} t={t} useChannel={useChannel} select={select} />)
    expect(screen.getByRole('button', { name: 'Update channel' }).textContent).toBe('Development')
  } finally { source.dispose(); toast.unmount() }
})

it('dismisses a successful channel toast after its display lifetime', async () => {
  vi.useFakeTimers()
  const dismiss = vi.fn()
  const store = createSnapshotStore<import('../src/client/desktop-channel-source.ts').DesktopChannelSnapshot>({
    failed: false, notice: { sequence: 7, outcome: 'applied' },
  })
  const view = render(<DesktopChannelToast openConfiguration={() => {}} {...kit} t={t}
    useChannel={bindSnapshotSelector(store)} dismiss={dismiss} />)
  try {
    expect(screen.getByRole('alert').textContent).toBe('Update channel changed')
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(dismiss).toHaveBeenCalledWith(7)
  } finally { view.unmount(); vi.useRealTimers() }
})

it('keeps the settings-file notification for ten seconds with a details action', async () => {
  vi.useFakeTimers()
  const dismiss = vi.fn()
  const openConfiguration = vi.fn()
  const store = createSnapshotStore<import('../src/client/desktop-channel-source.ts').DesktopChannelSnapshot>({
    failed: false, notice: { sequence: 8, outcome: 'configuration' },
  })
  const view = render(<DesktopChannelToast {...kit} t={t} useChannel={bindSnapshotSelector(store)}
    dismiss={dismiss} openConfiguration={openConfiguration} />)
  try {
    expect(screen.getByRole('alert').querySelector('svg')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View details' }))
    expect(openConfiguration).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(dismiss).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(dismiss).toHaveBeenCalledWith(8)
  } finally { view.unmount(); vi.useRealTimers() }
})

it('uses the concise Chinese configuration error for the settings notification', () => {
  expect(zh['desktop.channel.result.configuration']).toBe('配置文件异常，更新已暂停')
})

it('labels uncertain settings saves without claiming they were not written', () => {
  expect(zh['desktop.channel.result.uncertain']).toBe('设置保存异常')
})

it('does not describe a saved selection that failed to apply as unsaved', () => {
  expect(zh['desktop.channel.result.apply']).toBe('设置保存异常')
  expect(en['desktop.channel.result.apply']).toBe('Settings save error')
})

describe('SignInSection', () => {
  /** Script each `auth/*` answer in order and record every request the section sent. */
  function scriptedFetch(replies: Array<{ status: number; body?: Record<string, unknown> }>) {
    const requests: Array<{ endpoint: string; body: Record<string, unknown> }> = []
    let index = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: string }) => {
      const reply = replies[Math.min(index, replies.length - 1)] ?? { status: 0 }
      index += 1
      requests.push({
        endpoint: String(input),
        body: init?.body === undefined ? {} : JSON.parse(init.body) as Record<string, unknown>,
      })
      return { status: reply.status, json: () => Promise.resolve(reply.body ?? {}) }
    }))
    return requests
  }

  /** Open the panel over scripted Host answers; the first reply serves its state read. */
  function opened(replies: Array<{ status: number; body?: Record<string, unknown> }>) {
    const requests = scriptedFetch(replies)
    const signOut = vi.fn((): Promise<void> => Promise.resolve())
    render(<SignInSection {...kit} t={t} close={() => {}} signOut={signOut} />)
    return { requests, signOut }
  }

  const field = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
  const type = (label: string, value: string): void => {
    fireEvent.change(field(label), { target: { value } })
  }
  const editRow = () => screen.getByRole('button', { name: new RegExp(en['signin.edit']) })
  const ready = {
    ok: true,
    username: 'dsh',
    hasPassword: true,
    sessionKind: 'password',
    expiresAt: Date.UTC(2026, 11, 20),
  }

  it('leads with the signed-in account and names how it got in', async () => {
    opened([{ status: 200, body: ready }])
    await waitFor(() => { expect(screen.getByText('dsh')).toBeTruthy() })
    expect(screen.getByText(new RegExp(en['signin.sessionPassword']))).toBeTruthy()
    expect(screen.queryByLabelText(en['signin.currentPassword'])).toBeNull()
    expect(screen.getByRole('button', { name: en.signOut })).toBeTruthy()
  })

  it('edits the account and password behind that row', async () => {
    const { requests } = opened([
      { status: 200, body: ready },
      { status: 200, body: { ok: true, username: 'operator', message: en['signin.saved'] } },
    ])
    await waitFor(() => { expect(editRow()).toBeTruthy() })
    fireEvent.click(editRow())
    expect(field(en['signin.account']).value).toBe('dsh')
    expect(screen.getByRole('button', { name: en['signin.save'] }).hasAttribute('disabled')).toBe(true)
    type(en['signin.account'], 'operator')
    type(en['signin.currentPassword'], 'correct-horse')
    type(en['signin.newPassword'], 'fresh-horse')
    expect(screen.getByRole('button', { name: en['signin.save'] }).hasAttribute('disabled')).toBe(true)
    type(en['signin.confirmPassword'], 'fresh-horse')
    expect(field(en['signin.newPassword']).type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: en['signin.reveal'] }))
    expect(field(en['signin.newPassword']).type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: en['signin.save'] }))
    await waitFor(() => { expect(screen.getByText('operator')).toBeTruthy() })
    expect(requests[1]?.endpoint).toBe('auth/change')
    expect(requests[1]?.body).toEqual({
      username: 'operator',
      currentPassword: 'correct-horse',
      password: 'fresh-horse',
      confirmPassword: 'fresh-horse',
    })
    expect(screen.getByText(en['signin.saved'])).toBeTruthy()
    // Leaving the edit view returns to the account row with the secrets cleared.
    expect(screen.queryByLabelText(en['signin.currentPassword'])).toBeNull()
  })

  it('asks for a first password while the Host holds none', async () => {
    const { requests } = opened([
      { status: 200, body: { ok: true, username: 'dsh', hasPassword: false, sessionKind: 'launch' } },
      { status: 200, body: { ok: true, username: 'dsh' } },
    ])
    await waitFor(() => { expect(screen.getByText(en['signin.sessionToken'])).toBeTruthy() })
    fireEvent.click(editRow())
    expect(screen.queryByLabelText(en['signin.currentPassword'])).toBeNull()
    expect(screen.getByText(en['signin.setFirst'])).toBeTruthy()
    type(en['signin.newPassword'], 'fresh-horse')
    type(en['signin.confirmPassword'], 'fresh-horse')
    fireEvent.click(screen.getByRole('button', { name: en['signin.save'] }))
    await waitFor(() => { expect(requests[1]?.endpoint).toBe('auth/setup') })
    expect(requests[1]?.body.currentPassword).toBeUndefined()
  })

  it('stays in the edit view and shows the Host refusal', async () => {
    opened([
      { status: 200, body: ready },
      { status: 403, body: { ok: false, message: en['signin.failed'] } },
    ])
    await waitFor(() => { expect(editRow()).toBeTruthy() })
    fireEvent.click(editRow())
    type(en['signin.currentPassword'], 'wrong-horse')
    type(en['signin.newPassword'], 'fresh-horse')
    type(en['signin.confirmPassword'], 'fresh-horse')
    fireEvent.click(screen.getByRole('button', { name: en['signin.save'] }))
    await waitFor(() => { expect(screen.getByText(en['signin.failed'])).toBeTruthy() })
    expect(field(en['signin.currentPassword'])).toBeTruthy()
    expect(field(en['signin.newPassword']).value).toBe('')
  })

  it('signs out other devices only after a second press', async () => {
    const { requests } = opened([
      { status: 200, body: ready },
      { status: 200, body: { ok: true, message: 'Signed out the other devices.' } },
    ])
    await waitFor(() => { expect(screen.getByRole('button', { name: en['signin.revoke'] })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en['signin.revoke'] }))
    expect(requests).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: en['signin.revokeConfirm'] }))
    await waitFor(() => { expect(screen.getByText('Signed out the other devices.')).toBeTruthy() })
    expect(requests[1]?.endpoint).toBe('auth/revoke')
    expect(requests[1]?.body).toEqual({})
  })

  it('ends this browser session from the row under the account', async () => {
    const { signOut } = opened([{ status: 200, body: ready }])
    await waitFor(() => { expect(screen.getByText('dsh')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('offers a fresh sign-in when the session behind the panel expired', async () => {
    const { signOut } = opened([{ status: 401, body: { ok: false, message: en['signin.expired'] } }])
    await waitFor(() => { expect(screen.getByText(en['signin.expired'])).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('says so when the account state cannot be read', async () => {
    opened([{ status: 0 }])
    await waitFor(() => { expect(screen.getByText(en['signin.unavailable'])).toBeTruthy() })
  })

  it('treats an answer that names no account as unreadable', async () => {
    opened([{ status: 200, body: { ok: true } }])
    await waitFor(() => { expect(screen.getByText(en['signin.unavailable'])).toBeTruthy() })
  })

  it('falls back to its own copy when the Host explains nothing', async () => {
    const { requests } = opened([
      { status: 200, body: ready },
      { status: 400, body: { ok: true } },
      { status: 200, body: { ok: true, username: 'dsh' } },
    ])
    await waitFor(() => { expect(editRow()).toBeTruthy() })
    fireEvent.click(editRow())
    type(en['signin.currentPassword'], 'correct-horse')
    type(en['signin.newPassword'], 'fresh-horse')
    type(en['signin.confirmPassword'], 'fresh-horse')
    fireEvent.click(screen.getByRole('button', { name: en['signin.save'] }))
    await waitFor(() => { expect(screen.getByText(en['signin.failed'])).toBeTruthy() })
    // The panel stays in the edit view so the caller can try again; this time the Host
    // accepts without a message, and the panel returns to the account row.
    type(en['signin.currentPassword'], 'correct-horse')
    type(en['signin.newPassword'], 'fresh-horse')
    type(en['signin.confirmPassword'], 'fresh-horse')
    fireEvent.click(screen.getByRole('button', { name: en['signin.save'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en['signin.saved']) })
    expect(requests[1]?.endpoint).toBe('auth/change')
    expect(requests[2]?.endpoint).toBe('auth/change')
    expect(screen.queryByLabelText(en['signin.currentPassword'])).toBeNull()
  })

  it('names the sign-out of other devices in its own words when the Host is silent', async () => {
    const { requests } = opened([
      { status: 200, body: ready },
      { status: 200, body: { ok: true, message: 'Signed out the other devices.' } },
      { status: 200, body: { ok: true } },
    ])
    await waitFor(() => { expect(screen.getByRole('button', { name: en['signin.revoke'] })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en['signin.revoke'] }))
    fireEvent.click(screen.getByRole('button', { name: en['signin.revokeConfirm'] }))
    await waitFor(() => { expect(screen.getByText('Signed out the other devices.')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en['signin.revoke'] }))
    fireEvent.click(screen.getByRole('button', { name: en['signin.revokeConfirm'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en['signin.revoke']) })
    expect(requests.filter(call => call.endpoint === 'auth/revoke')).toHaveLength(2)
  })
})
