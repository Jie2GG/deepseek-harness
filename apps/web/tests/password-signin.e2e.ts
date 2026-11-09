/** Browser sign-in, first-password setup, and the in-app account edits served by Connection. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const PASSWORD = 'e2e-signin-password'
const ROTATED = 'e2e-rotated-password'
const WRONG = 'wrong-password-123'
const shell = String.raw`[data-slot="root"]`
const accountName = String.raw`input[name="username"]`
const passwordField = String.raw`input[name="password"]`
const confirmField = String.raw`input[name="confirm"]`
const submitButton = String.raw`button[type="submit"]`

/** Open the Settings dialog from the sidebar foot control, expanding the rail when it is collapsed. */
async function openSettings(page: import('playwright').Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Settings', exact: true })
  if (!await trigger.isVisible()) {
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  }
  await trigger.click()
}

/** The browser-session cookie this page holds for the served origin, if any. */
async function sessionCookie(page: import('playwright').Page, url: string) {
  const cookies = await page.context().cookies(url)
  return cookies.find(cookie => cookie.name.startsWith('dsh-auth-'))
}

it('sets the first password, edits it in Settings, and signs other browsers out', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())

  const owner = await newEnglishPage(browser)
  watchConsole(owner)
  onTestFailed(() => saveFailureShot(owner, 'web-e2e-password-signin'))
  // No password exists yet, so the index answers with the setup form, not the app.
  await owner.goto(scaffold.baseUrl, { waitUntil: 'load' })
  await owner.locator(confirmField).waitFor({ timeout: 30_000 })
  await owner.locator(passwordField).fill(PASSWORD)
  await owner.locator(confirmField).fill(PASSWORD)
  await owner.locator(submitButton).click()
  await owner.locator(shell).waitFor({ timeout: 60_000 })
  expect(await owner.locator(passwordField).count()).toBe(0)
  // A remembered sign-in is dated, so it survives a browser restart.
  expect((await sessionCookie(owner, scaffold.baseUrl))?.expires ?? -1).toBeGreaterThan(0)

  const guest = await newEnglishPage(browser)
  onTestFailed(() => saveFailureShot(guest, 'web-e2e-password-guest'))
  await guest.goto(scaffold.baseUrl, { waitUntil: 'load' })
  await guest.locator(passwordField).waitFor({ timeout: 30_000 })
  await guest.locator(passwordField).fill(WRONG)
  await guest.locator(submitButton).click()
  // One shared refusal covers both a wrong name and a wrong password.
  await guest.locator('p.error').waitFor({ timeout: 30_000 })
  expect((await guest.locator('p.error').textContent()) ?? '').toContain('not correct')
  // The first refusal opens a one-second wait for this address and account,
  // so the retry starts after it closes.
  await guest.waitForTimeout(1_100)
  await guest.locator(passwordField).fill(PASSWORD)
  // Unchecking remember me leaves a cookie the browser drops when it closes.
  await guest.locator('input[name="remember"]').uncheck()
  await guest.locator(submitButton).click()
  await guest.locator(shell).waitFor({ timeout: 60_000 })
  expect((await sessionCookie(guest, scaffold.baseUrl))?.expires ?? -1).toBe(-1)

  // The owner edits its own account and password from Settings, proving the current
  // password first. That rotates the session generation every other browser rides.
  await openSettings(owner, 'en')
  const dialog = owner.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('button', { name: 'Sign-in', exact: true }).click()
  // The panel leads with the signed-in account; the edit view sits behind that row.
  await dialog.getByRole('button', { name: 'Edit account and password' }).click()
  await dialog.getByLabel('Account name', { exact: true }).waitFor({ timeout: 30_000 })
  await dialog.getByLabel('Current password', { exact: true }).fill(WRONG)
  await dialog.getByLabel('New password', { exact: true }).fill(ROTATED)
  await dialog.getByLabel('Confirm new password', { exact: true }).fill(ROTATED)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await dialog.locator('text=The current password is not correct.').waitFor({ timeout: 30_000 })
  // A refused attempt clears the three secrets it sent, so the retry fills them again.
  await dialog.getByLabel('Current password', { exact: true }).fill(PASSWORD)
  await dialog.getByLabel('New password', { exact: true }).fill(ROTATED)
  await dialog.getByLabel('Confirm new password', { exact: true }).fill(ROTATED)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await dialog.locator('text=Password updated.').waitFor({ timeout: 30_000 })
  // The edited browser stays in the app while the other one loses its session.
  await owner.locator(shell).waitFor({ timeout: 30_000 })
  await guest.reload({ waitUntil: 'load' })
  await guest.locator(passwordField).waitFor({ timeout: 30_000 })
  // The new password is the only one that opens the door now.
  await guest.locator(passwordField).fill(PASSWORD)
  await guest.locator(submitButton).click()
  await guest.waitForTimeout(1_100)
  await guest.locator(passwordField).fill(ROTATED)
  await guest.locator(submitButton).click()
  await guest.locator(shell).waitFor({ timeout: 60_000 })

  // Signing other devices out drops the guest again and leaves the owner alone.
  await dialog.getByRole('button', { name: 'Sign out other devices', exact: true }).click()
  await dialog.getByRole('button', { name: 'Press again to sign them out', exact: true }).click()
  await dialog.locator('text=Signed out the other devices.').waitFor({ timeout: 30_000 })
  await owner.locator(shell).waitFor({ timeout: 30_000 })
  await guest.reload({ waitUntil: 'load' })
  await guest.locator(passwordField).waitFor({ timeout: 30_000 })
  expect(await guest.locator(accountName).inputValue()).toBe('dsh')
})
