/**
 * Single app instance (NFR-03, BL-25): a second launch hands over to the
 * running app, which brings its main window to the front.
 *
 * Deliberately free of Electron imports so it can be unit-tested.
 */

/** The parts of a BrowserWindow needed to bring it to the front. */
export interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/** Restores (if minimized), shows and focuses `win`. Returns false when there is no window to show. */
export function bringToFront(win: FocusableWindow | null | undefined): boolean {
  if (!win || win.isDestroyed()) return false
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return true
}
