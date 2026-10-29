import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ThemeSource = 'system' | 'light' | 'dark'

const api = {
  /** Resolve com a resposta completa; os tokens chegam antes por onToken. */
  startChat: (id: string, messages: ChatMessage[]): Promise<string> => ipcRenderer.invoke('chat:start', id, messages),
  abortChat: (id: string): Promise<void> => ipcRenderer.invoke('chat:abort', id),
  complete: (messages: ChatMessage[], format?: object): Promise<string> => ipcRenderer.invoke('chat:complete', messages, format),
  onToken: (cb: (id: string, token: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, id: string, token: string): void => cb(id, token)
    ipcRenderer.on('chat:token', listener)
    return () => ipcRenderer.removeListener('chat:token', listener)
  },
  /** Os pedaços chegam por onSpeechChunk; um pedaço null marca o fim (também em caso de erro). */
  streamSpeech: (id: string, text: string, voice: string): Promise<void> => ipcRenderer.invoke('tts:stream', id, text, voice),
  abortSpeech: (id: string): Promise<void> => ipcRenderer.invoke('tts:abort', id),
  onSpeechChunk: (cb: (id: string, chunk: Uint8Array | null) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, id: string, chunk: Uint8Array | null): void => cb(id, chunk)
    ipcRenderer.on('tts:chunk', listener)
    return () => ipcRenderer.removeListener('tts:chunk', listener)
  },
  transcribe: (wav: Uint8Array): Promise<string> => ipcRenderer.invoke('stt:transcribe', wav),
  models: (): Promise<{ chat: string; stt: string; tts: string }> => ipcRenderer.invoke('app:models'),
  getTheme: (): Promise<ThemeSource> => ipcRenderer.invoke('theme:get'),
  setTheme: (source: ThemeSource): Promise<void> => ipcRenderer.invoke('theme:set', source)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
