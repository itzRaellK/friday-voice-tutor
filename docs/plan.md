# Plano — Professor de Idiomas (chat estilo MSN + voz)

## O que já foi verificado na máquina

- Ollama `0.40.13`, Node `24.11`, npm `11.6`.
- `lfm3-omni` (1.7B, Q4_K_M, 128k ctx) instalado. Capacidades: completion, vision, **audio**, **speech**, tools.
- Vozes disponíveis: `male-`/`female-` para american-english, british-english, portuguese, spanish, french, german, italian, japanese, korean, chinese, arabic, hebrew, dutch, danish, finnish, greek, polish, swedish, turkish (+ `default`).
- Endpoints que funcionam:
  - `POST /api/chat` → texto (stream). O campo `voice` aqui é **ignorado** (retorna só texto).
  - `POST /v1/audio/speech` `{model, input, voice}` → `audio/wav` (PCM 16-bit, mono, 24 kHz, chunked).
  - `POST /v1/audio/transcriptions` (multipart `model`, `file`) → `{"text": ...}`. Qualidade razoável, não perfeita ("Olá, tudo bem?" → "Olhei, tudo bem.").

Conclusão: o fluxo é **texto via `/api/chat` → áudio via `/v1/audio/speech`**, e voz do usuário via `/v1/audio/transcriptions`.

## Stack

- Electron + TypeScript, scaffold com `electron-vite` (main / preload / renderer).
- Renderer em React (lista de mensagens e estados de "digitando"/"falando" ficam simples).
- Sem backend extra: o **main process** fala com o Ollama (`http://127.0.0.1:11434`) e expõe via IPC no preload. Evita CORS e deixa a URL/modelo configuráveis num lugar só.

## Fluxo de uma mensagem

1. Usuário digita (ou grava voz → transcrição → texto aparece no campo/na conversa).
2. Main chama `/api/chat` com `stream: true` + system prompt do professor + histórico.
3. Tokens chegam no renderer e vão aparecendo no balão ("Professor está digitando...").
4. A cada frase completa (`.`, `!`, `?`, quebra de linha), main envia a frase para `/v1/audio/speech` com a voz do idioma atual; o renderer enfileira e toca os WAVs em ordem. Assim a voz começa antes do texto terminar.
5. Botão de mudo e de "repetir áudio" em cada mensagem.

## Idioma e adaptação

- System prompt: professor paciente, responde no idioma que o aluno está praticando, corrige erros de forma curta (ex.: bloco "💡 Correção:" ao final), adapta nível.
- O modelo começa cada resposta com uma tag `[lang:xx]` (pt, en, es, fr, de, it, ja, ko, zh, ...). O app remove a tag do texto e usa para escolher a voz (`female-portuguese`, etc.). Fallback: idioma selecionado na UI.
- Seletor de idioma + gênero da voz no topo (como o "status" do MSN). Pedir "vamos falar em francês" também troca via tag.
- Termos de correção ficam fora do TTS (não ler o bloco de correção em voz alta, ou ler na voz do idioma nativo — decidir no teste).

## Entrada por voz

- Botão de microfone (segurar para falar ou clicar liga/desliga).
- `MediaRecorder` grava; o renderer converte para WAV mono 16 kHz com `AudioContext` (o endpoint aceitou WAV no teste; webm não testado).
- Envia ao main → `/v1/audio/transcriptions` → texto vira mensagem do usuário (mostrado na tela, com ícone de microfone).

## Interface estilo MSN

- Janela de conversa com barra de título azul/verde gradiente, "Professor diz:" / "Você diz:", fonte Segoe UI/Tahoma.
- Painel lateral com o avatar do professor em moldura MSN + status ("Online — falando Francês").
- "Professor está digitando..." na base, som de mensagem recebida, botão **Chamar atenção** (nudge: chacoalha a janela e o professor responde algo).
- Emoticons simples no texto.

## Avatar

- Androide **original** no estilo do jogo (rosto sintético limpo, LED circular na têmpora que muda de cor — azul ocioso, amarelo pensando, verde falando), uniforme claro com faixa azul. Não reproduzir personagens do jogo (Connor, Kara etc.), só a estética.
- Opções: gerar uma imagem com IA (ex.: Higgsfield, conectado nesta sessão) ou desenhar em SVG para animar o LED nativamente. Recomendo imagem gerada + LED sobreposto em CSS.

## Estrutura

```
src/
  main/        index.ts, ollama.ts (chat stream, speech, transcribe), ipc.ts
  preload/     index.ts (window.api)
  renderer/
    App.tsx
    components/ ChatWindow, MessageList, Composer, MicButton, AvatarPanel, LanguagePicker
    audio/      player.ts (fila de WAV), recorder.ts (gravação → WAV 16k)
    lib/        prompt.ts, langTag.ts, sentenceSplitter.ts
    assets/     avatar.png, sons
```

## Etapas

1. Scaffold electron-vite + React + TS; janela MSN estática.
2. Chat em texto com streaming via IPC.
3. TTS por frase com fila de reprodução + LED do avatar.
4. Tag de idioma → troca de voz; seletor de idioma/gênero.
5. Microfone + transcrição.
6. Polimento: nudge, sons, histórico salvo localmente, configurações (URL do Ollama, modelo).

## Riscos / a testar

- Modelo de 1.7B pode esquecer a tag `[lang:xx]` → fallback para idioma da UI; avaliar detecção simples por heurística se necessário.
- Latência do TTS por frase (teste: ~90 KB de WAV para frase curta, rápido localmente).
- Transcrição imprecisa em alguns idiomas → mostrar o texto transcrito para o usuário editar antes de enviar (opcional).

---

## Atualização (29/10/2026): Friday

A interface do MSN foi substituída pela Friday (ver [README](../README.md)):

- Esfera de partículas com fios elásticos (`src/renderer/src/orb/OrbRenderer.ts`) ligada aos estados reais
  e ao volume do microfone e da voz; legenda grande abaixo; histórico retrátil; vidro acrylic; temas claro e escuro.
- Modelos separados: gemma4:e2b ouve e conversa, lfm3-omni só fala (variantes `friday-brain`/`friday-voice` com contexto pequeno).
- Correção da frase do aluno é uma chamada separada, em português; juntas na mesma resposta, o modelo deixava de corrigir.
- O app decide o idioma (seletor ou pedido detectado na mensagem), com um lembrete no fim de cada pedido.

Decisões e entregas (29/10/2026, tarde):
- Histórico só na sessão aberta, sem salvar entre sessões (decisão do usuário).
- Sem modos para escolher: o microfone abre com o app em espera; "Friday"/"Sexta"/"Sexta-feira" (ou tocar na esfera) abre uma conversa em tempo real, que fecha com uma despedida, outro toque ou 1 minuto de silêncio.
- Interrupção falando por cima durante a conversa.
- Voz tocada em stream conforme é gerada.
- O fluxo foi testado de ponta a ponta com um microfone simulado (frases geradas pela própria voz e ruído de fundo); falta validar com microfone e caixas de som reais, principalmente o eco no modo contínuo.
- Dois idiomas: "Meu idioma" (explicações das correções e contexto da Friday) e "Praticar" (conversa). Interface segue em português (decisão do usuário).
- Revisto (29/10, noite): "Meu idioma" é a língua em que a Friday fala com o aluno (modo professora); falar na língua de estudo vira prática. Modo decidido pelo detector `eld`, sem regras por idioma. `npm run eval` mede prompts e modelos. qwen3.5:4b testado: melhor nas marcações, mas sem áudio e sem espaço na VRAM de 6 GB ao lado do gemma.
- Revisto de novo (29/10, noite): alternar vozes no meio da fala não ficava natural. Agora a Friday fala sempre na língua de estudo (voz e destaque na tela) e a tradução na língua do aluno aparece embaixo, só no texto. Removidos o modo professora, as marcações <t> e a troca de voz por trecho. qwen3.5:4b removido.
