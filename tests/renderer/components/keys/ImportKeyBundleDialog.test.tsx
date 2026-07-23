import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from '../../helpers/renderWithQuery'
import { ImportKeyBundleDialog } from '@/components/keys/ImportKeyBundleDialog'

describe('ImportKeyBundleDialog', () => {
  it('renders nothing when open=false', () => {
    const { container } = renderWithQuery(
      <ImportKeyBundleDialog open={false} onOpenChange={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the import form when open=true', () => {
    renderWithQuery(<ImportKeyBundleDialog open={true} onOpenChange={() => {}} />)
    expect(screen.getByText(/import key bundle/i)).toBeInTheDocument()
  })

  it('shows the browse file button', () => {
    renderWithQuery(<ImportKeyBundleDialog open={true} onOpenChange={() => {}} />)
    expect(screen.getByRole('button', { name: /browse/i })).toBeInTheDocument()
  })
})

/**
 * Regression: verify the &quot; entity fix (unescaped-entity lint error).
 * When a conflict name is displayed, the surrounding quotes must come from
 * &quot; entities — NOT raw " characters that would trigger the lint error
 * and potentially break JSX parsing.
 *
 * We test this at the source level: import the raw TSX source and verify
 * the &quot; pattern is present and no bare " wraps {conflict}.
 */
describe('ImportKeyBundleDialog — unescaped-entity regression', () => {
  it('uses &quot; entities for the conflict name display (not raw double-quotes)', async () => {
    const src = await import(
      '../../../../src/renderer/src/components/keys/ImportKeyBundleDialog.tsx?raw'
    )
    const text: string = (src as { default: string }).default
    // The fixed version uses &quot;{conflict}&quot;
    expect(text).toContain('&quot;{conflict}&quot;')
    // Raw double-quote wrapping like `"{conflict}"` must not be present
    expect(text).not.toMatch(/(?<![&])"(?!quot;).*\{conflict\}.*"/)
  })
})
