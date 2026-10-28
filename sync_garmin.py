#!/usr/bin/env python3
"""Pull data from Garmin Connect (unofficial, uses your own login) and push it to the
Supabase garmin-webhook in Garmin's push format.

Usage:
  export GARMIN_EMAIL=you@example.com GARMIN_PASSWORD='...'
  python sync_garmin.py          # last 7 days
  python sync_garmin.py 120      # backfill 120 days
"""
import os, sys, json, datetime as dt, urllib.request
from garminconnect import Garmin

WEBHOOK = "https://euwbsqptvfxbpebgnmak.functions.supabase.co/garmin-webhook"
TOKENS = os.path.expanduser("~/.garminconnect")  # cached login so you rarely re-auth
days = int(sys.argv[1]) if len(sys.argv) > 1 else 7

email = os.environ.get("GARMIN_EMAIL", "")
have_tokens = os.path.isdir(TOKENS) and os.listdir(TOKENS)
if not have_tokens and ("@" not in email or "your" in email.lower() or "<" in email):
    sys.exit("First run: set GARMIN_EMAIL and GARMIN_PASSWORD to your REAL Garmin login (no < > brackets).")
api = Garmin(email, os.environ.get("GARMIN_PASSWORD"),
             prompt_mfa=lambda: input("Garmin 2FA code: "))
api.login(TOKENS)   # reuses cached tokens if present, else logs in and saves them there

today = dt.date.today()
start = today - dt.timedelta(days=days)

def post(payload):
    req = urllib.request.Request(WEBHOOK, json.dumps(payload).encode(),
                                 {"Content-Type": "application/json",
                                  "x-webhook-secret": os.environ.get("WEBHOOK_SECRET", "")})
    try:
        return urllib.request.urlopen(req, timeout=60).read().decode()
    except urllib.error.HTTPError as e:
        sys.exit(f"Webhook error {e.code}: {e.read().decode()}")

def ri(v):  # DB integer columns reject decimals like 1834.7
    return None if v is None else int(round(v))

# ---- activities ----
acts = []
for a in api.get_activities_by_date(start.isoformat(), today.isoformat()):
    t = dt.datetime.strptime(a["startTimeGMT"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.timezone.utc)
    acts.append({
        "summaryId": str(a["activityId"]),
        "activityType": (a.get("activityType") or {}).get("typeKey", ""),
        "startTimeInSeconds": int(t.timestamp()),
        "durationInSeconds": ri(a.get("duration")),
        "distanceInMeters": a.get("distance"),
        "averageHeartRateInBeatsPerMinute": ri(a.get("averageHR")),
        "maxHeartRateInBeatsPerMinute": ri(a.get("maxHR")),
        "activeKilocalories": ri(a.get("calories")),
        "totalElevationGainInMeters": a.get("elevationGain"),
        "averageSpeedInMetersPerSecond": a.get("averageSpeed"),
        "averagePowerInWatts": ri(a.get("avgPower")),
    })
print("activities:", post({"activities": acts}) if acts else "none")

# ---- daily health ----
def safe(fn, d):
    try: return fn(d) or {}
    except Exception as e:
        print("  skip", fn.__name__, d, e); return {}

hrv, sleeps, dailies, bb = [], [], [], []
for i in range(days + 1):
    d = (start + dt.timedelta(days=i)).isoformat()
    h = safe(api.get_hrv_data, d).get("hrvSummary") or {}
    if h.get("lastNightAvg"):
        hrv.append({"calendarDate": d, "lastNightAvg": h["lastNightAvg"],
                    "lastNightFiveMinHigh": h.get("lastNight5MinHigh")})
    s = safe(api.get_sleep_data, d).get("dailySleepDTO") or {}
    if s.get("sleepTimeSeconds"):
        sleeps.append({"calendarDate": d, "durationInSeconds": ri(s["sleepTimeSeconds"]),
                       "deepSleepDurationInSeconds": ri(s.get("deepSleepSeconds")),
                       "lightSleepDurationInSeconds": ri(s.get("lightSleepSeconds")),
                       "remSleepInSeconds": ri(s.get("remSleepSeconds")),
                       "overallSleepScore": {"value": ((s.get("sleepScores") or {}).get("overall") or {}).get("value")}})
    st = safe(api.get_stats, d)
    if st.get("restingHeartRate") or st.get("totalSteps"):
        dailies.append({"calendarDate": d, "restingHeartRateInBeatsPerMinute": ri(st.get("restingHeartRate")),
                        "averageStressLevel": ri(st.get("averageStressLevel")), "steps": ri(st.get("totalSteps"))})
    hi, lo = st.get("bodyBatteryHighestValue"), st.get("bodyBatteryLowestValue")
    if hi is not None and lo is not None:
        bb.append({"calendarDate": d, "timeOffsetBodyBatteryValues": {"0": ri(hi), "1": ri(lo)}})

print("health:", post({"hrv": hrv, "sleeps": sleeps, "dailies": dailies, "bodyBatteries": bb}))
