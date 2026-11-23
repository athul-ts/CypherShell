/** [FR-05.1][BL-12] The generator offers RSA 4096 and sends the key size to the API. */
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../helpers/renderWithQuery'
import { KeyGeneratorModal } from '@/components/keys/KeyGeneratorModal'
import { api } from '@/lib/api'

const mockApi = api as unknown as { post: ReturnType<typeof vi.fn> }

describe('[FR-05.1][BL-12] KeyGeneratorModal', () => {
  it('sends { type: "rsa", bits: 4096 } for the RSA 4096 choice', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, id: 'k1' } })
    renderWithQuery(<KeyGeneratorModal open onOpenChange={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/my personal laptop/i), {
      target: { value: 'Big key' }
    })
    fireEvent.change(screen.getByLabelText('Algorithm'), { target: { value: 'rsa-4096' } })
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(mockApi.post).toHaveBeenCalledWith(
      '/keys/generate',
      expect.objectContaining({ name: 'Big key', type: 'rsa', bits: 4096 })
    )
  })

  it('sends no key size for ED25519', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, id: 'k2' } })
    renderWithQuery(<KeyGeneratorModal open onOpenChange={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/my personal laptop/i), {
      target: { value: 'Small key' }
    })
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const body = mockApi.post.mock.calls[0][1]
    expect(body).toMatchObject({ type: 'ed25519' })
    expect(body).not.toHaveProperty('bits')
  })
})
