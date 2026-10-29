import { app, BrowserWindow, ipcMain, nativeTheme, session } from 'electron'
import { join } from 'node:path'
import { MODELS, complete, ensureModels, streamChat, speak, speakStream, transcribe, type ChatMessage } from './ollama'

export type ThemeSource = 'system' | 'light' | 'dark'

const TITLEBAR_HEIGHT = 44
let win: BrowserWindow | null = null
const activeChats = new Map<string, AbortController>()
const activeSpeech = new Map<string, AbortController>()

// Cor dos botões nativos (minimizar/maximizar/fechar) acompanha o tema.
const overlay = (): Electron.TitleBarOverlay => ({
  color: '#00000000',
  symbolColor: nativeTheme.shouldUseDarkColors ? '#8590a6' : '#6b7486',
  height: TITLEBAR_HEIGHT
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 560,
    minHeight: 520,
    title: 'Friday',
    // Vidro nativo do Windows 11; o CSS também pinta um fundo translúcido caso não haja suporte.
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('chat:start', async (event, id: string, messages: ChatMessage[]) => {
    await modelsReady()
    const controller = new AbortController()
    activeChats.set(id, controller)
    try {
      return await streamChat(messages, (token) => event.sender.send('chat:token', id, token), controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return '' // interrompida pelo aluno: não é erro
      throw err
    } finally {
      activeChats.delete(id)
    }
  })
  ipcMain.handle('chat:abort', (_e, id: string) => activeChats.get(id)?.abort())
  ipcMain.handle('chat:complete', async (_e, messages: ChatMessage[], format?: object) => {
    await modelsReady()
    return complete(messages, format)
  })
  ipcMain.handle('tts:stream', async (event, id: string, text: string, voice: string) => {
    await modelsReady()
    const controller = new AbortController()
    activeSpeech.set(id, controller)
    try {
      await speakStream(text, voice, (chunk) => event.sender.send('tts:chunk', id, chunk), controller.signal)
    } catch (err) {
      if (!controller.signal.aborted) throw err // abortar faz parte de interromper a fala
    } finally {
      activeSpeech.delete(id)
      // O fim vai pelo mesmo canal dos pedaços, então nunca chega antes do último deles.
      event.sender.send('tts:chunk', id, null)
    }
  })
  ipcMain.handle('tts:abort', (_e, id: string) => activeSpeech.get(id)?.abort())
  ipcMain.handle('stt:transcribe', async (_e, wav: Uint8Array) => {
    await modelsReady()
    return transcribe(wav)
  })
  ipcMain.handle('app:models', () => MODELS)
  ipcMain.handle('theme:get', () => nativeTheme.themeSource)
  ipcMain.handle('theme:set', (_e, source: ThemeSource) => {
    nativeTheme.themeSource = source
  })
}

// A API de voz não aceita keep_alive e o Ollama descarrega o modelo após 4 min parado;
// recarregar custa ~5 s na primeira fala. Um "ok" a cada 3 min mantém a voz pronta.
const VOICE_KEEPALIVE_MS = 3 * 60 * 1000
// Se o Ollama ainda não estiver no ar, as chamadas seguem com os modelos base e a próxima tenta de novo.
let modelsSetup: Promise<boolean> | null = null
function modelsReady(): Promise<boolean> {
  modelsSetup ??= ensureModels()
    .then(() => {
      warmVoice()
      return true
    })
    .catch((err) => {
      console.error('Variantes indisponíveis, usando os modelos base:', err)
      modelsSetup = null
      return false
    })
  return modelsSetup
}

function warmVoice(): void {
  speak('ok', 'default').catch(() => undefined)
}

app.whenReady().then(() => {
  void modelsReady()
  setInterval(warmVoice, VOICE_KEEPALIVE_MS)
  // Libera o microfone para a gravação de voz.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  nativeTheme.on('updated', () => win?.setTitleBarOverlay(overlay()))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
