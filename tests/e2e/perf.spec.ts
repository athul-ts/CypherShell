/**
 * [NFR-01][BL-45] Cold start and renderer-ready timings of the built app. Soft gates: above
 * the NFR-01 target is a warning; above twice the target fails the run.
 *
 * Prerequisite: `npm run build:e2e`. Runs on a throwaway profile, like app.spec.ts.
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { enforce, record } from '../perf/record'

const MAIN_JS = path.resolve('out/main/index.js')

test('[NFR-01] cold start under 4 s and renderer ready under 1 s', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-perf-'))
  const started = performance.now()
  const app = await electron.launch({
    args: [
      MAIN_JS,
      `--user-data-dir=${userDataDir}`,
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])
    ],
    env: { ...process.env, ELECTRON_IS_DEV: '1' }
  })
  try {
    const win = await app.firstWindow()
    const windowOpened = performance.now()

    // firstWindow() resolves when the (hidden) BrowserWindow exists; the user sees the app when
    // main shows it on ready-to-show, so that is where the cold start ends.
    await expect
      .poll(
        () =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some((w) => w.isVisible())
          ),
        { timeout: 30000, intervals: [25] }
      )
      .toBe(true)
    const coldStart = performance.now() - started

    await expect(win.getByRole('button', { name: /continue without a password/i })).toBeVisible({
      timeout: 30000
    })
    const rendererReady = performance.now() - windowOpened

    const results = [
      record('cold-start', coldStart, 'ms', 4000, 'soft', 'launch to the window being shown'),
      record('renderer-ready', rendererReady, 'ms', 1000, 'soft', 'window to setup wizard')
    ]
    for (const r of results) {
      if (!r.pass)
        test.info().annotations.push({ type: 'warning', description: `${r.metric} ${r.value} ms` })
    }
    results.forEach(enforce)
  } finally {
    await app.close()
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
