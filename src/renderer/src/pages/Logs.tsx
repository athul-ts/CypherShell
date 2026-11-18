import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../lib/api'
import {
  FileText,
  Download,
  CheckCircle2,
  XCircle,
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'

interface LogEntry {
  id: string
  type: string
  detail: string
  profileName?: string | null
  timestamp: string
  errorMessage?: string | null
  success: boolean
}

/** One page of the audit log, as the API answers it (FR-08.5). */
interface LogPage {
  items: LogEntry[]
  total: number
  page: number
  pageSize: number
}

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 300
const RANGE_DAYS: Record<string, number> = { today: 1, week: 7, month: 30 }

/** The value, but only after it has stopped changing for `ms` — keeps typing from querying per key. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** An error's message without Electron's "Error invoking remote method '…': Error: " prefix. */
function failureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}

/**
 * FR-08.6 / BL-28: the CSV is fetched through the API client, so the JWT and
 * launch secret are sent, and main shows the save dialog and writes it.
 */
async function exportAuditLogs(): Promise<void> {
  try {
    const { data: csv } = await api.get<string>('/audit/export', { responseType: 'text' })
    const savedTo = await window.api.saveTextFile({
      kind: 'csv',
      defaultName: `cyphershell-audit-${format(new Date(), 'yyyy-MM-dd')}.csv`,
      content: csv
    })
    if (savedTo) toast.success('Audit logs exported.')
  } catch (err) {
    toast.error(`Export failed: ${failureReason(err)}`)
  }
}

export default function Logs(): React.JSX.Element {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterDate, setFilterDate] = useState('all')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const queryClient = useQueryClient()
  const search = useDebounced(searchTerm.trim(), SEARCH_DEBOUNCE_MS)

  // FR-08.5: the API filters and pages; changing a filter goes back to page 1.
  const { data, isLoading } = useQuery({
    queryKey: ['logs', page, filterType, filterDate, search],
    queryFn: async (): Promise<LogPage> => {
      const days = RANGE_DAYS[filterDate]
      const res = await api.get<LogPage>('/audit', {
        params: {
          page,
          pageSize: PAGE_SIZE,
          ...(filterType !== 'all' && { type: filterType }),
          ...(days && { from: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() }),
          ...(search && { q: search })
        }
      })
      return res.data
    },
    refetchInterval: 5000 // Refresh every 5s just in case
  })
  const logs = data?.items
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      await exportAuditLogs()
    } finally {
      setExporting(false)
    }
  }

  const handleClearAll = async (): Promise<void> => {
    if (!confirm('Delete all audit logs permanently? This cannot be undone.')) return
    await api.delete('/audit')
    queryClient.invalidateQueries({ queryKey: ['logs'] })
  }

  return (
    <div className="flex-1 p-8 bg-[#0a0a0f] h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-200">Audit Logs</h1>
          <p className="text-slate-500 mt-1">
            Review connection history and file transfer activity.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
        <button
          onClick={handleClearAll}
          className="bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-300 px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors border border-slate-700"
        >
          <Trash2 className="w-4 h-4" /> Clear All
        </button>
      </div>

      <div className="bg-[#151821] border border-slate-800 rounded-xl flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center gap-4 bg-slate-900/50 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setPage(1)
              }}
              placeholder="Search logs..."
              className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors text-sm"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value)
              setPage(1)
            }}
            className="bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors text-sm min-w-[150px]"
          >
            <option value="all">All Types</option>
            <option value="connection">Connection</option>
            <option value="disconnection">Disconnection</option>
            <option value="sftp_upload">SFTP Upload</option>
            <option value="sftp_download">SFTP Download</option>
            <option value="key_used">Key Used</option>
          </select>
          <select
            value={filterDate}
            onChange={(e) => {
              setFilterDate(e.target.value)
              setPage(1)
            }}
            className="bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors text-sm min-w-[150px]"
          >
            <option value="all">All Time</option>
            <option value="today">Past 24 Hours</option>
            <option value="week">Past 7 Days</option>
            <option value="month">Past 30 Days</option>
          </select>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="text-center py-12 text-slate-500">Loading logs...</div>
          ) : logs?.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <div className="text-slate-400">No logs found matching your criteria.</div>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase border-b border-slate-800 bg-[#1a1c23] sticky top-0">
                <tr>
                  <th className="px-6 py-3 font-medium">Timestamp</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Profile</th>
                  <th className="px-6 py-3 font-medium">Detail</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs?.map((log: LogEntry) => (
                  <tr
                    key={log.id}
                    className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-6 py-3 text-slate-400 whitespace-nowrap">
                      {format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss')}
                    </td>
                    <td className="px-6 py-3">
                      <span className="bg-slate-800 text-slate-300 px-2 py-1 rounded text-xs">
                        {log.type}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-300 font-medium whitespace-nowrap">
                      {log.profileName || '-'}
                    </td>
                    <td className="px-6 py-3 text-slate-400">
                      <div className="truncate max-w-md" title={log.detail}>
                        {log.detail}
                      </div>
                      {log.errorMessage && (
                        <div
                          className="text-red-400 text-xs mt-1 truncate max-w-md"
                          title={log.errorMessage}
                        >
                          {log.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      {log.success ? (
                        <span className="flex items-center gap-1.5 text-emerald-500 text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Success
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
                          <XCircle className="w-3.5 h-3.5" /> Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">
          <span>
            {total === 0
              ? 'No entries'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className="rounded-lg border border-slate-700 p-1.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="rounded-lg border border-slate-700 p-1.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
