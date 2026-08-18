-- ============================================================================
--  四週精力維持計畫 · 執行台 — Supabase 同步層
--  在 Supabase 後台 → SQL Editor → New query → 全部貼上 → Run
--  只需要執行一次。可重複執行，不會覆蓋既有資料。
-- ============================================================================

-- 1) 資料表：一個「同步空間」一列，整份文件存成 jsonb
create table if not exists public.ep_state (
  space_key  text primary key,
  doc        jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) 開啟 RLS 且「不建立任何 policy」
--    → anon 金鑰無法直接讀寫這張表（就算金鑰外流也拿不到資料）
alter table public.ep_state enable row level security;

-- 3) 唯一的出入口：兩個 SECURITY DEFINER 函式，必須提供正確的 space_key
--    space_key 是 32 位十六進位隨機字串，猜不到。

create or replace function public.ep_pull(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb;
begin
  if p_key is null or length(p_key) < 24 then
    raise exception 'invalid key';
  end if;
  select doc into r from public.ep_state where space_key = p_key;
  return coalesce(r, '{}'::jsonb);
end;
$$;

create or replace function public.ep_push(p_key text, p_doc jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare t timestamptz;
begin
  if p_key is null or length(p_key) < 24 then
    raise exception 'invalid key';
  end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    raise exception 'invalid doc';
  end if;
  if pg_column_size(p_doc) > 1048576 then
    raise exception 'doc too large';
  end if;

  insert into public.ep_state (space_key, doc, updated_at)
  values (p_key, p_doc, now())
  on conflict (space_key)
  do update set doc = excluded.doc, updated_at = now()
  returning updated_at into t;

  return t;
end;
$$;

-- 4) 權限：撤銷預設的公開執行權，只放行這兩個函式
revoke all on function public.ep_pull(text)        from public;
revoke all on function public.ep_push(text, jsonb) from public;
grant execute on function public.ep_pull(text)        to anon, authenticated;
grant execute on function public.ep_push(text, jsonb) to anon, authenticated;

-- 完成。回到網站「設定 · 同步」頁貼上同步碼即可。
