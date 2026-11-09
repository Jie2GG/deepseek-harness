/** Browser sign-in and first-password setup pages served by the Connection plugin. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const PASSWORD = 'e2e-signin-password'
const WRONG = 'wrong-password-123'
const shell = String.raw`[data-slot="root"]`
const passwordField = String.raw`input[name="password"]`

it('sets the first password, then signs a second browser in with it', async () => {
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
  await owner.locator(passwordField).waitFor({ timeout: 30_000 })
  await owner.locator(passwordField).fill(PASSWORD)
  await owner.getByRole('button').click()
  await owner.locator(shell).waitFor({ timeout: 60_000 })
  expect(await owner.locator(passwordField).count()).toBe(0)

  const guest = await newEnglishPage(browser)
  onTestFailed(() => saveFailureShot(guest, 'web-e2e-password-guest'))
  await guest.goto(scaffold.baseUrl, { waitUntil: 'load' })
  await guest.locator(passwordField).waitFor({ timeout: 30_000 })
  await guest.locator(passwordField).fill(WRONG)
  await guest.getByRole('button').click()
  // One shared refusal covers both a wrong name and a wrong password.
  await guest.locator('p.error').waitFor({ timeout: 30_000 })
  expect((await guest.locator('p.error').textContent()) ?? '').toContain('not correct')
  // The first refusal opens a one-second wait for this address and account,
  // so the retry starts after it closes.
  await guest.waitForTimeout(1_100)
  await guest.locator(passwordField).fill(PASSWORD)
  await guest.getByRole('button').click()
  await guest.locator(shell).waitFor({ timeout: 60_000 })
})
