/**
 * Dialog-bound text file IO for the renderer (BL-22).
 *
 * The renderer asks to save or open a file of a given kind; the main process
 * runs the native dialog and reads or writes only the file the user picked.
 * The renderer never supplies a path. Dialogs and file access are injected,
 * so this module has no Electron imports and is unit-tested.
 */

/** Every kind the renderer may ask for; each must have a filter below. */
export const TEXT_FILE_KINDS = ['json', 'cskb', 'pub', 'csv'] as const

export type TextFileKind = (typeof TEXT_FILE_KINDS)[number]

export interface FileFilter {
  name: string
  extensions: string[]
}

export const TEXT_FILE_FILTERS: Record<TextFileKind, FileFilter> = {
  json: { name: 'JSON Files', extensions: ['json'] },
  cskb: { name: 'CypherShell Key Bundle', extensions: ['cskb'] },
  pub: { name: 'Public Key', extensions: ['pub'] },
  csv: { name: 'CSV Files', extensions: ['csv'] } // BL-28: audit-log export
}

/** The largest text file written or read through these calls. */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024

export interface TextFileDeps {
  showSaveDialog: (options: {
    defaultPath: string
    filters: FileFilter[]
  }) => Promise<{ canceled: boolean; filePath?: string }>
  showOpenDialog: (options: {
    properties: ['openFile']
    filters: FileFilter[]
  }) => Promise<{ canceled: boolean; filePaths: string[] }>
  writeFile: (filePath: string, content: string) => Promise<void>
  readFile: (filePath: string) => Promise<string>
  stat: (filePath: string) => Promise<{ isFile: boolean; size: number }>
}

export interface OpenedTextFile {
  name: string
  content: string
}

function asRequest(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid file request')
  return raw as Record<string, unknown>
}

function parseKind(value: unknown): TextFileKind {
  const kind = TEXT_FILE_KINDS.find((k) => k === value)
  if (kind === undefined) throw new Error('Unknown file kind')
  return kind
}

/** The last path segment, for both `/` and `\` separators. */
function lastSegment(value: string): string {
  return value.split(/[\\/]/).pop() ?? ''
}

/**
 * A suggested file name: no folders (so the renderer cannot point the dialog
 * at a sensitive location) and no control characters.
 */
export function safeDefaultName(value: unknown, kind: TextFileKind): string {
  const name = Array.from(lastSegment(typeof value === 'string' ? value : ''))
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .slice(0, 255)
  return name || `export.${TEXT_FILE_FILTERS[kind].extensions[0]}`
}

/** Shows the save dialog and writes `content` to the chosen file. Returns its path, or null. */
export async function saveTextFile(raw: unknown, deps: TextFileDeps): Promise<string | null> {
  const request = asRequest(raw)
  const kind = parseKind(request.kind)
  if (typeof request.content !== 'string') throw new Error('Invalid file content')
  if (Buffer.byteLength(request.content, 'utf8') > MAX_TEXT_FILE_BYTES) {
    throw new Error('File is too large (limit 5 MB)')
  }
  const { canceled, filePath } = await deps.showSaveDialog({
    defaultPath: safeDefaultName(request.defaultName, kind),
    filters: [TEXT_FILE_FILTERS[kind], { name: 'All Files', extensions: ['*'] }]
  })
  if (canceled || !filePath) return null
  await deps.writeFile(filePath, request.content)
  return filePath
}

/** Shows the open dialog and returns the chosen file's name and UTF-8 content, or null. */
export async function openTextFile(
  raw: unknown,
  deps: TextFileDeps
): Promise<OpenedTextFile | null> {
  const kind = parseKind(asRequest(raw).kind)
  const { canceled, filePaths } = await deps.showOpenDialog({
    properties: ['openFile'],
    filters: [TEXT_FILE_FILTERS[kind]]
  })
  if (canceled || filePaths.length === 0) return null
  const filePath = filePaths[0]
  const info = await deps.stat(filePath)
  if (!info.isFile) throw new Error('The selected item is not a file')
  if (info.size > MAX_TEXT_FILE_BYTES) throw new Error('File is too large (limit 5 MB)')
  return { name: lastSegment(filePath), content: await deps.readFile(filePath) }
}
