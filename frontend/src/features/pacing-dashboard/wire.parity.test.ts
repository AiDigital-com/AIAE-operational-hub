/**
 * The port is held to the Java mapper it replaced, over REAL bodies (DASHBOARD-DATA-PASSTHROUGH-PLAN
 * §12, "Соответствие Java-маппера и wire.ts").
 *
 * `__fixtures__/wire/<name>.pacing.json` is a dashboard body exactly as the local Pacing served it
 * (merge + capabilities stamp; the transparent arrays cut to a few rows, which the port never reads).
 * `<name>.<context>.expected.json` is what the Java mapper - deserialising through the RestClient
 * defaults, serialising through the Boot mapper, i.e. the bytes the browser used to receive - made of
 * that same body for the caller context in `<name>.contexts.json`. Captured once, by a writer that was
 * deleted with the mapper; these files are the only remaining record of its behaviour.
 *
 * Both sides go through a JSON round-trip before comparing, so `undefined` and `null` are compared as
 * the browser would see them: a key the Java side wrote as null must be present as null here.
 * A difference is a defect in the port, never a reason to edit the expected file.
 *
 * THE FIXTURES ARE NOT IN GIT (owner decision 2026-10-30): they are real client bodies, and the Hub
 * deploys to dev first for exactly that reason. They live only on the machine that captured them,
 * so this suite SKIPS when the directory is empty rather than failing CI. It ran green there (10
 * pacings x 4 contexts) before the Java mapper was deleted; anonymised fixtures that could be
 * committed are a possible follow-up.
 */
import { describe, expect, it } from "vitest";
import { readDashboardWire, type PacingDashboardWireV1, type WireContext } from "./wire";

// Vite's glob import, not the file system: the test runs under jsdom, where import.meta.url is not a
// file URL. Every JSON under the fixture directory is loaded eagerly and parsed by Vite.
const files = import.meta.glob("./__fixtures__/wire/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const read = (file: string): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const key = `./__fixtures__/wire/${file}`;
  if (!(key in files)) throw new Error(`missing fixture ${file}`);
  return files[key];
};
const names = Object.keys(files)
  .filter((k) => k.endsWith(".pacing.json"))
  .map((k) => k.replace(/^.*\//, "").replace(/\.pacing\.json$/, ""))
  .sort();

describe.skipIf(names.length === 0)("wire.ts against the Java mapper's recorded output", () => {
  it("has fixtures to compare against", () => {
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  for (const name of names) {
    const raw = read(`${name}.pacing.json`) as PacingDashboardWireV1;
    const contexts = read(`${name}.contexts.json`) as Record<string, { ownPacingUserId: string | null; unrestricted: boolean }>;
    for (const [context, ctx] of Object.entries(contexts)) {
      it(`${name} / ${context}`, () => {
        const expected = read(`${name}.${context}.expected.json`);
        const wireCtx: WireContext = { ownPacingUserId: ctx.ownPacingUserId, unrestricted: ctx.unrestricted };
        const actual = JSON.parse(JSON.stringify(readDashboardWire(raw, wireCtx)));
        expect(actual).toEqual(expected);
      });
    }
  }
});
