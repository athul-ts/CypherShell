/**
 * [FR-05.9][FR-09.1][FR-09.4][FR-10.1][FR-10.4][BL-22] Every export and import
 * goes through the dialog-bound `saveTextFile` / `openTextFile` calls — the
 * renderer never names a file path.
 *
 * Regression: these five callers read and wrote paths through the generic
 * `executeLocalFileOp('readFile' | 'writeFile')`.
 */
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithQuery } from './helpers/renderWithQuery'
import Home from '@/pages/Home'
import Keys from '@/pages/Keys'
import { ExportKeyBundleDialog } from '@/components/keys/ExportKeyBundleDialog'
import { ImportKeyBundleDialog } from '@/components/keys/ImportKeyBundleDialog'
import { api } from '@/lib/api'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}
const bridge = window.api as unknown as {
  saveTextFile: ReturnType<typeof vi.fn>
  openTextFile: ReturnType<typeof vi.fn>
}

describe('[BL-22] the preload surface', () => {
  it('has no call that reads or writes a renderer-supplied path', () => {
    const names = Object.keys(window.api)
    expect(names).not.toContain('executeLocalFileOp')
    expect(names).not.toContain('openJsonFileDialog')
    expect(names).not.toContain('openCskbFileDialog')
    expect((window as unknown as { electron?: unknown }).electron).toBeUndefined()
  })
})

describe('[FR-09.1][FR-09.4][BL-22] profile export and import (Home)', () => {
  function renderHome(): void {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/profiles/export') {
        return Promise.resolve({ data: { version: 1, profiles: [{ name: 'web' }] } })
      }
      if (url === '/config') return Promise.resolve({ data: { lockEnabled: true } })
      return Promise.resolve({ data: [] })
    })
    renderWithQuery(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    )
  }

  it('Export All hands the JSON to saveTextFile', async () => {
    bridge.saveTextFile.mockResolvedValue('D:\\exports\\profiles-export.json')
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: /export all/i }))
    await waitFor(() => expect(bridge.saveTextFile).toHaveBeenCalled())
    const request = bridge.saveTextFile.mock.calls[0][0]
    expect(request).toMatchObject({ kind: 'json', defaultName: 'profiles-export.json' })
    expect(JSON.parse(request.content)).toEqual({ version: 1, profiles: [{ name: 'web' }] })
  })

  it('Import reads the picked file through openTextFile and posts its profiles', async () => {
    bridge.openTextFile.mockResolvedValue({
      name: 'backup.json',
      content: JSON.stringify({ profiles: [{ name: 'db', host: 'db.local' }] })
    })
    mockApi.post.mockResolvedValue({ data: { created: 1, skipped: 0, overwritten: 0 } })
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: /^import$/i }))
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/profiles/import', {
        profiles: [{ name: 'db', host: 'db.local' }]
      })
    )
    expect(bridge.openTextFile).toHaveBeenCalledWith({ kind: 'json' })
  })

  it('a cancelled import posts nothing', async () => {
    bridge.openTextFile.mockResolvedValue(null)
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: /^import$/i }))
    await waitFor(() => expect(bridge.openTextFile).toHaveBeenCalled())
    expect(mockApi.post).not.toHaveBeenCalled()
  })
})

describe('[FR-05.9][BL-22] public-key export (Keys)', () => {
  it('Save to File hands the public key to saveTextFile', async () => {
    mockApi.get.mockResolvedValue({
      data: [
        {
          id: 'k1',
          name: 'my key',
          keyType: 'ed25519',
          fingerprint: 'SHA256:x',
          publicKey: 'ssh-ed25519 AAAAtest',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    bridge.saveTextFile.mockResolvedValue('/home/me/my_key.pub')
    renderWithQuery(<Keys />)
    fireEvent.click(await screen.findByRole('button', { name: /save to file/i }))
    await waitFor(() =>
      expect(bridge.saveTextFile).toHaveBeenCalledWith({
        kind: 'pub',
        defaultName: 'my_key.pub',
        content: 'ssh-ed25519 AAAAtest'
      })
    )
  })
})

describe('[FR-10.1][FR-10.4][BL-22] key bundles', () => {
  it('ExportKeyBundleDialog writes the bundle through saveTextFile', async () => {
    mockApi.post.mockResolvedValue({ data: { version: 1, keyName: 'k' } })
    bridge.saveTextFile.mockResolvedValue('/backups/k.cskb')
    const onOpenChange = vi.fn()
    renderWithQuery(
      <ExportKeyBundleDialog open={true} keyId="k1" keyName="k" onOpenChange={onOpenChange} />
    )
    fireEvent.change(screen.getByPlaceholderText('Choose a strong passphrase'), {
      target: { value: 'bundle-pass' }
    })
    fireEvent.change(screen.getByPlaceholderText('Re-enter passphrase'), {
      target: { value: 'bundle-pass' }
    })
    fireEvent.submit(screen.getByPlaceholderText('Re-enter passphrase').closest('form')!)
    await waitFor(() => expect(bridge.saveTextFile).toHaveBeenCalled())
    const request = bridge.saveTextFile.mock.calls[0][0]
    expect(request).toMatchObject({ kind: 'cskb', defaultName: 'k.cskb' })
    expect(JSON.parse(request.content)).toEqual({ version: 1, keyName: 'k' })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('ImportKeyBundleDialog reads the picked .cskb through openTextFile', async () => {
    bridge.openTextFile.mockResolvedValue({ name: 'laptop.cskb', content: '{"version":1}' })
    renderWithQuery(<ImportKeyBundleDialog open={true} onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /browse/i }))
    expect(await screen.findByText('laptop.cskb')).toBeInTheDocument()
    expect(bridge.openTextFile).toHaveBeenCalledWith({ kind: 'cskb' })
  })
})
