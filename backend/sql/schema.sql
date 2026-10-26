-- TANTARA RAG: database schema reference
-- Supabase project: existing documents and document_chunks tables
-- Vector dimension: 1024
--
-- IMPORTANT:
-- This file documents the intended schema.
-- Review against the existing Supabase schema before executing.
-- Do not run this file blindly on an existing database.

create extension if not exists vector with schema extensions;

create table if not exists public.documents (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    source text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.document_chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.documents(id) on delete cascade,
    chunk_index integer not null,
    content text not null,
    embedding extensions.vector(1024),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists document_chunks_embedding_hnsw_idx
on public.document_chunks
using hnsw (embedding vector_cosine_ops);

create or replace function public.match_document_chunks(
    query_embedding extensions.vector(1024),
    match_count integer default 5
)
returns table (
    id uuid,
    document_id uuid,
    content text,
    metadata jsonb,
    similarity double precision
)
language sql
stable
as $$
    select
        dc.id,
        dc.document_id,
        dc.content,
        dc.metadata,
        1 - (dc.embedding <=> query_embedding) as similarity
    from public.document_chunks dc
    where dc.embedding is not null
    order by dc.embedding <=> query_embedding
    limit greatest(match_count, 1);
$$;

-- Security policies and grants must be reviewed against the
-- existing Supabase configuration before deployment.
