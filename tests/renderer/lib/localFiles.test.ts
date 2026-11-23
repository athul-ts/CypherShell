/** [NFR-02][BL-47] Drag payloads carry grants, are parsed defensively, and never a path. */
import { describe, it, expect } from 'vitest'
import {
  LOCAL_FILE_MIME,
  REMOTE_FILE_MIME,
  localFileDragPayload,
  readLocalFileDrag,
  readRemoteFileDrag
} from '@/lib/localFiles'

const GRANT = 'a'.repeat(32)
const dt = (type: string, value: string): Pick<DataTransfer, 'getData'> => ({
  getData: (requested: string) => (requested === type ? value : '')
})

describe('[BL-47] local file drags', () => {
  it('round-trips a grant and a name', () => {
    const payload = localFileDragPayload(GRANT, 'report.pdf')
    expect(readLocalFileDrag(dt(LOCAL_FILE_MIME, payload))).toEqual({
      grant: GRANT,
      name: 'report.pdf'
    })
  })

  it('ignores a text/plain drop — it is never a local path', () => {
    const plain = { getData: (type: string) => (type === 'text/plain' ? '/etc/passwd' : '') }
    expect(readLocalFileDrag(plain)).toBeNull()
  })

  it.each([
    ['empty data', ''],
    ['text that is not JSON', 'not json'],
    ['JSON that is not an object', '5'],
    ['no grant', JSON.stringify({ name: 'a.txt' })],
    ['a path as the grant', JSON.stringify({ grant: '/etc/passwd', name: 'a.txt' })],
    ['an upper-case grant', JSON.stringify({ grant: 'A'.repeat(32), name: 'a.txt' })],
    ['no name', JSON.stringify({ grant: GRANT })],
    ['an empty name', JSON.stringify({ grant: GRANT, name: '' })],
    ['a name that is too long', JSON.stringify({ grant: GRANT, name: 'x'.repeat(256) })],
    ['a name that is not text', JSON.stringify({ grant: GRANT, name: 5 })]
  ])('returns null for %s', (_label, data) => {
    expect(readLocalFileDrag(dt(LOCAL_FILE_MIME, data))).toBeNull()
  })
})

describe('[BL-47] remote file drags', () => {
  it('reads the file a remote row carries', () => {
    const data = JSON.stringify({ filename: 'a.txt', remotePath: '/srv/a.txt', size: 12 })
    expect(readRemoteFileDrag(dt(REMOTE_FILE_MIME, data))).toEqual({
      filename: 'a.txt',
      remotePath: '/srv/a.txt',
      size: 12
    })
  })

  it.each([
    ['empty data', ''],
    ['text that is not JSON', '{oops'],
    ['an array', '[]'],
    ['no filename', JSON.stringify({ remotePath: '/a', size: 1 })],
    ['no remote path', JSON.stringify({ filename: 'a', size: 1 })],
    ['a size that is not a number', JSON.stringify({ filename: 'a', remotePath: '/a', size: 'x' })]
  ])('returns null for %s instead of throwing', (_label, data) => {
    expect(() => readRemoteFileDrag(dt(REMOTE_FILE_MIME, data))).not.toThrow()
    expect(readRemoteFileDrag(dt(REMOTE_FILE_MIME, data))).toBeNull()
  })
})
