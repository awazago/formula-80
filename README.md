# Fórmula 80 · Setlist

PWA para organizar as cifras (PDF) e os setlists da banda Fórmula 80, feito para usar no tablet durante o show.

## O que já funciona

### MVP 2: banda compartilhada
- **Login com código da banda** + nome de cada integrante. O código pode ser trocado no menu 👤.
- **Sincronização:** músicas, PDFs e shows ficam na nuvem (Cloudflare D1 + KV) e aparecem em todos os aparelhos. Todos editam.
- **Offline-first:** o app grava sempre no aparelho e sincroniza quando há internet (ao abrir, ao editar, a cada 20 s e ao voltar a conexão). Os PDFs são baixados para tocar sem rede.
- Indicador no topo: ✓ Sincronizado / pendentes / offline. Toque nele para sincronizar na hora.
- Conflito: a última edição vence. Os shows mostram quem editou por último.
- Quem já tinha músicas no aparelho (MVP 1) tem tudo enviado automaticamente no primeiro login.

### MVP 1

- **Biblioteca:** upload de vários PDFs de uma vez (botão ou arrastar e soltar). Arquivos no formato `Artista - Música.pdf` já preenchem os dois campos.
- **Metadados:** tom, BPM, duração, timbre/patch do teclado e observações.
- **Shows:** blocos com drag and drop (biblioteca → bloco, entre blocos e reordenação), duração total por bloco, duplicar show.
- **Modo palco:** PDF em tela cheia, swipe lateral troca de música na ordem do show, controles que somem sozinhos (toque no centro para mostrar), modo noturno (cores invertidas) e tela sempre ligada.
- **Pedal Bluetooth:** setas, PageUp/PageDown ou espaço. No modo "rola página", o pedal desce a música e só troca para a próxima quando chega ao fim dela.
- **Offline:** o app e os PDFs ficam salvos no aparelho (IndexedDB + Service Worker).
- **Backup:** exportar e importar um JSON com músicas, shows e PDFs (menu ⋯ em Músicas).

## Rodar localmente

```bash
npm install
npx wrangler d1 execute formula-80-db --local --file worker/schema.sql
npx wrangler d1 execute formula-80-db --local --command="$(node scripts/band-code.mjs teste123)"

npm run build && npx wrangler dev   # app + API em http://localhost:8787
# ou, com recarga automática do front: `npx wrangler dev` em um terminal e `npm run dev` em outro
```

### Trocar o código da banda pelo terminal (se ninguém lembrar o atual)

```bash
npx wrangler d1 execute formula-80-db --remote --command="$(node scripts/band-code.mjs NOVO-CODIGO)"
```

Para testar no tablet é preciso HTTPS: Service Worker, Wake Lock e instalação só funcionam em https ou localhost. O caminho mais simples é publicar na Cloudflare (abaixo).

## Publicar (Cloudflare Workers)

O `wrangler.jsonc` já está configurado: arquivos estáticos de `dist/` com fallback de SPA, API em `worker/index.ts` (`/api/*`), banco D1 `formula-80-db` e KV `formula-80-pdfs` para os PDFs.

1. Cloudflare → **Workers & Pages** → **Create application** → **Import a repository** → GitHub → `awazago/formula-80`.
2. Nome do projeto: **`formula-80`** (precisa ser igual ao `name` do `wrangler.jsonc`).
3. Build command: `npm run build` · Deploy command: `npx wrangler deploy`.
4. **Save and Deploy**. Cada push na `main` publica sozinho.
5. Domínio próprio: no app → **Settings → Domains & Routes → Add → Custom domain** → `app.formula80.com.br`.

## Instalar no tablet

- **iPad (Safari):** Compartilhar → Adicionar à Tela de Início.
- **Android (Chrome):** menu ⋮ → Instalar app.

Abrir sempre pelo ícone instalado: assim o app roda em tela cheia e o sistema não apaga os PDFs salvos.

## Stack

React 19 + TypeScript + Vite · Tailwind 4 · pdf.js (build legacy, compatível com tablets mais antigos) · dnd-kit · Embla Carousel · Dexie (IndexedDB) · vite-plugin-pwa · Cloudflare Workers + D1 + KV

## Roadmap

- **Fase 3:** conversão PDF → ChordPro com IA, tela de revisão e transposição de tom.
- **Fase 4:** importação do Google Drive, anotações pessoais com caneta.
