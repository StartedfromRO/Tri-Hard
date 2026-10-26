// Supabase Edge Function: receives Garmin Connect Developer API *push* payloads
// (Activity API) and upserts them into the `activities` table.
// Deploy: supabase functions deploy garmin-webhook --no-verify-jwt
// Then register  https://<project>.functions.supabase.co/garmin-webhook  as your
// Activity summary endpoint in the Garmin developer portal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function sport(t = ""): string {
  t = t.toUpperCase();
  if (t.includes("SWIM")) return "swim";
  if (t.includes("CYCL") || t.includes("BIK") || t.includes("RIDE")) return "bike";
  if (t.includes("RUN")) return "run";
  return "other";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const body = await req.json().catch(() => ({}));
  const list = [...(body.activities ?? []), ...(body.activityDetails?.map((d: any) => ({ ...d.summary, summaryId: d.summaryId })) ?? [])];

  const rows = list.filter((a: any) => a?.summaryId).map((a: any) => ({
    summary_id: String(a.summaryId),
    garmin_user_id: a.userId ?? null,
    sport: sport(a.activityType),
    raw_type: a.activityType ?? null,
    start_time: new Date(a.startTimeInSeconds * 1000).toISOString(),
    duration_s: a.durationInSeconds ?? null,
    distance_m: a.distanceInMeters ?? null,
    avg_hr: a.averageHeartRateInBeatsPerMinute ?? null,
    max_hr: a.maxHeartRateInBeatsPerMinute ?? null,
    calories: a.activeKilocalories ?? null,
    elevation_m: a.totalElevationGainInMeters ?? null,
    avg_speed_mps: a.averageSpeedInMetersPerSecond ?? null,
    avg_power_w: a.averagePowerInWatts ?? null,
    raw: a,
  }));

  if (rows.length) {
    const { error } = await db.from("activities").upsert(rows, { onConflict: "summary_id" });
    if (error) return new Response(error.message, { status: 500 });
  }

  // ---- Health API pushes -> daily_health (one partial row per day/type) ----
  const days: Record<string, Record<string, unknown>> = {};
  const add = (date: string | undefined, cols: Record<string, unknown>) => {
    if (!date) return;
    const clean = Object.fromEntries(Object.entries(cols).filter(([, v]) => v != null));
    days[date] = { ...(days[date] ?? {}), ...clean };
  };
  for (const h of body.hrv ?? []) {
    add(h.calendarDate, { hrv_night_avg: h.lastNightAvg, hrv_5min_high: h.lastNightFiveMinHigh });
  }
  for (const s of body.sleeps ?? []) {
    add(s.calendarDate, {
      sleep_s: s.durationInSeconds, deep_s: s.deepSleepDurationInSeconds,
      light_s: s.lightSleepDurationInSeconds, rem_s: s.remSleepInSeconds ?? s.remSleepDurationInSeconds,
      sleep_score: s.overallSleepScore?.value ?? s.sleepScores?.overall?.value,
    });
  }
  for (const d of body.dailies ?? []) {
    add(d.calendarDate, {
      resting_hr: d.restingHeartRateInBeatsPerMinute, avg_stress: d.averageStressLevel, steps: d.steps,
    });
  }
  for (const b of [...(body.stressDetails ?? []), ...(body.bodyBatteries ?? [])]) {
    const vals = Object.values(b.timeOffsetBodyBatteryValues ?? b.timeOffsetBodyBatteryDetails ?? {}) as number[];
    if (vals.length) add(b.calendarDate, { body_battery_high: Math.max(...vals), body_battery_low: Math.min(...vals) });
  }
  let healthStored = 0;
  for (const [calendar_date, cols] of Object.entries(days)) {
    // per-row upsert so a partial row never nulls columns filled by another push type
    const { error } = await db.from("daily_health").upsert({ calendar_date, ...cols }, { onConflict: "calendar_date" });
    if (error) return new Response(error.message, { status: 500 });
    healthStored++;
  }
  return new Response(JSON.stringify({ stored: rows.length, healthStored }), { status: 200 });
});
