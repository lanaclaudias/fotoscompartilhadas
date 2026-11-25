# Fotos Compartilhadas 💍

Site para os convidados enviarem as fotos e vídeos do casamento, com um painel para os noivos.

- **Convidados** (`/`): digitam o nome uma vez e enviam várias fotos e vídeos. Não precisam de login.
- **Painel** (`/painel`): é protegido por senha. Mostra a galeria, permite filtrar por convidado, baixar tudo em `.zip` (uma pasta por convidado) e apagar fotos. Também mostra o **QR Code**, que pode ser impresso ou baixado.

**Como funciona:** as fotos vão do celular **direto para o Supabase Storage** (bucket privado). A tabela `fotos` guarda quem enviou cada uma. O site roda na **Vercel**.

---

## 1. Supabase (uma vez)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Abra **SQL Editor → New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **service_role** (secreta).

## 2. Rodar no computador

```bash
cp .env.example .env     # e preencha as chaves e a senha
npm install
npm start
```

Abra `http://localhost:3000` e `http://localhost:3000/painel`.

## 3. Colocar na Vercel

**Pelo terminal** (sem precisar de GitHub):
```bash
npx vercel          # primeira vez: faz login e cria o projeto
npx vercel --prod   # publica a versão final
```

**Ou pelo GitHub:** suba o projeto para um repositório e importe em [vercel.com/new](https://vercel.com/new).

Depois, em **Settings → Environment Variables** do projeto na Vercel, cadastre:

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | chave service_role |
| `ADMIN_PASSWORD` | senha do painel |
| `PUBLIC_URL` | *(opcional)* domínio próprio, ex. `https://fotos.anaejoao.com.br` |

Depois de cadastrar as variáveis, faça um novo deploy. O QR Code do painel usa automaticamente o endereço do site.

## Personalizar para cada cliente — `config.json`

| Campo | O que é |
|---|---|
| `noivos`, `data`, `mensagem` | Textos da página dos convidados |
| `urlPublica` | Igual a `PUBLIC_URL` (opcional) |
| `tamanhoMaximoMB` | Limite por arquivo. O plano grátis do Supabase aceita até **50 MB** |
| `comprimirFotos` | Reduz fotos grandes no celular antes de enviar |

## Limites do plano grátis do Supabase
- **1 GB de armazenamento** no total. Com fotos comprimidas (cerca de 1 MB cada), cabem umas 800 a 1.000 fotos. Para um casamento grande, considere o plano Pro (100 GB).
- **50 MB por arquivo**, o que corta vídeos longos.
- Projetos grátis são **pausados após 7 dias sem uso**. Reative no painel do Supabase antes do evento.

## Bingo (`/bingo` e `/bingo/admin`)

- **Convidados** (`/bingo`): escolhem quantas cartelas querem, podem trocar os números antes de confirmar e acompanham o sorteio ao vivo (a página se atualiza sozinha a cada 3 s). Quando alguém bate, aparece o aviso de **BINGO!** para todos.
- **Quem sorteia** (`/bingo/admin`, mesma senha do painel): toca no número que saiu (ou digita). Escolhe se vale **cartela cheia** ou **uma linha** e começa novas rodadas. Os ganhadores aparecem na hora.
- As vendas ficam abertas só enquanto nenhum número da rodada foi sorteado. As cartelas valem para todas as rodadas.
- **Antes de usar:** rode [`supabase/bingo.sql`](supabase/bingo.sql) no SQL Editor do Supabase.
- `config.json` → `bingo`: `preco` (por cartela), `maxPorCompra`, `maxPorConvidado` e `pagamento` (`"teste"` = confirma sem cobrar; o InfinitePay ainda será ligado).

## Convites digitais (`/convite?c=CÓDIGO` e `/entrada?c=CÓDIGO`)

- No **painel → aba Convites**, a noiva escreve o nome do convidado (ou dos convidados, ex.: "Patrícia e Carol"), escolhe quantas pessoas entram e clica em **Gerar convite**. Cada convite tem um link próprio, com botões para enviar pelo WhatsApp ou copiar o link.
- O convidado abre o link: o passaporte se abre e mostra o convite e o cartão de embarque com o nome dele. No lugar do código de barras fica o **QR Code de entrada**.
- Na porta, a equipe lê o QR Code com a câmera do celular. Abre a página `/entrada`, que mostra **Entrada liberada** (ou **Já entrou** se o convite já foi usado). Precisa estar logado com a senha do painel; basta fazer isso uma vez em cada celular.
- No painel aparece quem já chegou. Também dá para marcar ou desfazer uma entrada manualmente.
- **Antes de usar:** rode [`supabase/convites.sql`](supabase/convites.sql) no SQL Editor do Supabase.
- Os textos do convite (locais, voo, frases) ficam em `config.json` → `convite`.
