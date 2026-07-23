import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { FileText, Download, CheckCircle2, XCircle, Search, Trash2 } from 'lucide-react'
import { format, isAfter, subDays, subMonths } from 'date-fns'
import { useState } from 'react'

interface LogEntry {
  id: string
  type: string
  detail: string
  profileName?: string | null
  timestamp: string
  errorMessage?: string | null
  success: boolean
}

export default function Logs(): React.JSX.Element {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterDate, setFilterDate] = useState('all')
  const queryClient = useQueryClient()

  const { data: logs, isLoading } = useQuery({
    queryKey: ['logs'],
    queryFn: async (): Promise<LogEntry[]> => {
      const res = await api.get<LogEntry[]>('/audit')
      return res.data
    },
    refetchInterval: 5000 // Refresh every 5s just in case
  })

  const handleExport = (): void => {
    const backendPort = window.api.backendPort
    window.location.href = `http://127.0.0.1:${backendPort}/api/audit/export`
  }

  const handleClearAll = async (): Promise<void> => {
    if (!confirm('Delete all audit logs permanently? This cannot be undone.')) return
    await api.delete('/audit')
    queryClient.invalidateQueries({ queryKey: ['logs'] })
  }

  const filteredLogs = logs?.filter((log: LogEntry) => {
    // Text search
    const matchesSearch =
      log.detail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.profileName && log.profileName.toLowerCase().includes(searchTerm.toLowerCase()))

    // Type filter
    const matchesType = filterType === 'all' || log.type === filterType

    // Date filter
    let matchesDate = true
    if (filterDate !== 'all') {
      const logDate = new Date(log.timestamp)
      const now = new Date()
      if (filterDate === 'today') matchesDate = isAfter(logDate, subDays(now, 1))
      else if (filterDate === 'week') matchesDate = isAfter(logDate, subDays(now, 7))
      else if (filterDate === 'month') matchesDate = isAfter(logDate, subMonths(now, 1))
    }

    return matchesSearch && matchesType && matchesDate
  })

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
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
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
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search logs..."
              className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors text-sm"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors text-sm min-w-[150px]"
          >
            <option value="all">All Types</option>
            <option value="connection">Connection</option>
            <option value="sftp_upload">SFTP Upload</option>
            <option value="sftp_download">SFTP Download</option>
            <option value="key_used">Key Used</option>
          </select>
          <select
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
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
          ) : filteredLogs?.length === 0 ? (
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
                {filteredLogs?.map((log: LogEntry) => (
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
      </div>
    </div>
  )
}
