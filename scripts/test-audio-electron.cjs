const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..')
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const timeout = setTimeout(() => { console.error('Timeout no teste do Electron'); app.exit(1) }, 25000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, 'voice-flow-preload.cjs'),
      contextIsolation: false, sandbox: false, backgroundThrottling: false
    }
  })
  await win.loadFile(join(root, 'out/renderer/index.html'))
  const result = await win.webContents.executeJavaScript(`(async () => {
    const d = window.__voiceFlow;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    async function waitFor(predicate, message) {
      for (let i = 0; i < 500; i++) { if (predicate()) return; await sleep(10); }
      throw new Error('Timeout: ' + message);
    }
    function wav(seconds) {
      const rate = 24000;
      const bytes = new Uint8Array(44 + Math.round(seconds * rate) * 2);
      const view = new DataView(bytes.buffer);
      const tag = (at, text) => [...text].forEach((c, i) => { bytes[at+i] = c.charCodeAt(0); });
      tag(0, 'RIFF'); view.setUint32(4, bytes.length-8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate*2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data');
      view.setUint32(40, bytes.length-44, true); return bytes;
    }
    const label = () => document.querySelector('.state').textContent.trim();
    const caption = () => document.querySelector('.friday-line').textContent.trim();
    const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    function thinking(hiddenText) {
      check(label() === 'pensando', 'O estado deve permanecer pensando durante toda a preparação');
      check(document.querySelector('.thinking-flag')?.textContent.trim() === 'Pensando…', 'Indicador de espera ausente');
      check(caption() === '', 'O texto foi exibido antes do áudio ficar pronto');
      check(!document.querySelector('.history').textContent.includes(hiddenText), 'Resposta vazou no histórico antes da voz');
    }
    async function ask(count) {
      const input = document.querySelector('#message');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Quero praticar inglês');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(30);
      document.querySelector('form').requestSubmit();
      await waitFor(() => d.chats.length === count, 'nova pergunta ' + count);
      return d.chats[count-1];
    }

    await waitFor(() => d.chats.length === 1, 'saudação');
    const chat = d.chats[0];
    const full = 'Hello! We can practice together.';
    d.token(chat.id, 'Hello! ');
    d.token(chat.id, 'We can practice');
    await sleep(80);
    check(d.speech.length === 0, 'A síntese começou antes de terminar o texto');
    thinking('Hello!');
    chat.resolve(full);
    await waitFor(() => d.speech.length === 1, 'síntese da resposta completa');
    check(d.speech[0].text === full, 'A síntese não recebeu a resposta inteira');
    thinking(full);
    const first = d.speech[0];
    const bytes = wav(1.1);
    for (let i = 0; i < 11; i++) {
      d.chunk(first.id, i === 0 ? bytes.slice(0, 44+4800) : bytes.slice(44+i*4800, 44+(i+1)*4800));
      await sleep(70);
      thinking(full);
      check(d.sources.length === 0, 'Áudio começou antes de receber a resposta inteira');
      check(d.completeCalls === 0, 'Uma tarefa auxiliar disputou a preparação da voz');
    }
    d.chunk(first.id, null);
    await sleep(40);
    thinking(full);
    check(d.sources.length === 0, 'O fim dos bytes foi tratado como sucesso antes da confirmação do IPC');
    first.resolve();
    await waitFor(() => caption() === full && label() === 'falando', 'texto e voz apresentados juntos');
    check(!document.querySelector('.thinking-flag'), 'Indicador de espera permaneceu durante a fala');
    check(d.sources.length === 1, 'A resposta deve tocar em um único buffer');
    check(Math.abs(d.sources[0].duration-1.1) < 0.00001, 'Áudio da resposta foi truncado');
    check(d.textReveals[0]?.text === full && d.textReveals[0]?.sourceCount === 1, 'Texto foi revelado sem áudio agendado');
    check(d.chatAborts.length === 0 && d.speechAborts.length === 0, 'A resposta foi abortada automaticamente');
    await waitFor(() => label() !== 'falando', 'fim da reprodução');
    const firstFlowLabels = [...d.labels];
    check(!firstFlowLabels.includes('preparando voz'), 'A preparação deve usar um único estado pensando');
    check(firstFlowLabels.filter((l) => l === 'falando').length === 1, 'Estado falando oscilou durante a resposta');

    const cancelledText = await ask(2);
    d.token(cancelledText.id, 'This must remain hidden. ');
    await sleep(30);
    thinking('This must remain hidden.');
    escape();
    await sleep(30);
    check(d.chatAborts.includes(cancelledText.id), 'Esc não cancelou a geração de texto');
    cancelledText.resolve('This must remain hidden.');
    await sleep(80);
    check(d.speech.length === 1, 'Texto cancelado iniciou uma síntese');
    check(!document.querySelector('.thinking-flag'), 'Espera ficou presa após cancelar o texto');

    const cancelledAudio = await ask(3);
    cancelledAudio.resolve('This audio is cancelled.');
    await waitFor(() => d.speech.length === 2, 'áudio a cancelar');
    const second = d.speech[1];
    d.chunk(second.id, wav(0.8)); d.chunk(second.id, null);
    await sleep(30);
    thinking('This audio is cancelled.');
    escape();
    await sleep(30);
    check(d.speechAborts.includes(second.id), 'Esc não cancelou a preparação da voz');
    second.resolve();
    d.chunk(second.id, wav(0.8)); d.chunk(second.id, null);
    await sleep(80);
    check(d.sources.length === 1, 'Áudio cancelado começou a tocar após a confirmação atrasada');
    check(!document.querySelector('.history').textContent.includes('This audio is cancelled.'), 'Resposta cancelada foi revelada');

    const failedChat = await ask(4);
    failedChat.resolve('This synthesis will fail.');
    await waitFor(() => d.speech.length === 3, 'síntese que falha');
    const failed = d.speech[2];
    d.chunk(failed.id, wav(0.8)); d.chunk(failed.id, null);
    failed.reject(new Error('Falha sintética da voz'));
    await waitFor(() => document.querySelector('.friday-line.error'), 'erro visível de síntese');
    check(d.sources.length === 1, 'Áudio parcial tocou apesar de falha na síntese');
    check(!document.querySelector('.thinking-flag'), 'Indicador ficou preso após erro');
    check(!document.querySelector('.history').textContent.includes('This synthesis will fail.'), 'Texto de uma resposta sem voz vazou');

    const recoveredChat = await ask(5);
    recoveredChat.resolve('Ready to try again.');
    await waitFor(() => d.speech.length === 4, 'nova síntese após erro');
    const recovered = d.speech[3];
    d.chunk(recovered.id, wav(0.8)); d.chunk(recovered.id, null); recovered.resolve();
    await waitFor(() => caption() === 'Ready to try again.' && label() === 'falando', 'recuperação após erro');
    escape();
    await sleep(30);
    check(d.sources[1].stopped, 'Esc não parou a reprodução');
    d.token(recoveredChat.id, 'Late tokens must not restart speech. ');
    await sleep(80);
    check(d.speech.length === 4, 'Tokens atrasados reativaram a voz');
    return { passed: true, firstFlowLabels, wholeResponseInOneBuffer: true,
      textHiddenDuringGeneration: true, textHiddenDuringAudioPreparation: true,
      textAndAudioPresentedTogether: true, thinkingFlagUntilReady: true,
      cancelledTextStayedHidden: true, cancelledAudioStayedHidden: true,
      synthesisFailureDidNotPlayPartialAudio: true, recoveredAfterFailure: true,
      nativeSources: d.sources, escapeStoppedPlayback: true, lateTokensRestartedSpeech: false,
      microphoneUsed: false, ollamaCalled: false };
  })()`)
  require('node:fs').mkdirSync(join(root, 'out/tests'), { recursive: true })
  writeFileSync(join(root, 'out/tests/voice-flow-result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  clearTimeout(timeout)
  app.exit(0)
}).catch((err) => { console.error(err); clearTimeout(timeout); app.exit(1) })
