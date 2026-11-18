import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { ShieldAlert, CircleDot } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { useTerminalThemeStore } from '../../store/terminalThemeStore'
import { TERMINAL_THEMES } from '../../lib/terminalThemes'
import { decodeOutput, encodeInput } from '../../lib/terminalCodec'
import {
  APP_LOCKED_CLOSE_CODE,
  openTerminalLink,
  shouldReconnect,
  terminalSocketUrl
} from '../../lib/terminalSocket'
import '@xterm/xterm/css/xterm.css'

interface TerminalPaneProps {
  sessionId: string
}

function getWsToken(): string | null {
  return sessionStorage.getItem('jwt')
}

export function TerminalPane({ sessionId }: TerminalPaneProps): React.JSX.Element {
  const terminalRef = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const fitAddon = useRef<FitAddon | null>(null)
  /** Refits the terminal and tells the remote PTY its new size; set by the main effect. */
  const syncSize = useRef<() => void>(() => undefined)
  const reconnectRef = useRef<{ attempt: number; timer?: ReturnType<typeof setTimeout> }>({
    attempt: 0
  })
  const [status, setStatus] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
  >('connecting')
  const { theme, fontSize, fontFamily } = useTerminalThemeStore()

  useEffect(() => {
    if (!terminalRef.current) return

    // Initialize xterm
    term.current = new Terminal({
      cursorBlink: true,
      fontFamily: fontFamily,
      fontSize: fontSize,
      theme: TERMINAL_THEMES[theme] || TERMINAL_THEMES.dark
    })

    fitAddon.current = new FitAddon()
    term.current.loadAddon(fitAddon.current)
    term.current.loadAddon(new WebLinksAddon(openTerminalLink)) // BL-21
    term.current.loadAddon(new SearchAddon())

    term.current.open(terminalRef.current)
    fitAddon.current.fit()

    // Copy selected text to clipboard whenever the selection changes (copy-on-select)
    term.current.onSelectionChange(() => {
      if (!term.current?.hasSelection()) return
      const selected = term.current.getSelection()
      if (selected) {
        navigator.clipboard.writeText(selected).catch(() => undefined)
      }
    })

    // Right-click pastes clipboard content into the terminal
    const contextmenuHandler = (e: MouseEvent): void => {
      e.preventDefault()
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text && ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ type: 'input', data: encodeInput(text) }))
          }
        })
        .catch(() => {
          /* Clipboard access denied — ignore silently */
        })
    }
    terminalRef.current.addEventListener('contextmenu', contextmenuHandler)

    const backendPort = window.api.backendPort
    const wsToken = getWsToken()
    let wsDisconnected = false
    let intentionalClose = false

    // FR-02.6 — Auto-reconnect with exponential backoff (max 3 attempts)
    function connectWs(): void {
      const wsUrl = terminalSocketUrl(backendPort, sessionId, wsToken, window.api.launchSecret)
      // Detach the old socket first so closing it cannot run the reconnect logic again.
      if (ws.current) {
        ws.current.onclose = null
        ws.current.onerror = null
        ws.current.close()
      }
      wsDisconnected = false // each attempt starts fresh — otherwise later drops are ignored
      ws.current = new WebSocket(wsUrl)

      ws.current.onopen = () => {
        setStatus('connected')
        wsDisconnected = false
        reconnectRef.current.attempt = 0
        if (fitAddon.current && term.current) {
          ws.current?.send(
            JSON.stringify({ type: 'resize', cols: term.current.cols, rows: term.current.rows })
          )
        }
      }

      ws.current.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'output' && term.current) {
          // BL-15: write bytes, not a Latin-1 string, so UTF-8 renders correctly
          term.current.write(decodeOutput(msg.data))
        } else if (msg.type === 'status') {
          setStatus(msg.state)
        } else if (msg.type === 'error') {
          setStatus('error')
          term.current?.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`)
        }
      }

      ws.current.onclose = (event) => {
        if (wsDisconnected) return
        wsDisconnected = true
        setStatus('disconnected')

        // BL-18: the app locked — the shell is gone and this window is closing
        if (event.code === APP_LOCKED_CLOSE_CODE) {
          term.current?.write('\r\n\x1b[33mApp locked.\x1b[0m\r\n')
          return
        }

        if (intentionalClose) {
          term.current?.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n')
          return
        }

        // BL-29: the shell ended (`exit`) or the session is gone — reconnecting
        // would open a fresh shell or fail, so stop here.
        if (!shouldReconnect(event.code)) {
          term.current?.write(
            event.code === 1008
              ? '\r\n\x1b[31mSession no longer exists.\x1b[0m\r\n'
              : '\r\n\x1b[33mSession ended.\x1b[0m\r\n'
          )
          return
        }

        // Auto-reconnect with exponential backoff (FR-02.6)
        const { attempt } = reconnectRef.current
        if (attempt < 3) {
          const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
          term.current?.write(
            `\r\n\x1b[33mConnection lost. Reconnecting in ${delay / 1000}s... (attempt ${attempt + 1}/3)\x1b[0m\r\n`
          )
          reconnectRef.current.attempt = attempt + 1
          setStatus('reconnecting')
          reconnectRef.current.timer = setTimeout(connectWs, delay)
        } else {
          term.current?.write(
            '\r\n\x1b[31mConnection lost. Max reconnect attempts reached.\x1b[0m\r\n'
          )
        }
      }

      // A failed or dropped socket always fires `close` after `error`, and `close`
      // decides whether to reconnect — so `error` must not mark it handled.
      ws.current.onerror = () => {
        if (!wsDisconnected) setStatus('error')
      }
    }

    connectWs()

    // Handle user input
    term.current.onData((data) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'input', data: encodeInput(data) }))
      }
    })

    // Handle resize
    syncSize.current = () => {
      if (fitAddon.current && term.current) {
        fitAddon.current.fit()
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(
            JSON.stringify({ type: 'resize', cols: term.current.cols, rows: term.current.rows })
          )
        }
      }
    }
    const resizeObserver = new ResizeObserver(() => syncSize.current())
    resizeObserver.observe(terminalRef.current)

    // BL-35: xterm measures glyphs once and does not notice a web font finishing loading, so
    // re-measure when one does (nudging the size makes it measure again), then refit.
    const fonts = document.fonts as FontFaceSet | undefined
    const onFontsLoaded = (): void => {
      const terminal = term.current
      if (!terminal) return
      const size = terminal.options.fontSize ?? 14
      terminal.options.fontSize = size + 1
      terminal.options.fontSize = size
      syncSize.current()
    }
    fonts?.addEventListener?.('loadingdone', onFontsLoaded)
    fonts?.load?.(`${fontSize}px "JetBrains Mono"`).catch(() => undefined)

    return () => {
      intentionalClose = true
      wsDisconnected = true
      if (reconnectRef.current.timer) clearTimeout(reconnectRef.current.timer)
      reconnectRef.current.attempt = 0
      resizeObserver.disconnect()
      fonts?.removeEventListener?.('loadingdone', onFontsLoaded)
      if (terminalRef.current) {
        terminalRef.current.removeEventListener('contextmenu', contextmenuHandler)
      }
      ws.current?.close()
      term.current?.dispose()
    }
  }, [sessionId])

  // BL-35: a theme or font change in Settings reaches terminals that are already open.
  useEffect(() => {
    const terminal = term.current
    if (!terminal) return
    terminal.options.theme = TERMINAL_THEMES[theme] || TERMINAL_THEMES.dark
    terminal.options.fontSize = fontSize
    terminal.options.fontFamily = fontFamily
    syncSize.current() // glyph size changed: refit, and tell the remote PTY the new grid
  }, [theme, fontSize, fontFamily])

  const background = (TERMINAL_THEMES[theme] || TERMINAL_THEMES.dark).background

  return (
    // The surround takes the terminal theme's colour, so it matches in both app themes.
    <div className="flex flex-col h-full relative" style={{ backgroundColor: background }}>
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border shadow-lg backdrop-blur-sm ${
            status === 'connected'
              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
              : status === 'error'
                ? 'bg-red-500/10 text-red-500 border-red-500/20'
                : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
          }`}
        >
          {status === 'connected' && <CircleDot className="w-3.5 h-3.5" />}
          {(status === 'connecting' || status === 'reconnecting') && (
            <CircleDot className="w-3.5 h-3.5 animate-pulse" />
          )}
          {status === 'error' && <ShieldAlert className="w-3.5 h-3.5" />}

          {status === 'connected'
            ? 'Connected'
            : status === 'connecting'
              ? 'Connecting...'
              : status === 'reconnecting'
                ? 'Reconnecting...'
                : 'Connection Lost'}
        </div>
      </div>

      <div className="flex-1 w-full h-full p-4 overflow-hidden">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  )
}
