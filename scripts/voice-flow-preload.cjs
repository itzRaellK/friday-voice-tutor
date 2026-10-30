const data = { chats: [], speech: [], chatAborts: [], speechAborts: [], sources: [], labels: [], textReveals: [], completeCalls: 0 }
const tokens = new Set()
const chunks = new Set()
window.__voiceFlow = data
data.token = (id, text) => { for (const cb of tokens) cb(id, text) }
data.chunk = (id, bytes) => { for (const cb of chunks) cb(id, bytes) }
const NativeAudioContext = window.AudioContext
window.AudioContext = class extends NativeAudioContext {
  createBufferSource() {
    const source = super.createBufferSource()
    const start = source.start.bind(source)
    const stop = source.stop.bind(source)
    let record
    source.start = (at, ...args) => {
      record = { at, duration: source.buffer.duration, stopped: false }
      data.sources.push(record)
      return start(at, ...args)
    }
    source.stop = (...args) => {
      if (record) record.stopped = true
      return stop(...args)
    }
    return source
  }
}
// Ponte sintética do teste de integração: nunca abre o microfone real nem chama o Ollama.
Object.defineProperty(navigator, 'mediaDevices', { value: {
  getUserMedia: () => Promise.reject(new Error('Microfone desativado no teste automatizado'))
} })
window.api = {
  startChat: (id) => new Promise((resolve) => data.chats.push({ id, resolve })),
  abortChat: async (id) => { data.chatAborts.push(id) },
  complete: async () => { data.completeCalls++; return '' },
  onToken: (cb) => { tokens.add(cb); return () => tokens.delete(cb) },
  streamSpeech: (id, text) => new Promise((resolve, reject) => data.speech.push({ id, text, resolve, reject })),
  abortSpeech: async (id) => { data.speechAborts.push(id) },
  onSpeechChunk: (cb) => { chunks.add(cb); return () => chunks.delete(cb) },
  transcribe: async () => '',
  models: async () => ({ chat: 'synthetic', stt: 'synthetic', tts: 'synthetic' }),
  getTheme: async () => 'system',
  setTheme: async () => {}
}
window.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(() => {
    const label = document.querySelector('.state')?.textContent.trim()
    if (label && data.labels.at(-1) !== label) data.labels.push(label)
    const text = document.querySelector('.friday-line')?.textContent.trim()
    if (text && data.textReveals.at(-1)?.text !== text) data.textReveals.push({ text, sourceCount: data.sources.length })
  }).observe(document.body, { childList: true, characterData: true, subtree: true })
})
