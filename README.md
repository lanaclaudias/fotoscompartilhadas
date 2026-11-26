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
- A compra de cartelas começa **fechada**. A noiva libera no painel (aba Bingo → **Liberar compra de cartelas**) e pode fechar de novo quando quiser. Mesmo liberada, a venda fecha quando sai o primeiro número da rodada. As cartelas valem para todas as rodadas.
- **Antes de usar:** rode [`supabase/bingo.sql`](supabase/bingo.sql) no SQL Editor do Supabase. Se já tinha rodado antes, rode de novo: ele só cria o que falta.
- `config.json` → `bingo`: `preco` (por cartela), `maxPorCompra`, `maxPorConvidado` e `pagamento` (`"teste"` = confirma sem cobrar; o InfinitePay ainda será ligado).

## Convites digitais (`/convite?c=CÓDIGO` e `/entrada?k=CHAVE`)

- No **painel → aba Convites**, a noiva escreve o nome do convidado (ou dos convidados, ex.: "Patrícia e Carol"), escolhe quantas pessoas entram e clica em **Gerar convite**. Cada convite ganha um link próprio e uma **senha de 4 números**. A mensagem do WhatsApp já leva o link e a senha.
- O convidado abre o link e vê o passaporte com o convite e o cartão de embarque com o nome dele. Em **Confirmar presença** ele digita a senha. Só então aparece o **QR Code de entrada**, que também pode ser baixado no bilhete em PDF. Depois de 5 senhas erradas, o convite fica bloqueado por 10 minutos.
- Na porta, a equipe lê o QR Code com a câmera do celular. Abre a página `/entrada`, que mostra **Entrada liberada** (ou **Já entrou** se o convite já foi usado). Precisa estar logado com a senha do painel; basta fazer isso uma vez em cada celular.
- Depois da entrada, o cartão de embarque some do convite e ficam só as páginas do passaporte. Se o convite estiver aberto no celular do convidado, o cartão some sozinho em poucos segundos.
- Na **aba Convites** do painel, o botão **Ler QR Code dos convites** abre a câmera do celular e libera a entrada na hora (mostra **Entrada liberada**, **Já entrou** ou **QR Code inválido**, com som). Precisa estar no endereço https do site.
- Na página 2 do passaporte, o botão **Tirar fotos** só é liberado depois que o convidado entra na festa, e o **Comprar cartela** só depois que a noiva libera a compra no painel (aba Bingo → **Liberar compra de cartelas**). Os botões mudam sozinhos no convite aberto.
- No painel aparecem a senha, quem confirmou presença e quem já chegou. Também dá para marcar ou desfazer uma entrada manualmente.
- **Antes de usar:** rode [`supabase/convites.sql`](supabase/convites.sql) no SQL Editor do Supabase. Se você já tinha rodado antes, rode de novo: ele só acrescenta as colunas novas.
- Os textos do convite ficam no próprio [`public/convite.html`](public/convite.html).
