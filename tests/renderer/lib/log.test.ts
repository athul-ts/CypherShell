/** [NFR-06][BL-43] The renderer reports errors to the main process log instead of the console. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reportError } from '@/lib/log'

const bridge = window.api as unknown as { logRendererError: ReturnType<typeof vi.fn> }

beforeEach(() => {
  bridge.logRendererError.mockReset()
  bridge.logRendererError.mockResolvedValue(undefined)
})

describe('[BL-43] reportError', () => {
  it('sends the context and the error message through the bridge', () => {
    reportError('ProfileDetailPane', new Error('boom'))
    expect(bridge.logRendererError).toHaveBeenCalledWith('ProfileDetailPane', 'boom')
  })

  it('describes non-Error values', () => {
    reportError('x', 'plain text')
    expect(bridge.logRendererError).toHaveBeenCalledWith('x', 'plain text')
    reportError('x', { code: 1 })
    expect(bridge.logRendererError).toHaveBeenLastCalledWith('x', '{"code":1}')
  })

  it('never throws, even when the bridge fails', async () => {
    bridge.logRendererError.mockRejectedValue(new Error('ipc down'))
    expect(() => reportError('x', new Error('y'))).not.toThrow()
    bridge.logRendererError.mockImplementation(() => {
      throw new Error('sync failure')
    })
    expect(() => reportError('x', new Error('y'))).not.toThrow()
    await Promise.resolve()
  })
})
