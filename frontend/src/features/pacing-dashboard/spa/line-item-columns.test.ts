/**
 * The Line Items card's margin colour (`marginStatusCls`): compared at the two decimals the card
 * prints, so a margin exactly on target is green even when its sum lands a hair below it.
 */
import { describe, expect, it } from "vitest";
import { marginStatusCls } from "./line-item-columns.js";

const GREEN = "text-[var(--status-green)]";
const AMBER = "text-[var(--status-amber)]";
const RED = "text-[var(--status-red)]";

describe("marginStatusCls", () => {
  it("reads a margin exactly on target as green when its sum lands a hair below it", () => {
    // Given: Hooky Evergreen SEM, LI 629998 - cost exactly 10x spend, summed day by day
    const mA = 89.99999999999999;

    // When / Then:
    expect(marginStatusCls(mA, 90, { marginWarn: -3 })).toBe(GREEN);
    expect(marginStatusCls(39.999999999999986, 40, { marginWarn: -3 })).toBe(GREEN);
  });

  it("keeps a blended container target from turning an on-target line amber", () => {
    expect(marginStatusCls(90, 90.00000000000001, { marginWarn: -3 })).toBe(GREEN);
  });

  it("still reads a margin visibly below target as amber, and past the gap as red", () => {
    // Given: 89.99% prints below 90.00%; 86.99% is more than the 3 pp gap below it
    expect(marginStatusCls(89.99, 90, { marginWarn: -3 })).toBe(AMBER);
    expect(marginStatusCls(86.99, 90, { marginWarn: -3 })).toBe(RED);
  });
});
