// Grade the sample essays in fixtures/vstep several times and print how stable the scores are.
//
//   BASE=https://<your-site>.azurestaticapps.net RUNS=3 node scripts/grade-fixtures.mjs
//
// 3 essays × RUNS gradings count against the daily grading limit. Signed out, the limit is
// RATE_WRITING_GRADE_PER_DAY_ANON per IP; to use your account's limit instead, copy the
// StaticWebAppsAuthCookie value from the browser into AUTH_COOKIE (attempts saved to your history
// are deleted again at the end). Never commit or share that cookie.
import { readFileSync } from 'node:fs';

const BASE = (process.env.BASE ?? 'http://localhost:4280').replace(/\/$/, '');
const RUNS = Number(process.env.RUNS ?? 3);
const headers = { 'Content-Type': 'application/json' };
if (process.env.AUTH_COOKIE) headers.Cookie = `StaticWebAppsAuthCookie=${process.env.AUTH_COOKIE}`;
const CRITERIA = ['taskFulfilment', 'organization', 'vocabulary', 'grammar'];

const rows = [];
for (const name of ['weak', 'medium', 'good']) {
  const f = JSON.parse(readFileSync(new URL(`../fixtures/vstep/essay-${name}.json`, import.meta.url), 'utf8'));
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const started = Date.now();
    const res = await fetch(`${BASE}/api/writing/grade`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task: f.prompt.task, level: f.level, prompt: f.prompt, essay: f.essay, durationSec: 0 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`${name} run ${i + 1}: HTTP ${res.status} ${data.error ?? ''}`);
      process.exitCode = 1;
      continue;
    }
    const r = data.result;
    runs.push({ task: r.taskScore, ...Object.fromEntries(CRITERIA.map((c) => [c, r.criteria[c].score])), errors: r.errors.length, sec: Math.round((Date.now() - started) / 1000) });
    if (data.saved?.id) await fetch(`${BASE}/api/writings/${data.saved.id}`, { method: 'DELETE', headers });
  }
  if (runs.length === 0) continue;
  const spread = (k) => Math.max(...runs.map((r) => r[k])) - Math.min(...runs.map((r) => r[k]));
  rows.push({
    essay: name,
    words: f.essay.split(/\s+/).filter(Boolean).length,
    taskScores: runs.map((r) => r.task).join(' / '),
    taskSpread: spread('task'),
    maxCriterionSpread: Math.max(...CRITERIA.map(spread)),
    errors: runs.map((r) => r.errors).join(' / '),
    seconds: runs.map((r) => r.sec).join(' / '),
  });
}
console.table(rows);
