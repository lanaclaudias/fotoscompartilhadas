-- Rode este script UMA vez no Supabase: SQL Editor → New query → colar → Run

-- Tabela com quem enviou cada foto
create table if not exists public.fotos (
  id            uuid primary key default gen_random_uuid(),
  caminho       text not null unique,          -- caminho do arquivo no Storage
  nome_original text,
  tipo          text not null,                 -- image/jpeg, video/mp4...
  tamanho       bigint,
  nome          text not null,                 -- nome digitado pelo convidado
  convidado_id  text not null,                 -- código salvo no celular do convidado
  enviada_em    timestamptz not null default now(),
  tirada_em     timestamptz
);

create index if not exists fotos_convidado_idx on public.fotos (convidado_id);
create index if not exists fotos_enviada_idx on public.fotos (enviada_em desc);

-- RLS ligado e SEM políticas: ninguém acessa pela chave pública.
-- Só o servidor do site (com a service_role) lê e grava.
alter table public.fotos enable row level security;

-- Projetos novos do Supabase não liberam tabelas automaticamente: dá acesso só ao servidor (chave secreta)
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.fotos to service_role;

-- Bucket PRIVADO para as fotos (limite de 50 MB por arquivo, o máximo do plano grátis)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 52428800, array['image/*', 'video/*'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
