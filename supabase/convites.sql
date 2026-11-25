-- Convites digitais. Rode este script UMA vez no Supabase: SQL Editor → New query → colar → Run

create table if not exists public.convites (
  id         uuid primary key default gen_random_uuid(),
  numero     bigint generated always as identity,   -- "Convite nº 12"
  codigo     text not null unique,                  -- vai no link e no QR Code do convite
  nomes      text not null,                         -- ex.: "Patrícia e Carol"
  pessoas    int not null default 1 check (pessoas between 1 and 20),
  criado_em  timestamptz not null default now(),
  entrada_em timestamptz                            -- quando o QR Code foi lido na entrada
);

alter table public.convites enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.convites to service_role;
grant usage, select on all sequences in schema public to service_role;
