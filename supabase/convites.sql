-- Convites digitais. Rode este script no Supabase: SQL Editor → New query → colar → Run
-- Pode rodar de novo sem problema (só cria o que estiver faltando).

create table if not exists public.convites (
  id         uuid primary key default gen_random_uuid(),
  numero     bigint generated always as identity,   -- "Convite nº 12"
  codigo     text not null unique,                  -- vai no link do convite
  nomes      text not null,                         -- ex.: "Patrícia e Carol"
  pessoas    int not null default 1 check (pessoas between 1 and 20),
  criado_em  timestamptz not null default now(),
  entrada_em timestamptz                            -- quando o QR Code foi lido na entrada
);

-- Senha do convite (o convidado digita em "Confirmar presença") e chave do QR Code de entrada
alter table public.convites add column if not exists senha          text;
alter table public.convites add column if not exists chave          text unique;  -- só existe depois da confirmação
alter table public.convites add column if not exists confirmado_em  timestamptz;
alter table public.convites add column if not exists senha_falhas   int not null default 0;
alter table public.convites add column if not exists senha_bloqueio timestamptz;

alter table public.convites enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.convites to service_role;
grant usage, select on all sequences in schema public to service_role;
