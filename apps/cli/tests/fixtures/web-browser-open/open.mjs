import { spawn } from 'node:child_process'
import { join } from 'node:path'

const handoffProbe = `
const { writeFileSync } = require('node:fs')
const marker = process.argv[1]
const helperPid = Number(process.argv[2])
setTimeout(() => {
  let helperAlive = true
  if (process.platform === 'win32') {
    try {
      process.kill(helperPid, 0)
    } catch {
      helperAlive = false
    }
  }
  if (helperAlive) writeFileSync(marker, '')
}, 50)
`

export default async function open(url) {
  if (process.env.BROWSER_OPEN_TEST_FAILURE !== undefined) {
    throw new Error(process.env.BROWSER_OPEN_TEST_FAILURE)
  }
  const entry = await fetch(url, { redirect: 'manual' })
  let response = entry
  if (entry.status === 303) {
    // A launch-token handoff trades the token for a session, then reads the page.
    const setCookie = entry.headers.get('set-cookie')
    const location = entry.headers.get('location')
    if (setCookie === null || location === null) {
      throw new Error(`browser token exchange returned HTTP 303 without a session cookie`)
    }
    response = await fetch(new URL(location, url), { headers: { cookie: setCookie.split(';', 1)[0] } })
  }
  const html = await response.text()
  console.log(`dsh browser-open: ${JSON.stringify({
    url,
    status: response.status,
    bootManifest: html.includes('__DSH_BOOT__'),
    apiKeyPresent: process.env.DEEPSEEK_API_KEY !== undefined,
    dshHomePresent: process.env.DSH_HOME !== undefined,
  })}`)
  // The Windows launcher writes the server-exit marker only while its helper
  // remains alive, so the assembled test detects an early helper exit.
  const launcher = spawn(process.execPath, [
    '--eval', handoffProbe,
    '--', join(process.cwd(), `.dsh-browser-open-${process.ppid}`), String(process.pid),
  ], { stdio: 'ignore' })
  launcher.unref()
  return launcher
}
