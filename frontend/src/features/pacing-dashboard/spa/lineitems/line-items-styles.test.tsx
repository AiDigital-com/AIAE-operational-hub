/**
 * Every class the Line Items block emits has a rule somewhere.
 *
 * WHY THIS EXISTS. The feature's CLAUDE.md records how the moved SPA's stylesheet was built: by
 * scanning the source for `class="..."` literals. Everything composed at runtime was missed, and the
 * symptom never reads as "missing stylesheet" - an unmatched utility silently inherits, and an
 * undefined custom property invalidates the whole declaration it sits in. That is how a section
 * widget once rendered at three times its height and the charts 60% too large.
 *
 * So this does not read the source. It renders the block, collects the classes off the LIVE DOM, and
 * checks each one against what the stylesheets actually declare. The same pass that found the 80
 * utilities and the two `lis-*` rules this block needed - run as a test so the next person who edits
 * a `className` in there finds out immediately rather than from a screenshot.
 *
 * The card is expanded first: a split row and a timeline only enter the DOM once a line item is
 * opened, and those were two of the places the original extraction missed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aPacingDashboardV1,
  aPacingLibraryEntryV1,
  aPacingLineItemPlanV1,
  aPacingRefreshStatusV1,
  aPacingRowV1,
} from "@/test/factories";
import * as api from "../../api";
import { ToastProvider } from "../../../../shared/ui/toast/toast";
import { PacingDashboard } from "../../pacing-dashboard";

vi.mock("../../api", () => ({
  getPacingDashboard: vi.fn(),
  savePacingCampaignLinks: vi.fn(),
  getPacingRefreshStatus: vi.fn(),
  triggerPacingRefresh: vi.fn(),
  savePacingDisplay: vi.fn(),
  listPacingLibrary: vi.fn(),
  createPacingLibraryEntry: vi.fn(),
  updatePacingLibraryEntry: vi.fn(),
  deletePacingLibraryEntry: vi.fn(),
  setPacingLibraryLike: vi.fn(),
}));

/** Every stylesheet that can reach this block, in load order. */
const STYLESHEETS = [
  "src/app/tokens.css",
  "src/app/styles.css",
  "src/features/pacing-dashboard/spa/pacing-spa.css",
  "src/features/pacing-dashboard/spa/tailwind-subset.css",
  "src/features/pacing-dashboard/spa/kit.css",
];

/**
 * Class names and custom properties the stylesheets declare.
 *
 * Classes are read with the backslashes stripped, because Tailwind's bracket syntax is escaped in a
 * selector (`.h-\[22px\]`) and plain in the markup (`h-[22px]`).
 */
function declared() {
  const css = STYLESHEETS.map((f) => readFileSync(f, "utf8")).join("\n");
  const classes = new Set<string>();
  for (const m of css.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) classes.add(m[1].replace(/\\/g, ""));
  const tokens = new Set<string>();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) tokens.add(m[1]);
  return { classes, tokens };
}

/** Renders the dashboard with two line items, one of them carrying containers, and expands a card. */
async function renderExpanded() {
  const withContainers = aPacingLineItemPlanV1({
    lineItemId: "70123",
    channel: "Display",
    containers: [
      {
        id: "c1",
        name: "Initial",
        fs: "2026-08-01",
        fe: "2026-08-31",
        target_impressions: 500_000,
        date_children: [{ id: "d1", fs: "2026-08-01", fe: "2026-08-15", target_impressions: 250_000 }],
        dim_children: [],
      },
    ] as never,
  });
  const video = aPacingLineItemPlanV1({ lineItemId: "70124", channel: "Video", rateType: "CPV" });

  vi.mocked(api.getPacingDashboard).mockResolvedValue(
    aPacingDashboardV1({
      planByLineItem: { "70123": withContainers, "70124": video },
      factsDaily: [
        { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
        { date: "2026-08-02", line_item_id: "70123", impressions: 150_000, clicks: 160, spend: 700 },
        { date: "2026-08-01", line_item_id: "70124", impressions: 300_000, clicks: 90, spend: 1_200 },
      ] as never,
    })
  );
  vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());

  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <PacingDashboard row={aPacingRowV1()} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

  const section = await waitFor(() => {
    const heading = screen.getByText("Line Items");
    return heading.closest("div")!.parentElement as HTMLElement;
  });
  await waitFor(() => expect(section.textContent).toMatch(/LI 70123/));

  // Open the first card, so the split rows and the timeline are in the DOM too.
  const header = section.querySelector('[class*="cursor-pointer"]');
  if (header) await userEvent.click(header as HTMLElement);
  await waitFor(() => expect(section.querySelectorAll("*").length).toBeGreaterThan(50));

  return section;
}

/** Class names on every element under the block. SVG elements carry an SVGAnimatedString rather
 *  than a string, which is why this reads `getAttribute` instead of `.className`. */
function classesIn(root: HTMLElement) {
  const found = new Set<string>();
  for (const el of root.querySelectorAll("*")) {
    for (const c of (el.getAttribute("class") ?? "").split(/\s+/)) if (c) found.add(c);
  }
  return found;
}

/** `var(--x)` names used in inline styles under the block. An undefined one does not fall back - it
 *  invalidates its whole declaration, so the element silently inherits something else. */
function tokensIn(root: HTMLElement) {
  const found = new Set<string>();
  for (const el of root.querySelectorAll("*")) {
    const style = el.getAttribute("style") ?? "";
    for (const m of style.matchAll(/var\((--[a-z0-9-]+)/g)) found.add(m[1]);
  }
  return found;
}

describe("Line Items styling (PDI_167)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([aPacingLibraryEntryV1()]);
  });

  it("should declare a rule for every class the block renders", async () => {
    const section = await renderExpanded();
    const { classes } = declared();

    const unstyled = [...classesIn(section)].filter((c) => {
      if (classes.has(c)) return false;
      // `focus:outline-none` is deliberately not declared: implementing it would strip the search
      // field's focus ring with nothing put back, and this app has no Tailwind preflight restyling
      // focus. Leaving it unmatched is what keeps the browser's own ring.
      if (c === "focus:outline-none") return false;
      // Pacing-namespaced hooks with no rules of their own: the timeline marks its bar and segments
      // so its injected tooltip CSS can find them, and positions them with inline styles.
      if (/^tl-/.test(c)) return false;
      // Unmatched ON PURPOSE, to agree with the reference. Verified against real Tailwind v4.2.2
      // with Pacing's own `@theme`: `font-[...]` compiles to font-WEIGHT, and a family name is not
      // a valid weight, so the declaration is dropped and the element inherits. These two do
      // nothing in Pacing either; defining them as font-family here would render the channel badge
      // and the search field in a face the reference never showed.
      if (c === "font-[var(--font-sans)]" || c === "font-[var(--font-barlow)]") return false;
      return true;
    });

    expect(unstyled).toEqual([]);
  });

  it("should define every custom property the block's inline styles read", async () => {
    const section = await renderExpanded();
    const { tokens } = declared();
    const undefined_ = [...tokensIn(section)].filter((t) => !tokens.has(t));
    expect(undefined_).toEqual([]);
  });

  it("should carry the timeline palette in both themes", async () => {
    // Six colours, and the dark set is not the light set dimmed - each hue is lifted so a segment
    // stays legible on a dark bar. A theme missing them would paint every segment the same.
    const css = readFileSync("src/features/pacing-dashboard/spa/pacing-spa.css", "utf8");
    // Anchored on the opening brace, not on the bare word: the file's header comment names both
    // `:root` and `[data-theme="dark"]` in prose, well above the blocks themselves.
    const lightAt = css.indexOf("\n:root {");
    const darkAt = css.indexOf('\n[data-theme="dark"] {');
    expect(lightAt).toBeGreaterThan(-1);
    expect(darkAt).toBeGreaterThan(lightAt);
    const light = css.slice(lightAt, darkAt);
    const dark = css.slice(darkAt, css.indexOf("\n}", darkAt) + 2);
    for (let i = 0; i <= 5; i++) {
      expect(light).toMatch(new RegExp(`--tl-${i}:`));
      expect(dark).toMatch(new RegExp(`--tl-${i}:`));
    }
    expect(light).toMatch(/--edge:/);
    expect(dark).toMatch(/--edge:/);
  });
});
