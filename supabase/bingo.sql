-- Bingo do casamento. Rode este script UMA vez no Supabase: SQL Editor → New query → colar → Run

-- Cada rodada do bingo (quando um ou mais convidados batem, a equipe começa uma nova)
create table if not exists public.bingo_rodadas (
  id            bigint generated always as identity primary key,
  modo          text not null default 'cheia' check (modo in ('cheia', 'linha')),
  sorteados     int[] not null default '{}',     -- números na ordem em que saíram (cópia para leitura rápida)
  ganhadores    jsonb not null default '[]',
  iniciada_em   timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

-- Números sorteados (uma linha por número: evita conflito se duas pessoas marcarem ao mesmo tempo)
create table if not exists public.bingo_sorteados (
  rodada_id   bigint not null references public.bingo_rodadas (id) on delete cascade,
  numero      int not null check (numero between 1 and 75),
  sorteado_em timestamptz not null default now(),
  primary key (rodada_id, numero)
);

-- Cartelas compradas pelos convidados
create table if not exists public.bingo_cartelas (
  id           uuid primary key default gen_random_uuid(),
  numero       bigint generated always as identity,   -- "Cartela nº 7"
  convidado_id text not null,
  nome         text not null,
  numeros      int[] not null,                         -- 25 números, linha por linha; o centro (posição 13) é 0 = livre
  pagamento    text not null default 'teste',          -- 'teste' enquanto o InfinitePay não estiver ligado
  criada_em    timestamptz not null default now()
);

create index if not exists bingo_cartelas_convidado_idx on public.bingo_cartelas (convidado_id);

-- Igual à tabela de fotos: RLS ligado e sem políticas, só o servidor do site acessa
alter table public.bingo_rodadas   enable row level security;
alter table public.bingo_sorteados enable row level security;
alter table public.bingo_cartelas  enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.bingo_rodadas, public.bingo_sorteados, public.bingo_cartelas to service_role;
grant usage, select on all sequences in schema public to service_role;
