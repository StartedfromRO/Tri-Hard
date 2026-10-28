// Netlify Function: lets ONLY the signed-in Supabase user start / watch the Garmin sync workflow.
// Needs Netlify env var GITHUB_TOKEN (fine-grained token: this repo, "Actions: Read and write").
const SUPABASE_URL = "https://euwbsqptvfxbpebgnmak.supabase.co";
const SUPABASE_KEY = "sb_publishable_1GZreKWeSL7MHLooyDMXpA_Ism2J3Mz";
const REPO = "StartedfromRO/Tri-Hard";
const WORKFLOW = "sync.yml";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  // 1. Only your logged-in account may call this
  const auth = req.headers.get("authorization") || "";
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, authorization: auth },
  });
  if (!who.ok) return json(401, { error: "not signed in" });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json(500, { error: "GITHUB_TOKEN not set in Netlify" });
  const gh = (path, init = {}) =>
    fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "tri-hard-thlete",
      },
    });

  // 2. POST = start a sync, GET = report the latest run's status
  if (req.method === "POST") {
    const startedAt = Date.now();
    const r = await gh("dispatches", {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
    if (!r.ok) return json(502, { error: "GitHub refused", detail: await r.text() });
    return json(200, { startedAt });
  }

  const r = await gh("runs?per_page=1");
  if (!r.ok) return json(502, { error: "GitHub refused", detail: await r.text() });
  const run = (await r.json()).workflow_runs?.[0];
  if (!run) return json(200, { status: "none" });
  return json(200, {
    status: run.status,
    conclusion: run.conclusion,
    createdAt: Date.parse(run.created_at),
  });
};
