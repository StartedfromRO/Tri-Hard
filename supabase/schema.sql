-- Run in Supabase SQL editor.
create table if not exists activities (
  summary_id text primary key,
  garmin_user_id text,
  sport text not null,               -- swim | bike | run | other
  raw_type text,
  start_time timestamptz not null,
  duration_s integer,
  distance_m real,
  avg_hr integer,
  max_hr integer,
  calories integer,
  elevation_m real,
  avg_speed_mps real,
  avg_power_w integer,
  raw jsonb
);
create index if not exists activities_start_idx on activities (start_time desc);

alter table activities enable row level security;
-- Personal app: anon key may READ only. Writes happen via the edge function (service role).
-- Tighten this (e.g. require auth) if your site is public.
create policy "read activities" on activities for select using (true);

-- Health API: one row per day, filled in piecemeal by different push types.
create table if not exists daily_health (
  calendar_date date primary key,
  hrv_night_avg real,
  hrv_5min_high real,
  resting_hr integer,
  avg_stress integer,
  steps integer,
  sleep_s integer,
  deep_s integer,
  light_s integer,
  rem_s integer,
  sleep_score integer,
  body_battery_high integer,
  body_battery_low integer
);
alter table daily_health enable row level security;
create policy "read health" on daily_health for select using (true);
