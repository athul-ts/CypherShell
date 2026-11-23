/**
 * [NFR-07][BL-24] On macOS (unsigned builds) the update banner offers the
 * GitHub Releases download instead of an install that cannot succeed.
 */
import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { UpdateBanner } from '@/components/layout/UpdateBanner'

type Listener<T> = (arg: T) => void

const bridge = window.api as unknown as {
  onUpdateAvailable: ReturnType<typeof vi.fn>
  onUpdateDownloaded: ReturnType<typeof vi.fn>
  installUpdate: ReturnType<typeof vi.fn>
  openDownloadPage: ReturnType<typeof vi.fn>
}

function renderBanner(): {
  announce: Listener<{ version: string; manual: boolean }>
  downloaded: () => void
} {
  let announce: Listener<{ version: string; manual: boolean }> = () => {}
  let downloaded = (): void => {}
  bridge.onUpdateAvailable.mockImplementation((cb: typeof announce) => {
    announce = cb
    return () => {}
  })
  bridge.onUpdateDownloaded.mockImplementation((cb: () => void) => {
    downloaded = cb
    return () => {}
  })
  render(<UpdateBanner />)
  return {
    announce: (info) => act(() => announce(info)),
    downloaded: () => act(() => downloaded())
  }
}

describe('[BL-24] UpdateBanner', () => {
  it('shows nothing until an update is announced', () => {
    renderBanner()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a manual (macOS) update offers the Releases download, never an install', () => {
    const { announce } = renderBanner()
    announce({ version: '1.2.0', manual: true })
    expect(screen.getByText(/CypherShell 1\.2\.0 is available/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /download from github releases/i }))
    expect(bridge.openDownloadPage).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /restart & install/i })).toBeNull()
  })

  it('an automatic update downloads, then offers Restart & Install', () => {
    const { announce, downloaded } = renderBanner()
    announce({ version: '1.2.0', manual: false })
    expect(screen.getByText(/downloading in the background/i)).toBeInTheDocument()
    downloaded()
    fireEvent.click(screen.getByRole('button', { name: /restart & install/i }))
    expect(bridge.installUpdate).toHaveBeenCalled()
  })
})
