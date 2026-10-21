# Fórmula 80 · Setlist

PWA para organizar as cifras (PDF) e os setlists da banda Fórmula 80, feito para usar no tablet durante o show.

## O que já funciona (MVP 1)

- **Biblioteca:** upload de vários PDFs de uma vez (botão ou arrastar e soltar). Arquivos no formato `Artista - Música.pdf` já preenchem os dois campos.
- **Metadados:** tom, BPM, duração, timbre/patch do teclado e observações.
- **Shows:** blocos com drag and drop (biblioteca → bloco, entre blocos e reordenação), duração total por bloco, duplicar show.
- **Modo palco:** PDF em tela cheia, swipe lateral troca de música na ordem do show, controles que somem sozinhos (toque no centro para mostrar), modo noturno (cores invertidas) e tela sempre ligada.
- **Pedal Bluetooth:** setas, PageUp/PageDown ou espaço. No modo "rola página", o pedal desce a música e só troca para a próxima quando chega ao fim dela.
- **Offline:** o app e os PDFs ficam salvos no aparelho (IndexedDB + Service Worker).
- **Backup:** exportar e importar um JSON com músicas, shows e PDFs (menu ⋯ em Músicas).

> Os dados ficam **no aparelho** até o MVP 2 (Supabase), que traz login e sincronização com a banda.

## Rodar localmente

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # gera dist/
npm run preview    # serve o build com o PWA ativo
```

Para testar no tablet é preciso HTTPS: Service Worker, Wake Lock e instalação só funcionam em https ou localhost. O caminho mais simples é publicar no Cloudflare Pages (abaixo).

## Publicar (Cloudflare Pages)

1. Suba o repositório no GitHub.
2. Cloudflare → Workers & Pages → Create → Pages → conectar o repositório.
3. Build command: `npm run build` · Output directory: `dist`.
4. Custom domains → `app.formula80.com.br` (depois de registrar o domínio no Registro.br e apontar o DNS para a Cloudflare).

## Instalar no tablet

- **iPad (Safari):** Compartilhar → Adicionar à Tela de Início.
- **Android (Chrome):** menu ⋮ → Instalar app.

Abrir sempre pelo ícone instalado: assim o app roda em tela cheia e o sistema não apaga os PDFs salvos.

## Stack

React 19 + TypeScript + Vite · Tailwind 4 · pdf.js (build legacy, compatível com tablets mais antigos) · dnd-kit · Embla Carousel · Dexie (IndexedDB) · vite-plugin-pwa

## Roadmap

- **MVP 2:** Supabase (login Google, banda compartilhada, todos editam, sincronização em tempo real).
- **Fase 3:** conversão PDF → ChordPro com IA, tela de revisão e transposição de tom.
- **Fase 4:** importação do Google Drive, anotações pessoais com caneta.
