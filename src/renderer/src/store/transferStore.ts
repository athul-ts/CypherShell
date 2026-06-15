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

  updateProgress: (e) =>
    set((state) => ({
      transfers: state.transfers.map((t) => {
        if (t.id === e.transferId) {
          return {
            ...t,
            status: e.status,
            bytesTransferred: e.bytesTransferred ?? t.bytesTransferred,
            totalBytes: e.totalBytes ?? t.totalBytes,
            percent: e.percent ?? t.percent,
            error: e.message
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

  clearCompleted: () =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.status === 'progress')
    }))
}))
