import { create } from 'zustand'

export interface TransferEvent {
  transferId: string
  status: 'progress' | 'complete' | 'error' | 'cancelled'
  bytesTransferred?: number
  totalBytes?: number
  percent?: number
  message?: string
}

export interface Transfer {
  id: string
  filename: string
  type: 'upload' | 'download'
  status: 'progress' | 'complete' | 'error' | 'cancelled'
  bytesTransferred: number
  totalBytes: number
  percent: number
  error?: string
  startedAt: number  // FR-04.10: for elapsed time and speed calculation
  lastBytes?: number
  lastTime?: number
  speed?: number     // bytes/sec since last progress event
}

interface TransferState {
  transfers: Transfer[]
  addTransfer: (t: Transfer) => void
  updateProgress: (e: TransferEvent) => void
  cancelTransfer: (transferId: string) => void
  clearCompleted: () => void
}

export const useTransferStore = create<TransferState>((set) => ({
  transfers: [],

  addTransfer: (t) => set((state) => ({ transfers: [...state.transfers, t] })),

  // FR-04.10: Track transfer speed (bytes/sec) from progress delta
  updateProgress: (e) =>
    set((state) => ({
      transfers: state.transfers.map((t) => {
        if (t.id === e.transferId) {
          const now = Date.now()
          const bytes = e.bytesTransferred ?? t.bytesTransferred
          let speed = t.speed
          if (e.status === 'progress' && bytes > (t.lastBytes ?? 0)) {
            const timeDelta = now - (t.lastTime ?? t.startedAt)
            if (timeDelta > 0) {
              speed = ((bytes - (t.lastBytes ?? 0)) / timeDelta) * 1000
            }
          }
          return {
            ...t,
            status: e.status,
            bytesTransferred: bytes,
            totalBytes: e.totalBytes ?? t.totalBytes,
            percent: e.percent ?? t.percent,
            error: e.message,
            speed,
            lastBytes: bytes,
            lastTime: now
          }
        }
        return t
      })
    })),

  cancelTransfer: (transferId) =>
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === transferId ? { ...t, status: 'cancelled' as const } : t
      )
    })),

  // CODE-13: Clear all finished transfers (complete, error, cancelled)
  clearCompleted: () =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.status === 'progress')
    }))
}))
