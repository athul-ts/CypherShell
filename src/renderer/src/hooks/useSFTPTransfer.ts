import { useTransferStore, TransferEvent } from '../store/transferStore';

export function useSFTPTransfer(sessionId: string) {
  const { addTransfer, updateProgress } = useTransferStore();

  /**
   * Opens the SSE stream FIRST and returns a Promise that resolves once the
   * connection is open (`onopen`). This prevents the race condition where a
   * fast transfer emits `complete` before EventSource has connected.
   */
  const listenToTransfer = (transferId: string): Promise<void> => {
    return new Promise((resolve) => {
      const backendPort = (window as any).api.backendPort;
      // EventSource cannot send custom headers, so we pass the JWT as a query param
      const token = sessionStorage.getItem('jwt') || '';
      const url = `http://127.0.0.1:${backendPort}/api/sftp/${sessionId}/progress/${transferId}?token=${encodeURIComponent(token)}`;
      const source = new EventSource(url);

      // Resolve the promise the moment the SSE connection is established
      source.onopen = () => resolve();

      source.onmessage = (e) => {
        try {
          const event: TransferEvent = JSON.parse(e.data);
          updateProgress(event);
          if (event.status === 'complete' || event.status === 'error') {
            source.close();
          }
        } catch (err) {
          console.error('Failed to parse SSE event', err);
        }
      };

      source.onerror = () => {
        // Server no longer closes the connection on complete, so onerror is a genuine failure
        const currentStatus = useTransferStore.getState().transfers.find(x => x.id === transferId)?.status;
        if (currentStatus !== 'complete') {
          updateProgress({ transferId, status: 'error', message: 'SSE connection lost' });
        }
        source.close();
      };
    });
  };

  return { listenToTransfer, addTransfer };
}
