import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BreakdownPanel } from "./breakdown-panel";
import { toHubShape } from "../engine/__fixtures__/to-hub-shape";
import { DEFAULT_FILTERS } from "../filters/types";
import type { DashboardFilters } from "../filters/types";
import type { PacingDashboardV1 } from "../types";

// jsdom lays nothing out, so Recharts' ResponsiveContainer sees a 0x0 box and draws no donut. The
// panel must still render its tabs and table around it, which is what every case below asserts;
// the donut itself is exercised only for "does not throw".
Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => ({ width: 320, height: 180, top: 0, left: 0, bottom: 180, right: 320, x: 0, y: 0, toJSON() {} }),
});

/**
 * The fixture's two line items are both CPM (so the primary unit is impressions) and carry three
 * dimension columns with two values each - `audience`, `tactic`, `platform`. Line item 200 is the
 * video one (a VCR target), which is what puts the gated Compl./VCR pair on screen.
 *
 *   audience: auto_intenders (LI 200) = 108 000 impressions, sports_fans (LI 100) = 55 000
 */
function payload(): PacingDashboardV1 {
  return toHubShape();
}

function renderPanel(over: Partial<DashboardFilters> = {}, data: PacingDashboardV1 | null = payload()) {
  const setFilters = vi.fn();
  const view = render(
    <BreakdownPanel data={data} filters={{ ...DEFAULT_FILTERS, ...over }} setFilters={setFilters} />
  );
  return { setFilters, ...view };
}

/** The data row for one segment, found by the name in its first cell. */
function segmentRow(label: string): HTMLElement {
  const cell = screen.getByText(label);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

describe("BreakdownPanel", () => {
  it("offers one tab per dimension the pacing carries, in display order", () => {
    renderPanel();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Audience", "Funnel", "Platform"]);
  });

  it("opens on the first cut and ranks its values by the pacing's buying unit", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: /Audience/ })).toHaveAttribute("aria-selected", "true");

    const names = screen.getAllByRole("row").slice(1, 3).map((row) => row.querySelector(".pbrk__label")?.textContent);
    expect(names).toEqual(["auto_intenders", "sports_fans"]);
  });

  it("states each value's share of delivery beside its name", () => {
    renderPanel();
    // 108 000 and 55 000 of 163 000.
    expect(within(segmentRow("auto_intenders")).getByText("66.3%")).toBeInTheDocument();
    expect(within(segmentRow("sports_fans")).getByText("33.7%")).toBeInTheDocument();
  });

  it("shows the gated completion pair only because a VCR-eligible line delivered completes", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /Compl\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /VCR/ })).toBeInTheDocument();
    // Nothing converted in this fixture, so those columns stay off rather than showing zeroes.
    expect(screen.queryByRole("button", { name: /^Conv/ })).not.toBeInTheDocument();
  });

  it("turns a click on a value into a breakdown filter on that cut", async () => {
    const { setFilters } = renderPanel();
    await userEvent.click(within(segmentRow("auto_intenders")).getByRole("button"));
    expect(setFilters).toHaveBeenCalledWith({ brk: "audience", brkf: ["audience:auto_intenders"] });
  });

  it("clicking an already-filtered value removes just that pair, leaving the others", async () => {
    // Both pairs match the same line item's rows, so the cut still has a row to click. A pair on a
    // dimension this pacing does not carry would filter every row away instead - see the next case.
    const { setFilters } = renderPanel({ brk: "audience", brkf: ["audience:auto_intenders", "platform:TTD"] });
    await userEvent.click(within(segmentRow("auto_intenders")).getByRole("button"));
    expect(setFilters).toHaveBeenCalledWith({ brk: "audience", brkf: ["platform:TTD"] });
  });

  it("narrows the cut to the value being filtered, because every figure reads the filtered facts", () => {
    // Deliberate, and the reason the TAB bar is read from the unfiltered aggregate instead: a live
    // `audience:auto_intenders` chip leaves the audience cut with exactly one row. If the tab list
    // were read the same way, clicking a row would remove that row's own tab.
    renderPanel({ brk: "audience", brkf: ["audience:auto_intenders"] });
    expect(screen.getByText("auto_intenders")).toBeInTheDocument();
    expect(screen.queryByText("sports_fans")).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("marks the filtered row as pressed, so the state is not carried by colour alone", () => {
    renderPanel({ brk: "audience", brkf: ["audience:auto_intenders", "platform:TTD"] });
    expect(within(segmentRow("auto_intenders")).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves every row unpressed when nothing is filtered", () => {
    renderPanel();
    expect(within(segmentRow("auto_intenders")).getByRole("button")).toHaveAttribute("aria-pressed", "false");
    expect(within(segmentRow("sports_fans")).getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });

  it("opens on the cut the URL names, so a shared link lands where its chip came from", () => {
    renderPanel({ brk: "platform", brkf: ["platform:TTD"] });
    expect(screen.getByRole("tab", { name: "Platform" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows a platform under the name used everywhere else, but filters on the raw value", async () => {
    const { setFilters } = renderPanel({ brk: "platform", brkf: [] });
    // The raw BigQuery slug is `dv_360_dlv`; the chips and the journal palette both say DV360.
    await userEvent.click(within(segmentRow("DV360")).getByRole("button"));
    expect(setFilters).toHaveBeenCalledWith({ brk: "platform", brkf: ["platform:dv_360_dlv"] });
  });

  it("switches cut on a tab click and re-ranks by that cut's own values", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("tab", { name: /Funnel/ }));
    expect(screen.getByRole("tab", { name: /Funnel/ })).toHaveAttribute("aria-selected", "true");
    const names = screen.getAllByRole("row").slice(1, 3).map((row) => row.querySelector(".pbrk__label")?.textContent);
    expect(names).toEqual(["retargeting", "prospecting"]);
  });

  it("narrows the table by the search box without touching the dashboard's own filters", async () => {
    const { setFilters } = renderPanel();
    await userEvent.type(screen.getByRole("textbox"), "sports");
    expect(screen.queryByText("auto_intenders")).not.toBeInTheDocument();
    expect(screen.getByText("sports_fans")).toBeInTheDocument();
    expect(setFilters).not.toHaveBeenCalled();
  });

  it("says so when a search matches nothing, rather than showing an empty table", async () => {
    renderPanel();
    await userEvent.type(screen.getByRole("textbox"), "zzz");
    expect(screen.getByText(/No segments match/)).toBeInTheDocument();
  });

  it("totals the columns it shows", () => {
    renderPanel();
    const totals = screen.getByText("Total").closest("tr")!;
    // 55 000 + 108 000 impressions across the two audience values.
    expect(within(totals).getByText("163,000")).toBeInTheDocument();
  });

  it("sizes and ranks by clicks on a clicks-bought pacing, not by impressions", () => {
    // The primary unit follows the buy type (`domRateType`). Line item 100 is the one with clicks;
    // on impressions it is the SMALLER of the two, so a wrong unit would put it second.
    const cpc = payload();
    for (const plan of Object.values(cpc.planByLineItem ?? {})) {
      (plan as { rateType?: string }).rateType = "CPC";
    }
    renderPanel({}, cpc);
    const names = screen.getAllByRole("row").slice(1, 3).map((row) => row.querySelector(".pbrk__label")?.textContent);
    expect(names).toEqual(["sports_fans", "auto_intenders"]);
    // 260 of 260 clicks - the other value delivered none.
    expect(within(segmentRow("sports_fans")).getByText("100.0%")).toBeInTheDocument();
  });

  it("gives the Others remainder its unit and an em dash everywhere else", () => {
    // Untag one line item on `audience` only: its delivery still counts toward the campaign total,
    // so the audience cut is short by exactly that much and the remainder row appears. Its clicks,
    // spend and completes were never worked out - printing 0 would claim they were.
    const partial = payload();
    partial.factsDaily = (partial.factsDaily ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      if (r.line_item_id !== "100") return r;
      const { audience, ...rest } = r;
      void audience;
      return rest;
    });
    renderPanel({}, partial);

    const others = segmentRow("Others");
    const cells = Array.from(others.querySelectorAll("td")).slice(1).map((td) => td.textContent);
    // Impressions, then Clicks / CTR / Spend / CPM / Compl. / VCR.
    expect(cells[0]).toBe("55,000");
    expect(cells.slice(1)).toEqual(["—", "—", "—", "—", "—", "—"]);
    // Nothing to filter by, so the row carries no button at all.
    expect(within(others).queryByRole("button")).not.toBeInTheDocument();
  });

  /**
   * "Outside splits" is the complement of the rows above: delivery this line item ran on values its
   * container splits never declared. It only means something inside ONE line item, which in this app
   * is a `selection` of one - the state the Spotlight's line-item pick puts the dashboard in.
   *
   * The fixture is made to have one: line item 200's container (Aug 1-7) declares `auto_intenders`
   * and covers its whole target, and two of its delivery days are moved onto a second audience value
   * the container never names.
   */
  function withOutside(): PacingDashboardV1 {
    const data = payload();
    const plan = (data.planByLineItem ?? {})["200"] as { containers?: unknown[] };
    plan.containers = [
      {
        id: "c1",
        name: "Week 1",
        fs: "2026-08-01",
        fe: "2026-08-07",
        target_impressions: 150_000,
        date_children: [],
        dim_children: [
          { id: "d1", dim_key: "audience", dim_value: "auto_intenders", target_mode: "absolute", target_value: 150_000 },
        ],
      },
    ];
    data.factsDaily = (data.factsDaily ?? []).map((row) => {
      const r = { ...(row as Record<string, unknown>) };
      if (r.line_item_id === "200" && (r.date === "2026-08-04" || r.date === "2026-08-05")) {
        r.audience = "in_market";
      }
      return r;
    });
    return data;
  }

  it("offers the outside-splits complement once the view is one line item", () => {
    renderPanel({ selection: ["200"] }, withOutside());
    const outside = screen.getByRole("button", { name: "Outside splits" });
    expect(outside).toHaveAttribute("aria-pressed", "false");
    // 22 400 + 23 200 impressions on the undeclared value, of the line item's 108 000.
    expect(screen.getByText(/45,600 impressions · 42\.2% of delivery/)).toBeInTheDocument();
    expect(screen.getByText("already counted in the rows above")).toBeInTheDocument();
  });

  it("does not offer it across several line items, where the complement means nothing", () => {
    renderPanel({}, withOutside());
    expect(screen.queryByRole("button", { name: "Outside splits" })).not.toBeInTheDocument();
  });

  it("does not offer it on a line item whose containers declare no dimension", () => {
    // The untouched fixture's container has no dim children, so there is nothing to be outside of.
    renderPanel({ selection: ["200"] });
    expect(screen.queryByRole("button", { name: "Outside splits" })).not.toBeInTheDocument();
  });

  it("turns it on as its own filter pair, without disturbing the line-item scope", async () => {
    const { setFilters } = renderPanel({ selection: ["200"] }, withOutside());
    await userEvent.click(screen.getByRole("button", { name: "Outside splits" }));
    // No `selection` in the patch: the scope is what put this row on screen, and clearing it on the
    // way out would drop that scope - see `toggleOutside`.
    expect(setFilters).toHaveBeenCalledWith({ brk: "audience", brkf: ["audience:__outside__@200"] });
  });

  it("says which way round it is once the complement is showing", () => {
    renderPanel({ selection: ["200"], brk: "audience", brkf: ["audience:__outside__@200"] }, withOutside());
    expect(screen.getByRole("button", { name: "Outside splits" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("showing only this")).toBeInTheDocument();
  });

  /**
   * A dimension source is the other kind of cut: its values live in their own file, not on the
   * delivery rows, so it describes PART of delivery rather than partitioning it. The fixture below
   * gives the pacing the catalogued Devices source covering 82 000 of its 163 000 impressions -
   * 80 000 under a device name, 2 000 the source saw but could not name.
   */
  function withDevices(over: Record<string, unknown> = {}): PacingDashboardV1 {
    const data = payload();
    const days = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
    const rows = days.flatMap((date, i) => [
      { date, line_item_id: "200", dims: { device_type: "Mobile" }, metrics: { im: 10_000, cl: 20, sp: 40 } },
      // Two spellings of one screen - the built-in table merges them into a single CTV row.
      { date, line_item_id: "200", dims: { device_type: i < 3 ? "Ctv" : "Connected Tv" }, metrics: { im: 6_000, cl: 5, sp: 30 } },
    ]);
    rows.push({ date: "2026-08-01", line_item_id: "200", dims: { device_type: "" }, metrics: { im: 2_000, cl: 3, sp: 8 } });
    data.data = { source: "platform_mart", dim_sources: [{ id: "devices", loader: "bq_mart", origin: { catalog: "devices" } }] };
    data.dimSources = { devices: { rows, fetched_at: "2026-08-05", status: "ok", behind: false, ...over } };
    return data;
  }

  it("offers a configured dimension source as its own cut, after the delivery ones", () => {
    renderPanel({}, withDevices());
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Audience", "Funnel", "Platform", "Device"]);
    // The word that says where a cut comes from rides in the tooltip, not on a second line.
    expect(screen.getByRole("tab", { name: "Device" })).toHaveAttribute("title", "from DSP");
  });

  it("merges a source's spellings of one value and makes its parts add up to delivery", async () => {
    renderPanel({}, withDevices());
    await userEvent.click(screen.getByRole("tab", { name: /Device/ }));

    // slice(1, -1): the head row and the Total row are rows too, and neither carries a label.
    const names = screen.getAllByRole("row").slice(1, -1).map((row) => row.querySelector(".pbrk__label")?.textContent);
    // 'Ctv' and 'Connected Tv' are one row; then the two leftovers, 'Not covered' last of all.
    expect(names).toEqual(["Mobile", "CTV", "No value", "Not covered"]);

    // 50 000 + 30 000 + 2 000 + 81 000 - the whole of this pacing's delivery, which is the entire
    // point of the leftover rows.
    const totals = screen.getByText("Total").closest("tr")!;
    expect(within(totals).getByText("163,000")).toBeInTheDocument();
  });

  it("states how much of delivery the source knows about, and how much it can name", async () => {
    renderPanel({}, withDevices());
    await userEvent.click(screen.getByRole("tab", { name: /Device/ }));
    // 82 000 of 163 000 seen; 80 000 of it under a name.
    expect(screen.getByText(/covers 50% of delivery · 49% shown by value/)).toBeInTheDocument();
    expect(screen.getByText("measured Aug 1 – Aug 5")).toBeInTheDocument();
  });

  it("says nothing about coverage on a delivery cut, which partitions delivery by construction", () => {
    renderPanel({}, withDevices());
    expect(screen.queryByText(/covers .* of delivery/)).not.toBeInTheDocument();
  });

  it("refuses a click on a source value - no fact carries one, so no filter could match it", async () => {
    const { setFilters } = renderPanel({}, withDevices());
    await userEvent.click(screen.getByRole("tab", { name: /Device/ }));
    // Not even a button: the row offers no action at all rather than one that does nothing.
    expect(within(segmentRow("Mobile")).queryByRole("button")).not.toBeInTheDocument();
    await userEvent.click(segmentRow("Mobile"));
    expect(setFilters).not.toHaveBeenCalled();
  });

  it("says when the rows on screen are older than the delivery beside them", async () => {
    renderPanel({}, withDevices({ behind: true, coverage_hint: "2026-08-03" }));
    await userEvent.click(screen.getByRole("tab", { name: /Device/ }));
    expect(
      screen.getByText(/these rows are from an earlier refresh; the breakdown has data to Aug 3, the dashboard to Aug 5/)
    ).toBeInTheDocument();
  });

  it("says when the last read failed and these are the rows it managed before", async () => {
    renderPanel({}, withDevices({ status: "stale", error: "PERMISSION_DENIED: no access" }));
    await userEvent.click(screen.getByRole("tab", { name: /Device/ }));
    expect(screen.getByText(/last read failed \(PERMISSION_DENIED\), showing data from today/)).toBeInTheDocument();
  });

  it("renders nothing at all on a pacing with no dimensional delivery", () => {
    const bare = payload();
    bare.factsDaily = (bare.factsDaily ?? []).map((row) => {
      const { audience, tactic, platform, ...rest } = row as Record<string, unknown>;
      void audience;
      void tactic;
      void platform;
      return rest;
    });
    const { container } = renderPanel({}, bare);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the dashboard payload has not arrived", () => {
    const { container } = renderPanel({}, null);
    expect(container).toBeEmptyDOMElement();
  });
});
