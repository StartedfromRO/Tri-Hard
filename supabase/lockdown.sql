-- Run once in the Supabase SQL editor: only a signed-in user can read your data.
drop policy if exists "read activities" on activities;
drop policy if exists "read health" on daily_health;
create policy "auth read activities" on activities for select to authenticated using (true);
create policy "auth read health" on daily_health for select to authenticated using (true);
