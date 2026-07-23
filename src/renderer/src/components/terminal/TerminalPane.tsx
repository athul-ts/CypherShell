import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { ShieldAlert, CircleDot } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { useTerminalThemeStore } from '../../store/terminalThemeStore'
import { TERMINAL_THEMES } from '../../lib/terminalThemes'
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
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>(
    'connecting'
  )
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
    term.current.loadAddon(new WebLinksAddon())
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
    terminalRef.current.addEventListener('contextmenu', async (e) => {
      e.preventDefault()
      try {
        const text = await navigator.clipboard.readText()
        if (text && ws.current?.readyState === WebSocket.OPEN) {
          const bytes = new TextEncoder().encode(text)
          const binary = Array.from(bytes, (b) => String.fromCodePoint(b)).join('')
          ws.current.send(JSON.stringify({ type: 'input', data: btoa(binary) }))
        }
      } catch {
        // Clipboard access denied — ignore silently
      }
    })

    // Connect WebSocket with JWT auth token (SEC-03)
    const backendPort = window.api.backendPort
    const wsToken = getWsToken()
    const wsUrl = `ws://127.0.0.1:${backendPort}/ws/terminal/${sessionId}${wsToken ? `?token=${encodeURIComponent(wsToken)}` : ''}`
    ws.current = new WebSocket(wsUrl)

    ws.current.onopen = () => {
      setStatus('connected')
      if (fitAddon.current && term.current) {
        ws.current?.send(
          JSON.stringify({ type: 'resize', cols: term.current.cols, rows: term.current.rows })
        )
      }
    }

    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'output' && term.current) {
        term.current.write(atob(msg.data))
      } else if (msg.type === 'status') {
        setStatus(msg.state)
      } else if (msg.type === 'error') {
        setStatus('error')
        term.current?.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`)
      }
    }

    ws.current.onclose = () => {
      setStatus('disconnected')
      term.current?.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n')
    }

    // Handle user input
    term.current.onData((data) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'input', data: btoa(data) }))
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon.current && term.current) {
        fitAddon.current.fit()
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(
            JSON.stringify({ type: 'resize', cols: term.current.cols, rows: term.current.rows })
          )
        }
      }
    })
    resizeObserver.observe(terminalRef.current)

    return () => {
      resizeObserver.disconnect()
      ws.current?.close()
      term.current?.dispose()
    }
  }, [sessionId])

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] relative">
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
          {status === 'connecting' && <CircleDot className="w-3.5 h-3.5 animate-pulse" />}
          {status === 'error' && <ShieldAlert className="w-3.5 h-3.5" />}

          {status === 'connected'
            ? 'Connected'
            : status === 'connecting'
              ? 'Connecting...'
              : 'Connection Lost'}
        </div>
      </div>

      <div className="flex-1 w-full h-full p-4 overflow-hidden">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  )
}
