# Canvix da Viagem de Sonho

Fork de [mir-ashiq/canvix](https://github.com/mir-ashiq/canvix). O ramo
**`vds`** é o que corre em produção (canva.viagemdesonho.pt): a versão
original (tag `v0.23.1`) mais as nossas alterações, um commit por
funcionalidade. O `main` fica igual ao original e não se usa.

## As nossas alterações

Cada uma é um commit `vds: ...` em cima da tag original:

```bash
git log --oneline v0.23.1..vds
```

- **MCP: pastas.** Os designs criados pelo MCP ficam na conta
  `CANVIX_MCP_OWNER`; ferramentas `list_folders`, `create_folder`,
  `move_design_to_folder`.
- **Brand kit: fontes carregadas.** O seletor de fontes mostra também as
  fontes que o utilizador carregou (não só as do catálogo).
- **MCP: `export_design_url`.** Links temporários assinados (HMAC, 15 min por
  omissão, 60 máx.) para o PNG/JPG de páginas de um design, com as fotos
  embutidas; rota `/api/vds/export`. Para o TryPost ir buscar a imagem.
- **MCP: pasta de escrita (`CANVIX_MCP_WRITE_FOLDER`).** Com o nome ou id
  de uma pasta (ex.: `ChatGPT`): o MCP só edita, comenta e redimensiona
  designs dessa pasta; criar, gerar, duplicar e redimensionar para cópia
  põem o design novo lá; criar pastas e mover designs são recusados. Ler,
  exportar e duplicar a partir de qualquer design continua livre. Pasta
  inexistente = escritas recusadas. Vazio = sem restrição.
- **MCP: regras da app.** As "Regras do Canvix" editadas na app interna
  (Marketing > Agente) chegam ao agente nas `instructions` do `initialize` e
  na ferramenta `get_usage_rules`. Lidas de `VDS_PROMPT_URL` com
  `VDS_PROMPT_TOKEN` (cache de 5 minutos; se a api falhar, fica a última
  versão boa). Sem estas variáveis, nada muda.
- **MCP: `duplicate_design`.** Cópia independente de um design (ex.: um
  modelo), opcionalmente já dentro de uma pasta, sem tocar no original.
- **MCP: Brand.** `list_brand_assets` (cores, paletas, fontes e logos dos
  brand kits da conta `CANVIX_MCP_OWNER`, com miniaturas opcionais) e
  `add_brand_asset` (põe um logo num design com o ficheiro original, sem
  recomprimir e sem cantos arredondados). As fontes carregadas são aceites
  por `list_fonts`, `add_text`, `update_element` e `generate_design`.
- **MCP: respostas pequenas no `export_design`.** O `png` é uma
  pré-visualização JPEG de 800 px e o `json`/`svg` trocam as imagens
  embutidas por `omitted:<tipo>;<tamanho>`. Antes chegavam a 2,5 MB e
  5,9 MB e o ChatGPT terminava a conversa ("duração máxima").
- **MCP: `arrange_element`.** Ordem das camadas (frente, trás, subir,
  descer, acima/abaixo de outro elemento, índice exato).
- **MCP: Uploads.** `list_uploads` (imagens da biblioteca de Uploads, com
  miniaturas opcionais) e `add_upload` (insere com o original,
  `/api/media/<id>`; `as_background` cobre a página, vai para trás e
  bloqueia). O `export_design` em PNG passa a embutir estas imagens.
- **MCP: páginas.** `add_page`, `duplicate_page` (ids novos), `delete_page`,
  `move_page`, para carrosséis.
- **MCP: `resize_design`.** Magic resize do editor; por omissão cria uma
  cópia no tamanho novo, na mesma pasta. Presets de redes sociais.
- **MCP: arrumação.** `group_elements`, `ungroup_element`, `align_elements`
  (à página ou ao conjunto) e `distribute_elements`.
- **Uploads sem fontes.** A biblioteca de Uploads deixa de listar as fontes
  carregadas (apagá-las lá tirava-as do seletor de fontes).
- **Uploads repetidos voltam à biblioteca.** Carregar de novo um ficheiro
  igual a um removido da biblioteca repõe-no (antes ficava escondido).
- **Fontes carregadas ao abrir o editor** e textos remedidos quando uma
  fonte chega (antes o texto aparecia deslocado ao recarregar).
- **Menus da barra de cima visíveis.** Os popovers (Position, Adjust, …)
  vão para o body com position fixed, encostados à direita do ecrã, logo
  abaixo do header; antes ficavam cortados pela barra.
  Em Position → Advanced, W/H com "Ratio" mantêm a proporção.
- **Imagens sem cantos arredondados por omissão** e controlo "Corner
  radius" no menu Adjust das imagens.
- **Editor: "Recortar à página".** Botão na barra de zoom (ligado por
  omissão, preferência em `localStorage` `vds:clipToPage`). Tapa com a cor de
  fundo do editor o que sai fora da página; só visual, não apanha cliques e
  não entra nos exports.
- **Home: ordem das secções.** Projetos e Brand kit antes dos Templates
  (página e menu lateral).
- **`deploy/`.** Esta pasta: Dockerfile, compose, fontconfig, modelos do
  nginx e o script dos IPs do ChatGPT.

Regras para mexer:

- Ficheiros novos nossos em pastas `vds/` (`src/lib/vds/`,
  `src/components/vds/`, `src/app/api/vds/`): nunca dão conflito.
- Nos ficheiros originais, mudanças mínimas e marcadas com `[VDS]`.
- Código em inglês, comentários em português.
- Um commit por funcionalidade, com prefixo `vds:`.

## Servidor

- Repositório em `/opt/canvix/src` (ramo `vds`). Construir e arrancar:

  ```bash
  cd /opt/canvix/src/deploy && docker compose up -d --build
  ```

- Fora de git, só no servidor:
  - `deploy/.env`: segredos (ver `.env.example`), chmod 600.
  - `deploy/fonts/`: ficheiros das fontes (ver `fonts/LEIA-ME.md`).
  - `/etc/nginx/snippets/canvix-mcp-chatgpt.conf`: endereço secreto do MCP
    para o ChatGPT (modelo em `nginx/canvix-mcp-chatgpt.conf.example`).
- nginx: `nginx/canva.viagemdesonho.pt.conf` →
  `/etc/nginx/sites-available/`, `nginx/conf.d-canvix-mcp.conf` →
  `/etc/nginx/conf.d/canvix-mcp.conf`. `snippets/cloudflare-realip.conf` vem
  das listas da Cloudflare.
- `bin/update-openai-ips.sh`: atualiza os IPs dos conectores do ChatGPT
  (crontab de root `17 4 * * 1`).
- Base de dados: volume Docker `canvix_pgdata`. O `name: canvix` no compose
  fixa esse nome; não mudar.

## Atualizar para uma versão nova do original

```bash
git fetch upstream --tags
git checkout vds
git rebase --onto v0.24.0 v0.23.1 vds   # trocar pelas tags certas
```

- O git volta a aplicar os commits `vds:` em cima da versão nova.
- Conflitos só podem aparecer nos ficheiros originais marcados com
  `[VDS]`: `src/lib/mcp/tools.ts`, `src/components/editor/panels/BrandPanel.tsx`,
  `src/components/editor/canvas/CanvasStage.tsx`,
  `src/components/editor/ZoomControls.tsx`,
  `src/components/dashboard/Dashboard.tsx`.
- Antes, ver no CHANGELOG deles se já fizeram algo igual a alguma das
  nossas alterações. Se sim, tirar o nosso commit no rebase.
- Depois: `npm ci && npm run build && npx vitest run src/lib/mcp` (ou só o
  build no servidor), `git push --force-with-lease origin vds`, e no
  servidor `git fetch && git reset --hard origin/vds` e o `docker compose`
  acima. Ler as notas da versão: se trouxer migrações da base de dados,
  fazer backup do volume e correr `docker compose exec app npm run db:setup`
  (o arranque não as corre sozinho).
- Atualizar neste ficheiro a tag de base (`v0.23.1`).
