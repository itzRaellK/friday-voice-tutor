# Diagnóstico da voz — 29/10/2026

Medição feita antes da correção, por volta de 21h24–21h26 (America/Sao_Paulo), com texto sintético em inglês,
sem o Electron aberto. O sintoma informado foi voz picotada ou com pausas no meio da frase.

## Conclusão

A voz já ficou mais lenta que o tempo real quando testada isoladamente. O player anterior começava com
apenas 0,3 s de áudio guardado; esse buffer não sustenta a velocidade de geração observada.
Chamadas simultâneas e pouca VRAM livre agravam o problema.

`100% GPU` em `ollama ps` significa que o modelo foi carregado inteiramente na GPU,
e não que ela está com 100% de utilização. Fonte: [FAQ do Ollama](https://docs.ollama.com/faq#how-can-i-tell-if-my-model-was-loaded-onto-the-gpu).

## Máquina e memória

- CPU: AMD Ryzen 5 3600, 6 núcleos / 12 threads.
- RAM: 31,94 GiB, aproximadamente 9,58 GiB livres no início do teste.
- GPU: AMD Radeon RX 7600, 8.176 MiB de VRAM, backend ROCm identificado nos logs.
- Ollama: 0.40.13; uma requisição por modelo (`OLLAMA_NUM_PARALLEL=1`).
- Modelos residentes: `friday-brain`, contexto 8.192, e `friday-voice`, contexto 4.096.

Nos 15 registros dos contadores de GPU do Windows, a memória dedicada ficou entre
7.558 e 8.003 MiB e a compartilhada em aproximadamente 1.643 MiB. O motor de computação
do processo de inferência ficou entre 72% e 90% nas primeiras 14 amostras; na última,
o maior motor ativo caiu a 22%. Não foi medida temperatura ou limitação térmica.

Uma leitura posterior do consumo por processo indicou:

| Processo | Memória dedicada (MiB) | Memória compartilhada (MiB) |
|---|---:|---:|
| llama-server, PID 2472 | 3.115 | 135 |
| llama-server, PID 10364 | 2.174 | 1.182 |
| dwm (compositor do Windows) | 1.303 | 32 |
| Opera | 1.174 | 187 |
| Epic Games Launcher | 473 | 6 |
| Spotify | 193 | 3 |
| Discord | 130 | 29 |
| VS Code | 129 | 24 |

Contadores por processo podem contabilizar recursos compartilhados; não devem ser somados como
medida exata da ocupação física. Para ocupação total, foi usado o contador do adaptador.
O uso de memória compartilhada e a pouca VRAM livre sugerem pressão de memória, mas este teste
não isolou quanto da lentidão vem de transferências de memória, computação ou concorrência com outros apps.

## Testes de geração

Mesma frase nos três testes de voz abaixo, com `female-american-english`. Os dois primeiros
foram feitos após aquecimento, sem outra chamada de inferência disparada pelo diagnóstico.

| Cenário | Tempo da requisição | Duração do áudio | Tempo / áudio |
|---|---:|---:|---:|
| Voz isolada 1 | 10,355 s | 8,000 s | 1,294 |
| Voz isolada 2 | 9,622 s | 7,360 s | 1,307 |
| Voz com chat e revisão | 10,519 s | 7,680 s | 1,370 |

Os primeiros pedaços de áudio chegaram em aproximadamente 0,22–0,25 s. Portanto, nesse teste,
o problema principal foi sustentar a reprodução, e não obter o primeiro pedaço.

A simulação do player atual estimou 2,007 s e 1,916 s de pausas acumuladas nos testes isolados,
e 2,429 s com chat e revisão. Isso é uma simulação usando os tempos de chegada dos pedaços,
não uma gravação nem uma medição do áudio efetivamente reproduzido no Electron.

O chat isolado produziu 30 tokens em 0,462 s de requisição (92,9 tokens/s de geração).
Junto com voz e revisão, levou 1,378 s (24,3 tokens/s). A revisão levou 3,277 s.
Os tempos de carregamento reportados pelo chat foram de 4–8 ms, sem recarga relevante nesse teste.
Fonte dos campos de tempo: [métricas da API do Ollama](https://docs.ollama.com/api/usage).

Ao enviar três frases de voz simultaneamente, o primeiro áudio chegou após 0,252 s, 5,666 s
e 10,340 s, respectivamente. Isso evidencia a fila do modelo de voz. Esses tempos não são
pausas necessariamente ouvidas entre as frases: parte da espera pode coincidir com a reprodução
da frase anterior. A concorrência por modelo é explicada na [FAQ do Ollama](https://docs.ollama.com/faq#how-does-ollama-handle-concurrent-requests).

Os logs anteriores à medição registraram transcrições em 0,15–0,39 s, além de requisições de voz
de até 9,56 s durante o uso recente. Não foi feito um benchmark controlado do microfone ou STT.

## Pontos da versão anterior que explicam o comportamento

- `src/renderer/src/audio/player.ts`: `PREBUFFER_S = 0.3`; após esvaziar o áudio agendado,
  a reprodução recomeça com o próximo lote, sem acumular novamente uma reserva maior.
- `SpeechPlayer.enqueue`: inicia uma requisição para cada frase imediatamente; ordena a
  reprodução, mas não limita quantas requisições de síntese ficam aguardando no servidor.
- `src/renderer/src/App.tsx`: revisão acontece junto com a resposta; tradução pode acontecer
  enquanto a voz ainda está sendo gerada. As tentativas adicionais de correção e tradução
  podem estender essa disputa.
- `src/main/index.ts`: aquecimento periódico de voz pode coincidir com uma fala real.

O contexto global do servidor aparece como 262.144 tokens nos logs e houve aviso antigo de
contexto maior que o suportado. Os modelos usados no teste já estavam com 8k e 4k; portanto,
não há evidência de que o contexto global tenha causado as pausas medidas. Seria relevante
se o app passasse a usar os modelos base após falha na criação das variantes.

## Recomendações, em ordem

1. Repetir o diagnóstico após fechar voluntariamente o Opera e launchers que não estejam em uso.
   Comparar os tempos de voz isolada para quantificar o efeito da memória e da disputa da GPU.
2. Ajustar o player para acumular uma reserva adaptada à geração e fazer novo buffer após
   esvaziamento. Isso troca um pouco de espera inicial por fala contínua. Com geração abaixo
   do tempo real, um buffer fixo pequeno não garante ausência de cortes para qualquer frase.
3. Controlar a fila de síntese e priorizar voz sobre tarefas auxiliares. Serializar as requisições,
   sozinho, não acelera o modelo: o Ollama já atende uma por vez nesta configuração.
4. Evitar aquecimento durante falas e cancelar tarefas antigas quando houver interrupção.

Não foi necessário recomendar outra GPU ou trocar os modelos para identificar o gargalo.
Nenhum processo de outro aplicativo foi encerrado e nenhuma configuração do Ollama foi alterada.

## Reproduzir

```sh
npm run diagnose
```

Deixe o Ollama aberto e evite conversar no app durante a medição. O comando usa somente frases
sintéticas e salva `out/diagnostics/voice-latest.json`. A coleta dos contadores de GPU do Windows
foi feita separadamente; não faz parte desse comando. As amostras desta sessão estão em
`out/diagnostics/gpu-latest.json`.

## Investigação dos estados e primeira correção

O caminho encontrado foi: acaba um buffer curto de áudio → não há próximo buffer pronto → o player
emite `waiting` → a interface troca de `falando` para `pensando`. Alterar o rótulo ou o estado da
esfera não chama `stop()` no áudio. O estado visual acompanha a falta de áudio, em vez de causá-la.

Um teste de regressão executado antes da correção reproduziu, em uma única frase:

```text
waiting → playing → waiting → playing → waiting → playing → idle
```

Não houve nenhum abort nesse teste. Após a correção, a mesma entrada passa por:

```text
waiting → playing → idle
```

Na primeira correção, o player passou a acumular o áudio completo de cada frase e agendar um único
buffer por frase. A fila enviava uma síntese por vez e preparava a próxima enquanto o áudio pronto
tocava. Isso eliminou os buracos no meio da frase, mas ainda permitia espera entre frases e texto
adiantado em relação à voz. Naquele fluxo, `waiting` aparecia como `preparando voz`.

Também foi corrigido o Esc: ele parava apenas os áudios existentes e deixava o chat gerando;
tokens posteriores podiam enfileirar novas falas. Esc agora cancela o chat e os áudios, e callbacks
de uma resposta interrompida não retomam a fala. Repetir uma mensagem do histórico também cancela
a resposta anterior. O processo principal aceita cancelamentos mesmo durante a preparação dos modelos.

Oito testes com relógio simulado cobrem geração lenta, ordem, fila, marcadores de fim em canais
diferentes, falhas de IPC e interrupções. Um teste adicional no Electron real usa a interface de
produção e Web Audio nativo com respostas sintéticas e sem abrir o microfone. Ele confirmou:

- Fluxo visual: `pensando → preparando voz → falando`, sem voltar a `pensando` durante a reprodução.
- Duas frases prontas agendadas com intervalo de 0 s entre seus buffers, sem sobreposição.
- Nenhum abort automático e nenhuma chamada a `stop()` nas duas frases.
- Esc para a fonte, cancela o chat e tokens atrasados não retomam a voz.

Os registros `[Friday áudio]` distinguem esvaziamento/espera de um `stop` explícito e registram
se a interrupção veio do microfone, Esc, esfera, repetição ou nova resposta. O teste sintético não
avalia eco, falsos positivos do microfone, falhas do dispositivo de saída ou travamentos do driver;
esses ainda precisam ser distinguidos pelos registros durante uso real, se persistirem.

## Fluxo atual: texto e áudio apresentados juntos

Após o ajuste de experiência solicitado, a resposta segue esta ordem:

1. Gerar o texto completo, mantendo-o fora da interface e do histórico visível.
2. Preparar o áudio da resposta inteira em uma única requisição de síntese.
3. Confirmar tanto o fim dos bytes quanto o sucesso da requisição.
4. Agendar um único buffer, apresentar o texto e trocar de `pensando` para `falando`.

A esfera permanece em `pensando` e as legendas mostram um indicador **Pensando…** durante as duas
etapas de preparação. Tradução e revisão começam após o áudio estar preparado. A espera total
de geração continua existindo, mas fica antes da apresentação: o texto não aparece antes da voz,
e a reprodução não precisa aguardar a geração da frase seguinte.

O Esc cancela a preparação do texto ou da voz sem revelar a resposta descartada. Falhas de síntese,
inclusive após receber bytes, não reproduzem áudio parcial nem deixam o indicador de espera preso.

Validação atual: 11 testes do player, typecheck, build e teste da interface real no Electron com
respostas sintéticas. A integração verifica texto oculto nas duas etapas, ausência de vazamento no
histórico, fluxo `pensando → falando`, cancelamento durante texto e voz, erro de síntese e recuperação.
O resultado fica em `out/tests/voice-flow-result.json`.
