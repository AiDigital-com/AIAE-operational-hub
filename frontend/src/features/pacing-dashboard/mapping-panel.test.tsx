import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRef } from "react";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PacingMappingSection } from "./mapping-panel";
import type { SettingsSectionHandle } from "./settings-section";
import * as api from "./api";

/**
 * Settings → Mapping.
 *
 * The numbers on this screen come from the comparison engine itself (`classifyAll`), not from a
 * rule restated here - so these tests feed real facts and real CM360 rows and assert on what the
 * engine makes of them. That is deliberate: a test that pinned a local copy of the matching rule
 * would keep passing on the day the engine changed underneath it.
 *
 * The other thing worth pinning is what a save SAYS: `null` clears the list, `[]` would mean
 * something else, and a level this editor does not offer must still round-trip.
 */

/** One line item delivering Display/CTV, with a CM360 placement that carries the same word. */
const FACTS = [
  { date: "2026-09-01", line_item_id: "1", impressions: 1000, tactic: "Display", geo: "CA" },
  { date: "2026-09-01", line_item_id: "2", impressions: 500, tactic: "CTV", geo: "CA" },
];
const TYPES = [
  { line_item_id: "1", type: "Display" },
  { line_item_id: "2", type: "Video" },
];

function renderPanel(
  props: Partial<React.ComponentProps<typeof PacingMappingSection>> = {},
  ref?: React.Ref<SettingsSectionHandle>,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PacingMappingSection
        ref={ref}
        slug="nike-ss26"
        mappings={null}
        cm360={null}
        factsDaily={[]}
        types={[]}
        liPlan={{}}
        creatives={null}
        seedKey={0}
        onDirtyChange={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

/** Render, then open the first mapping. The list never auto-opens - choosing WHICH mapping you are
 *  editing is its own step - so every editor assertion has to go through it. */
function renderOpened(props: Partial<React.ComponentProps<typeof PacingMappingSection>> = {},
  ref?: React.Ref<SettingsSectionHandle>) {
  const r = renderPanel(props, ref);
  const card = document.querySelector(".pmap__ent");
  if (card) fireEvent.click(card);
  return r;
}

/** The reach line a dimension shows, e.g. "1/2 delivery rows · 1/1 placements". */
function reachOf(dimName: string): string {
  const input = screen.getByDisplayValue(dimName);
  const card = input.closest(".pmap__dim")!;
  return card.querySelector(".pmap__fx")!.textContent ?? "";
}

describe("the numbers come from the engine", () => {
  it("shows how far a dimension reaches on each side", () => {
    renderOpened({
      factsDaily: FACTS,
      types: TYPES,
      cm360: { rows: [{ placement: "Hulu CTV", creative: "" }, { placement: "Roku OTT", creative: "" }] },
      mappings: [{
        id: "mp_1", name: "Comparison", level: "placement",
        dimensions: [{ id: "d1", name: "Format", source: "manual", values: [{ value: "CTV", aliases: [] }] }],
      }],
    });
    // One of the two delivery rows has tactic CTV (field equality); one of the two placements
    // carries the word (token match). Two sides, two rules, one line.
    expect(reachOf("Format")).toBe("1/2 delivery rows · 1/2 placements");
  });

  it("an alias reaches what the value's own name does not", () => {
    renderOpened({
      factsDaily: FACTS,
      types: TYPES,
      cm360: { rows: [{ placement: "Roku OTT", creative: "" }] },
      mappings: [{
        id: "mp_1", name: "Comparison", level: "placement",
        dimensions: [{
          id: "d1", name: "Format", source: "manual",
          values: [{ value: "CTV", aliases: ["OTT"] }],
        }],
      }],
    });
    // "CTV" alone catches no placement here; the alias OTT catches the only one.
    expect(reachOf("Format")).toBe("1/2 delivery rows · 1/1 placements");
  });

  it("the delivery side matches a WHOLE field, not a word inside a longer one", () => {
    // The engine builds delivery rows with `name: ''` and compares `row.fields` for equality, so a
    // value that is merely contained in a field value classifies nothing. Promising otherwise sends
    // someone off to write an alias that cannot work.
    renderOpened({
      factsDaily: [{ date: "2026-09-01", line_item_id: "1", impressions: 10, tactic: "Programmatic Display" }],
      types: [{ line_item_id: "1", type: "Display" }],
      cm360: { rows: [{ placement: "Hulu Display", creative: "" }] },
      mappings: [{
        id: "mp_1", name: "M", level: "placement",
        dimensions: [{ id: "d1", name: "Format", source: "manual", values: [{ value: "Programmatic", aliases: [] }] }],
      }],
    });
    // 0 of 1 delivery rows: no field EQUALS "Programmatic", though one CONTAINS it. The CM360 side
    // is counted by its own rule, which is the whole point of showing two numbers.
    expect(reachOf("Format")).toBe("0/1 delivery rows · 0/1 placements");
  });
});

describe("the token pool", () => {
  it("offers words mined from both sides, and says which side each came from", () => {
    renderOpened({
      factsDaily: FACTS,
      types: TYPES,
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
      cm360: { rows: [{ placement: "Hulu CTV", creative: "" }] },
    });
    const pool = document.querySelector(".pmap__chips")!;
    expect(pool.textContent).toMatch(/hulu/i);
  });

  it("stops offering a word once it is spoken for", () => {
    renderOpened({
      factsDaily: FACTS,
      types: TYPES,
      cm360: { rows: [{ placement: "Hulu CTV", creative: "" }] },
      mappings: [{
        id: "mp_1", name: "M", level: "placement",
        dimensions: [{ id: "d1", name: "Format", source: "manual", values: [{ value: "hulu", aliases: [] }] }],
      }],
    });
    const pool = document.querySelector(".pmap__chips")!;
    expect(pool.textContent).not.toMatch(/hulu/i);
  });
});

describe("the editor", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("starts empty for a pacing that has never been mapped, and says why", () => {
    renderPanel();
    expect(screen.getByText(/No mapping yet/i)).toBeInTheDocument();
  });

  it("shows the three auto dimensions on a mapping that has none of its own", () => {
    // They are render-only: the engine answers Channel/Tactic/Month without anyone authoring a
    // thing, so a brand-new mapping should not look like an empty box.
    renderOpened({
      factsDaily: FACTS,
      types: TYPES,
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
    });
    expect(screen.getByDisplayValue("Channel")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Tactic")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Month")).toBeInTheDocument();
  });

  it("seeding the auto dimensions does NOT dirty the drawer", async () => {
    const onDirtyChange = vi.fn();
    renderOpened({
      factsDaily: FACTS,
      types: TYPES,
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
      onDirtyChange,
    });
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalled());
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it("shows what is on each side, so an alias is written against what is actually there", () => {
    renderOpened({
      factsDaily: FACTS,
      types: TYPES,
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
      cm360: { rows: [{ placement: "Hulu CTV", creative: "15s hero" }] },
    });
    expect(screen.getByText("Hulu CTV 15s hero")).toBeInTheDocument();
  });
});

describe("the row tables", () => {
  beforeEach(() => vi.restoreAllMocks());

  const MAPPED = [{
    id: "mp_1", name: "Comparison", level: "placement",
    dimensions: [{ id: "d1", name: "Format", source: "manual", values: [{ value: "CTV", aliases: [] }] }],
  }];

  it("lists the CM360 rows the comparison will see, with the engine's verdict per dimension", () => {
    renderOpened({
      factsDaily: FACTS, types: TYPES, mappings: MAPPED,
      cm360: { rows: [{ placement: "Hulu CTV", creative: "", impressions: 10 }] },
    });
    fireEvent.click(screen.getByRole("tab", { name: /CM360/ }));
    // The engine classified this placement, so the cell is a settled dropdown, not an amber pick.
    const cell = screen.getByLabelText(/Change Format \(auto-matched\)/);
    expect(cell).toHaveValue("CTV");
  });

  it("an undecided cell is offered as a pick, and picking it writes an override", async () => {
    const save = vi.spyOn(api, "savePacingMappings").mockResolvedValue(undefined);
    const ref = createRef<SettingsSectionHandle>();
    renderOpened({
      factsDaily: FACTS, types: TYPES, mappings: MAPPED,
      cm360: { rows: [{ placement: "Roku OTT", creative: "", impressions: 10 }] },
    }, ref);
    fireEvent.click(screen.getByRole("tab", { name: /CM360/ }));

    // Nothing in "Roku OTT" matches "CTV", so the engine leaves it undecided.
    const cell = screen.getByLabelText(/Pick Format/);
    expect(cell).toHaveValue("");
    fireEvent.change(cell, { target: { value: "CTV" } });
    await ref.current!.save();

    const [, sent] = save.mock.calls[0];
    const entity = (sent as Record<string, unknown>[])[0];
    expect(entity.cell_overrides).toEqual({ cm360: { "Roku OTT": { d1: "CTV" } } });
  });

  it("the delivery side of an auto dimension is not pickable - the field is the truth", () => {
    // Channel/Tactic read a structured field on the delivery side, so offering a dropdown there
    // would promise an override the engine refuses to honour.
    renderOpened({
      factsDaily: FACTS, types: TYPES,
      mappings: [{ id: "mp_1", name: "Comparison", level: "placement", dimensions: [] }],
    });
    // The auto dimensions are seeded, and the delivery tab is the default.
    expect(screen.queryByLabelText(/Pick Channel/)).toBeNull();
    expect(screen.queryByLabelText(/Change Channel/)).toBeNull();
  });

  it("filters to the rows that still need a decision", () => {
    renderOpened({
      factsDaily: FACTS, types: TYPES, mappings: MAPPED,
      cm360: {
        rows: [
          { placement: "Hulu CTV", creative: "", impressions: 10 },
          { placement: "Roku OTT", creative: "", impressions: 10 },
        ],
      },
    });
    fireEvent.click(screen.getByRole("tab", { name: /CM360/ }));
    // Scoped to the table: both placements also appear in the reference list further down.
    const names = () => [...document.querySelectorAll(".pmap__rows .pmap__rowname")]
      .map((n) => n.textContent);
    expect(names()).toEqual(["Hulu CTV", "Roku OTT"]);

    fireEvent.click(screen.getByLabelText(/Unresolved only/i));
    expect(names()).toEqual(["Roku OTT"]);   // the decided one drops out
  });
});

describe("suggestions", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the notice when nothing could be proposed, as a message and not an error", async () => {
    // The mock state: the whole path works, there is just no model connected to ask.
    vi.spyOn(api, "suggestPacingMappingLibrary").mockResolvedValue({
      dimensions: [], notice: "we need to add ai connection",
    });
    renderOpened({ mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }] });

    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));
    expect(await screen.findByText("we need to add ai connection")).toBeInTheDocument();
  });

  it("fetching a proposal does not dirty the drawer - only accepting one does", async () => {
    vi.spyOn(api, "suggestPacingMappingLibrary").mockResolvedValue({
      dimensions: [{ name: "Format", values: [{ value: "CTV", aliases: [] }] }], notice: null,
    });
    const onDirtyChange = vi.fn();
    renderOpened({
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
      onDirtyChange,
    });

    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));
    // The card shows up with the proposal's values on it; nothing is in the draft yet.
    const card = await screen.findByText("Format");
    expect(card.closest(".pmap__sugg-card")).toBeTruthy();
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);

    fireEvent.click(within(card.closest(".pmap__sugg-card")!).getByRole("button", { name: /^Add$/ }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
    expect(screen.getByDisplayValue("Format")).toBeInTheDocument();
  });

  it("a card dragged into the grid lands at the slot it was dropped on", async () => {
    // The only path the browser cannot exercise today: with no model connected the endpoint
    // proposes nothing, so there is no card to drag. Position matters because dimension order is
    // what the comparison breaks down by first.
    vi.spyOn(api, "suggestPacingMappingLibrary").mockResolvedValue({
      dimensions: [{ name: "Placement size", values: [{ value: "300x250", aliases: [] }] }],
      notice: null,
    });
    const save = vi.spyOn(api, "savePacingMappings").mockResolvedValue(undefined);
    const ref = createRef<SettingsSectionHandle>();
    renderOpened({
      mappings: [{
        id: "mp_1", name: "M", level: "placement",
        dimensions: [
          { id: "d1", name: "Format", source: "manual", values: [] },
          { id: "d2", name: "Geo", source: "manual", values: [] },
        ],
      }],
    }, ref);

    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));
    const card = (await screen.findByText("Placement size")).closest(".pmap__sugg-card")!;

    // Dropped on the FIRST dimension card, so it must land in front of it - not appended.
    const data: Record<string, string> = {};
    const dataTransfer = {
      types: ["mp3/sugg"],
      setData: (k: string, v: string) => { data[k] = v; },
      getData: (k: string) => data[k] ?? "",
    };
    fireEvent.dragStart(card, { dataTransfer });
    const first = document.querySelectorAll(".pmap__dim")[0];
    fireEvent.dragOver(first, { dataTransfer });
    fireEvent.drop(first, { dataTransfer });

    await ref.current!.save();
    const [, sent] = save.mock.calls[0];
    const dims = (sent as Record<string, unknown>[])[0].dimensions as Record<string, unknown>[];
    expect(dims.map((d) => d.name)).toEqual(["Placement size", "Format", "Geo"]);
  });

  it("does not offer a proposal whose name is already taken", async () => {
    // Accepting it would make a second dimension the engine then has to choose between, for a
    // reason nobody can see on the screen.
    vi.spyOn(api, "suggestPacingMappingLibrary").mockResolvedValue({
      dimensions: [{ name: "format", values: [] }], notice: null,
    });
    renderOpened({
      mappings: [{
        id: "mp_1", name: "M", level: "placement",
        dimensions: [{ id: "d1", name: "Format", source: "manual", values: [] }],
      }],
    });

    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));
    await waitFor(() => expect(api.suggestPacingMappingLibrary).toHaveBeenCalled());
    expect(document.querySelector(".pmap__sugg-card")).toBeNull();
  });
});

describe("unlocking an auto dimension", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("seeds it with the values the engine is deriving, so nothing is lost", async () => {
    const save = vi.spyOn(api, "savePacingMappings").mockResolvedValue(undefined);
    const ref = createRef<SettingsSectionHandle>();
    renderOpened({
      factsDaily: FACTS, types: TYPES,
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
    }, ref);

    // Channel derives Display/Video from the line item types.
    const card = screen.getByDisplayValue("Channel").closest(".pmap__dim")!;
    fireEvent.click(within(card).getByRole("button", { name: /Edit values/i }));
    await ref.current!.save();

    const [, sent] = save.mock.calls[0];
    const dims = (sent as Record<string, unknown>[])[0].dimensions as Record<string, unknown>[];
    const channel = dims.find((d) => d.id === "dm_auto_channel")!;
    // Now an ordinary library: no auto_kind, and carrying the derived values.
    expect(channel.auto_kind).toBeUndefined();
    expect(channel.source).toBe("manual");
    expect((channel.values as { value: string }[]).map((v) => v.value).sort())
      .toEqual(["Display", "Video"]);
  });

  it("an auto dimension cannot be removed while it is still locked", () => {
    renderOpened({
      factsDaily: FACTS, types: TYPES,
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
    });
    const card = screen.getByDisplayValue("Month").closest(".pmap__dim")!;
    expect(within(card).queryByRole("button", { name: /^Remove$/ })).toBeNull();
  });
});

describe("values and their aliases", () => {
  beforeEach(() => vi.restoreAllMocks());

  const ONE_VALUE = [{
    id: "mp_1", name: "M", level: "placement",
    dimensions: [{ id: "d1", name: "Format", source: "manual", values: [{ value: "CTV", aliases: ["ott"] }] }],
  }];

  it("says how many aliases a value carries without opening anything", () => {
    renderOpened({ mappings: ONE_VALUE });
    expect(screen.getByRole("button", { name: /CTV/ })).toHaveTextContent("+1");
  });

  it("adds an alias from the popover", async () => {
    const save = vi.spyOn(api, "savePacingMappings").mockResolvedValue(undefined);
    const ref = createRef<SettingsSectionHandle>();
    renderOpened({ mappings: ONE_VALUE }, ref);

    fireEvent.click(screen.getByRole("button", { name: /CTV/ }));
    const input = screen.getByPlaceholderText("+ alias");
    fireEvent.change(input, { target: { value: "connected tv" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await ref.current!.save();

    const [, sent] = save.mock.calls[0];
    const dims = (sent as Record<string, unknown>[])[0].dimensions as Record<string, unknown>[];
    expect((dims[0].values as { aliases: string[] }[])[0].aliases).toEqual(["ott", "connected tv"]);
  });

  it("removing a value puts its word back in the pool", () => {
    renderOpened({
      factsDaily: FACTS, types: TYPES,
      cm360: { rows: [{ placement: "Hulu CTV", creative: "" }] },
      mappings: [{
        id: "mp_1", name: "M", level: "placement",
        dimensions: [{ id: "d1", name: "Format", source: "manual", values: [{ value: "hulu", aliases: [] }] }],
      }],
    });
    const pool = () => document.querySelector(".pmap__chips")!.textContent ?? "";
    expect(pool()).not.toMatch(/hulu/i);

    const chip = screen.getByRole("button", { name: /hulu/i }).closest(".pmap__val")!;
    fireEvent.click(within(chip as HTMLElement).getByTitle(/returns to the pool/i));
    expect(pool()).toMatch(/hulu/i);
  });
});

describe("the mapping list", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("counts LIBRARY dimensions only, so a fresh mapping does not claim three", () => {
    // The three auto dimensions are scaffolding every mapping has. Counting them would print
    // "3 dimensions" on a mapping nobody has touched.
    renderPanel({
      factsDaily: FACTS, types: TYPES,
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
    });
    // The reference says it the same way for an empty mapping - a count, not a special sentence.
    expect(document.querySelector(".pmap__ent-counts")!.textContent)
      .toContain("0 dimensions · 0 values");
  });

  it("counts a real library's dimensions and values", () => {
    renderPanel({
      mappings: [{
        id: "mp_1", name: "M", level: "placement",
        dimensions: [
          { id: "dm_auto_month", name: "Month", source: "auto", auto_kind: "month", values: [] },
          { id: "d1", name: "Format", source: "manual", values: [{ value: "CTV" }, { value: "Display" }] },
        ],
      }],
    });
    expect(document.querySelector(".pmap__ent-counts")!.textContent)
      .toContain("1 dimension · 2 values");
  });

  it("does not open a sole mapping by itself", () => {
    // Choosing WHICH mapping you are editing is its own step; skipping it hides that there can be
    // more than one.
    renderPanel({ mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }] });
    expect(screen.queryByText(/All mappings/)).toBeNull();
    expect(document.querySelector(".pmap__ent")).toBeTruthy();
  });

  it("clicking away cancels an armed delete", () => {
    renderPanel({ mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }] });
    fireEvent.click(screen.getByRole("button", { name: /Delete mapping/i }));
    fireEvent.blur(screen.getByText("Delete?"));
    expect(screen.queryByText("Delete?")).toBeNull();
    expect(document.querySelector(".pmap__ent")).toBeTruthy();
  });
});

describe("aliases on an auto dimension", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("an alias can be added WITHOUT giving up the structured field", async () => {
    // The CM360 side of Channel/Tactic has no field to read, so an alias is its only way in. Making
    // that cost a conversion would trade away the delivery side's field authority for it.
    const save = vi.spyOn(api, "savePacingMappings").mockResolvedValue(undefined);
    const ref = createRef<SettingsSectionHandle>();
    renderOpened({
      factsDaily: FACTS, types: TYPES,
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
    }, ref);

    const card = screen.getByDisplayValue("Channel").closest(".pmap__dim")!;
    fireEvent.click(within(card).getByRole("button", { name: /^Display/ }));
    const input = screen.getByPlaceholderText("+ alias");
    fireEvent.change(input, { target: { value: "programmatic display" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await ref.current!.save();

    const [, sent] = save.mock.calls[0];
    const dims = (sent as Record<string, unknown>[])[0].dimensions as Record<string, unknown>[];
    const channel = dims.find((d) => d.id === "dm_auto_channel")!;
    // Still auto - the delivery side keeps reading the field.
    expect(channel.auto_kind).toBe("channel");
    // Only the value that got an alias is materialized; the rest stay derived.
    expect(channel.values).toEqual([{ value: "Display", aliases: ["programmatic display"] }]);
  });

  it("an auto dimension's value still cannot be removed", () => {
    renderOpened({
      factsDaily: FACTS, types: TYPES,
      mappings: [{ id: "mp_1", name: "M", level: "placement", dimensions: [] }],
    });
    const card = screen.getByDisplayValue("Channel").closest(".pmap__dim")!;
    expect(within(card).queryByTitle(/returns to the pool/i)).toBeNull();
  });
});

describe("reset", () => {
  it("drops a mapping created in this session and returns to the list", () => {
    // Leaving the editor open on an entity the reset removed would strand it there with no way
    // back - the list is the only route, and it is hidden while an editor is open.
    const ref = createRef<SettingsSectionHandle>();
    renderPanel({ mappings: null }, ref);

    fireEvent.click(screen.getByRole("button", { name: /Add mapping/i }));
    expect(screen.getByText(/All mappings/)).toBeInTheDocument();

    act(() => ref.current!.reset());
    expect(screen.queryByText(/All mappings/)).toBeNull();
    expect(screen.getByText(/No mapping yet/i)).toBeInTheDocument();
  });
});

describe("what a save sends", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("a mapping nobody added a dimension to still SAVES the three auto ones", async () => {
    // Without them the stored entity has no dimensions, the widget classifies nothing, and the
    // tile says "Nothing classified yet" on a mapping that looked complete on screen.
    const save = vi.spyOn(api, "savePacingMappings").mockResolvedValue(undefined);
    const ref = createRef<SettingsSectionHandle>();
    renderPanel({ mappings: null }, ref);

    fireEvent.click(screen.getByRole("button", { name: /Add mapping/i }));
    await ref.current!.save();

    const [, sent] = save.mock.calls[0];
    const dims = (sent as Record<string, unknown>[])[0].dimensions as Record<string, unknown>[];
    expect(dims.map((d) => d.auto_kind)).toEqual(["channel", "tactic", "month"]);
  });

  it("an editor emptied to nothing CLEARS the list, which is null and not []", async () => {
    // Pacing reads the two as different answers: null means "no mappings here", an empty array
    // means "migrated, nothing mapped". An emptied editor means the first.
    const save = vi.spyOn(api, "savePacingMappings").mockResolvedValue(undefined);
    const ref = createRef<SettingsSectionHandle>();
    // Deliberately NOT opened: delete lives on the card, in the list.
    renderPanel({
      mappings: [{ id: "mp_1", name: "Format", level: "placement", dimensions: [] }],
    }, ref);

    // Two clicks: the first arms the confirm, the second does it. One click dropping a whole
    // library with its aliases and its manual picks is not something a stray cursor should manage.
    fireEvent.click(screen.getByRole("button", { name: /Delete mapping/i }));
    // Scoped to the real button: the card around it is itself role="button", so its accessible
    // name now contains "Delete?" too.
    fireEvent.click(screen.getByText("Delete?"));
    await waitFor(() => expect(ref.current).toBeTruthy());
    const result = await ref.current!.save();

    expect(result.ok).toBe(true);
    expect(save).toHaveBeenCalledWith("nike-ss26", null);
  });

  it("drops a half-typed row rather than storing a blank value", async () => {
    const save = vi.spyOn(api, "savePacingMappings").mockResolvedValue(undefined);
    const ref = createRef<SettingsSectionHandle>();
    renderOpened({
      mappings: [{
        // The mapping and its dimension are named differently on purpose: both render as text
        // inputs, and a shared value would make the selector below ambiguous.
        id: "mp_1", name: "Creative compare", level: "placement",
        dimensions: [{
          id: "d1", name: "Format", source: "manual",
          values: [{ value: "CTV", aliases: ["ott"] }, { value: "", aliases: [] }],
        }],
      }],
    }, ref);

    // Touch something so the section is dirty and the save actually runs.
    fireEvent.change(screen.getByDisplayValue("Creative compare"), { target: { value: "Renamed" } });
    const result = await ref.current!.save();

    expect(result.ok).toBe(true);
    const [, sent] = save.mock.calls[0];
    const dims = (sent as Record<string, unknown>[])[0].dimensions as Record<string, unknown>[];
    expect(dims[0].values).toEqual([{ value: "CTV", aliases: ["ott"] }]);
  });

  it("carries forward the fields this editor does not show, so a save cannot drop them", async () => {
    const save = vi.spyOn(api, "savePacingMappings").mockResolvedValue(undefined);
    const ref = createRef<SettingsSectionHandle>();
    renderOpened({
      mappings: [{
        id: "mp_1", name: "Format", level: "placement", kind: "dimensions",
        // A real override shape: side -> row key -> dimension -> the picked value. The editor now
        // reads and writes these, so this pins that a round-trip keeps someone else's picks.
        cell_overrides: { cm360: { "Hulu CTV": { d1: "CTV" } } },
        updated_by: "someone@aidigital.com",
        dimensions: [],
      }],
    }, ref);

    fireEvent.change(screen.getByDisplayValue("Format"), { target: { value: "Formats" } });
    await ref.current!.save();

    const [, sent] = save.mock.calls[0];
    const entity = (sent as Record<string, unknown>[])[0];
    expect(entity.kind).toBe("dimensions");
    expect(entity.cell_overrides).toEqual({ cm360: { "Hulu CTV": { d1: "CTV" } } });
    expect(entity.updated_by).toBe("someone@aidigital.com");
  });

  it("reports a failed save as a message rather than throwing it at the drawer", async () => {
    vi.spyOn(api, "savePacingMappings").mockRejectedValue(new Error("Pacing refused it"));
    const ref = createRef<SettingsSectionHandle>();
    renderOpened({
      mappings: [{ id: "mp_1", name: "Format", level: "placement", dimensions: [] }],
    }, ref);

    fireEvent.change(screen.getByDisplayValue("Format"), { target: { value: "Formats" } });
    const result = await ref.current!.save();

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("message");
  });
});
