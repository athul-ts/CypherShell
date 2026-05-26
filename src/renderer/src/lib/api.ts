import axios from 'axios';

declare global {
  interface Window {
    api: {
      backendPort: number;
      openFileDialog: () => Promise<string[]>;
      openDirectoryDialog: () => Promise<string | null>;
      saveFileDialog: (defaultName: string) => Promise<string | null>;
      appVersion: string;
      installUpdate: () => Promise<void>;
      onUpdateAvailable: (cb: () => void) => () => void;
      onUpdateDownloaded: (cb: () => void) => () => void;
    };
  }
}

const BASE_URL = `http://127.0.0.1:${window.api?.backendPort ?? 4000}/api`;

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('jwt');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
