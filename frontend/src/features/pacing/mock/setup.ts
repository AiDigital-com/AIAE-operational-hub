import { type MockChannel, TACTICS } from "./constants";
import { parseMoney } from "./format";
import { seedFromId } from "./rng";
import type { InsertionOrder, LineItem, MockCam, SetupAdjustments, SetupModel } from "./types";

/**
 * Builds one insertion order per channel, with tactics-per-channel defining its line items and budget
 * split evenly — the mock stand-in for the eventual NetSuite-backed IO/LI read (see
 * 01-MIGRATION-PLAN.md W3). Also the input to `campPacing`, since campaign-level pacing is really a
 * roll-up of per-LI pacing.
 *
 * IO/LI ids are derived deterministically from the campaign's own id (never a shared mutable counter,
 * which the mockup uses but which is unsafe across renders/reloads in React) so a given campaign always
 * shows the same ids.
 *
 * @param cam the adapted campaign (see `toPacingCampaign`)
 * @return the campaign's insertion orders and line items
 */
export function buildSetup(cam: MockCam): SetupModel {
  const seed = seedFromId(cam.id);
  const ioBase = 10000 + (seed % 9000);
  const liBase = 500000 + ((seed * 7) % 90000);
  const total = parseMoney(cam.budget);
  const perChannel = cam.channels.length > 0 ? total / cam.channels.length : 0;

  let liIndex = 0;
  const ios: InsertionOrder[] = cam.channels.map((channel, i) => {
    const tactics = TACTICS[channel as MockChannel] ?? ["General"];
    const lis: LineItem[] = tactics.map((tactic, j) => {
      const li: LineItem = {
        id: `LI ${liBase + liIndex}`,
        name: tactic,
        channel,
        start: cam.start,
        end: cam.end,
        budget: Math.round(perChannel / tactics.length),
        status: cam.status === "live" && j % 2 === 1 ? "paused" : cam.status,
        manual: false,
      };
      liIndex += 1;
      return li;
    });
    return {
      id: `IO-${ioBase + i}`,
      name: `${channel} — ${cam.name}`,
      channel,
      start: cam.start,
      end: cam.end,
      budget: lis.reduce((sum, li) => sum + li.budget, 0),
      status: cam.status,
      lis,
      manual: false,
      open: true,
    };
  });

  return { ios };
}

/**
 * Read = base ⊕ adjustments (see `Adjustments<Row>`/`mergeAdjustments`, applied here to the nested IO/LI
 * shape instead of a flat row list): manually-added line items are appended into their parent IO —
 * whose displayed budget becomes its own base budget *plus* the manual LIs' — and manually-added IOs
 * are appended after the base ones. The base `SetupModel` itself is never mutated.
 *
 * Adds rather than recomputing from every LI's own budget: the base IO's budget is the order's real
 * `order_budget` once real data backs it (see `campaigns/setup.ts`), which need not equal the sum of
 * its real LIs' own `tactic_budget`s - recomputing from scratch would silently rewrite that real
 * number the moment a user adds one manual line item.
 */
export function mergeSetup(base: SetupModel, adjustments: SetupAdjustments): SetupModel {
  const ios = base.ios.map((io) => {
    const addedLis = adjustments.addedLIs[io.id];
    if (!addedLis?.length) return io;
    const lis = [...io.lis, ...addedLis];
    return { ...io, lis, budget: io.budget + addedLis.reduce((sum, li) => sum + li.budget, 0) };
  });
  return { ios: ios.concat(adjustments.addedIOs) };
}
