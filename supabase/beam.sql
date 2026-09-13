-- Direct device-to-device transfer: the registry of your devices, the sessions
-- they agree on, and the signalling they use to find each other.
--
-- Re-runnable: every policy and trigger is dropped before it is created.

-- ---------------------------------------------------------------- devices --
create table if not exists public.devices (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null,
  name       text not null,
  platform   text,
  seen_at    timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.devices enable row level security;
drop policy if exists "own devices" on public.devices;
create policy "own devices" on public.devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------- transfer sessions --
-- One row per offered transfer. Both devices watch it: the receiver to see the
-- offer, the sender to see it accepted, and both to follow progress. acked
-- counts whole chunks the receiver has safely stored, which is where a resumed
-- transfer picks up.
create table if not exists public.transfer_sessions (
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  id            text not null,
  from_device   text not null,
  to_device     text not null,
  from_name     text,
  file_name     text not null,
  file_size     bigint not null,
  file_type     text,
  chunk_size    bigint not null,
  chunks        int not null,
  state         text not null default 'offered',
  mode          text,
  sender_ready  boolean not null default false,
  receiver_ready boolean not null default false,
  sent          int not null default 0,
  acked         int not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.transfer_sessions enable row level security;
drop policy if exists "own sessions" on public.transfer_sessions;
create policy "own sessions" on public.transfer_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists transfer_sessions_to_device
  on public.transfer_sessions (user_id, to_device, state);

-- --------------------------------------------------------------- signals --
-- WebRTC offers, answers and ICE candidates, in transit only. Each side reads
-- what the other wrote and deletes the session's signals when it is done.
create table if not exists public.transfer_signals (
  id          bigserial primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  session_id  text not null,
  from_device text not null,
  kind        text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.transfer_signals enable row level security;
drop policy if exists "own signals" on public.transfer_signals;
create policy "own signals" on public.transfer_signals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists transfer_signals_session
  on public.transfer_signals (user_id, session_id, id);

-- ----------------------------------------------------------- housekeeping --
-- Nothing here is worth keeping: a stale session is one nobody completed, and a
-- stale signal is one nobody read.
create or replace function public.sweep_transfers() returns void
language sql security definer set search_path = public as $$
  delete from public.transfer_signals where created_at < now() - interval '1 hour';
  delete from public.transfer_sessions where updated_at < now() - interval '1 day';
  delete from public.devices where seen_at < now() - interval '90 days';
$$;
