-- Local migration only. Do not apply this to a remote database without approval.
-- The full engine state, including both racks and the bag, stays in arena.secrets.
-- public.matches gains the end and last-action fields the player view already returns.

alter table public.matches
  add column end_state jsonb,
  add column last_action jsonb;

alter table arena.secrets
  add column engine jsonb;
