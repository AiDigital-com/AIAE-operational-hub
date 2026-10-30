#!/usr/bin/env node
// scripts/parity-check.mjs — the live check before rolling out the dashboard pass-through
// (DASHBOARD-DATA-PASSTHROUGH-PLAN §12, step 4).
//
// Takes a RAW dashboard body (what dash-gate serves on GET /api/dashboards/:slug/data, or what the
// new Hub streams through) on stdin, runs it through wire.ts for the given caller context, and
// compares the result with the OLD Hub's answer for the same slug (`--expected`), the way the
// browser would see both: parsed JSON against parsed JSON. Prints the path of the first difference,
// or "parity: ok".
//
//   A=$(cd AIAE-paicing/dash-gate && npm run --silent assert -- --email=<me> --scope=all)
//   curl -sS -H "X-Hub-Assertion: $A" http://<pacing>:3000/api/dashboards/<slug>/data > raw.json
//   curl -sS -H "Authorization: Bearer $T" https://<old-hub>/api/v1/pacing/dashboards/<slug> > old-hub-body.json
//   node scripts/parity-check.mjs --expected old-hub-body.json --own <my pacing user id> [--unrestricted] < raw.json
//
// `--own` and `--unrestricted` must describe the SAME person the old Hub answered (its `canEdit`
// came from hub_users.pacing_user_id and the resolved scope); `/api/v1/auth/me` on the new Hub
// prints both as pacingUserId / pacingUnrestricted.
//
// Imports wire.ts directly, so it needs a Node that strips types (22.18+ / 23.6+, where it is on
// by default). The type-only import inside wire.ts is erased with the rest.
import { readFileSync } from "node:fs";
import { readDashboardWire } from "../src/features/pacing-dashboard/wire.ts";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const expectedPath = opt("--expected");
if (!expectedPath) {
  console.error("usage: node scripts/parity-check.mjs --expected <old-hub-body.json> [--own <pacing user id>] [--unrestricted] < raw.json");
  process.exit(2);
}
const ctx = { ownPacingUserId: opt("--own"), unrestricted: args.includes("--unrestricted") };

const raw = JSON.parse(readFileSync(0, "utf8"));
const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
const actual = JSON.parse(JSON.stringify(readDashboardWire(raw, ctx)));

/** The first path where two parsed JSON values differ, or null. */
function firstDifference(a, b, path = "$") {
  if (a === b) return null;
  if (a === null || b === null || typeof a !== typeof b) return { path, actual: a, expected: b };
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return { path, actual: a, expected: b };
    if (a.length !== b.length) return { path: `${path}.length`, actual: a.length, expected: b.length };
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (typeof a === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) return { path: `${path}.${k}`, actual: "<missing>", expected: b[k] };
      if (!(k in b)) return { path: `${path}.${k}`, actual: a[k], expected: "<missing>" };
      const d = firstDifference(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return { path, actual: a, expected: b };
}

const diff = firstDifference(actual, expected);
if (!diff) {
  console.log(`parity: ok (${Object.keys(actual).length} top-level keys, ${actual.journal?.length ?? 0} journal entries)`);
  process.exit(0);
}
const show = (v) => { const s = JSON.stringify(v); return s && s.length > 200 ? s.slice(0, 200) + "…" : s; };
console.error(`parity: MISMATCH at ${diff.path}\n  wire.ts:  ${show(diff.actual)}\n  old Hub:  ${show(diff.expected)}`);
process.exit(1);
