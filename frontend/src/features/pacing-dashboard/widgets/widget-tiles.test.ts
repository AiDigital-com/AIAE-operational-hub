import { describe, expect, it } from "vitest";
import {
  TITLE_CAP,
  copyWidget,
  hasSwitch,
  newGroupId,
  newWidgetId,
  setTileEnabled,
  tileEnabled,
  widgetTitle,
  withWidgetRemoved,
} from "./widget-tiles";
import type { PacingWidgetGroup, PacingWidgetInstance } from "../types";

describe("tileEnabled", () => {
  it("should read an absent map as every tile on, so a pacing nobody has switched shows everything", () => {
    expect(tileEnabled(undefined, "w_abc123")).toBe(true);
    expect(tileEnabled({}, "w_abc123")).toBe(true);
    expect(tileEnabled({ enabled: {} }, "w_abc123")).toBe(true);
  });

  it("should hide a tile only on an explicit false", () => {
    expect(tileEnabled({ enabled: { w_abc123: false } }, "w_abc123")).toBe(false);
    // An entry for a DIFFERENT tile says nothing about this one.
    expect(tileEnabled({ enabled: { w_other0: false } }, "w_abc123")).toBe(true);
  });

  it("should not let an inherited object key answer for a real tile", () => {
    // `{}.constructor` is truthy and not `false`, so a reader that forgets own-key checking says
    // "on" for the wrong reason - and would say "off" for a tile called `constructor` the moment
    // the rule changed. The vendored module checks own keys; this pins that it still does.
    expect(tileEnabled({ enabled: {} }, "constructor")).toBe(true);
  });
});

describe("hasSwitch", () => {
  it("should offer a switch to widget instances and to functional blocks", () => {
    expect(hasSwitch("w_abc123")).toBe(true);
    expect(hasSwitch("journal")).toBe(true);
  });

  it("should refuse an id dash-gate's enabled{} may not carry", () => {
    // A group is arrangement state with no switch, and an invented id is a caller bug. Offering a
    // control for either would promise a save the server refuses.
    expect(hasSwitch("g_abc123")).toBe(false);
    expect(hasSwitch("not-a-tile")).toBe(false);
  });
});

describe("setTileEnabled", () => {
  it("should store false when turning a tile off", () => {
    expect(setTileEnabled({}, "w_abc123", false)).toEqual({ w_abc123: false });
  });

  it("should DELETE the entry when turning a tile on, never store true", () => {
    // Absent ≡ on, so a default-on tile must not accumulate a redundant `true`: the stored map is
    // meant to be the size of what someone actually switched off.
    expect(setTileEnabled({ w_abc123: false }, "w_abc123", true)).toEqual({});
  });

  it("should leave every other entry alone", () => {
    const before = { w_aaa111: false, w_bbb222: false };
    expect(setTileEnabled(before, "w_aaa111", true)).toEqual({ w_bbb222: false });
    // and not mutate the input - the caller's draft is React state
    expect(before).toEqual({ w_aaa111: false, w_bbb222: false });
  });

  it("should throw rather than pretend to save a switch for an id outside the domain", () => {
    expect(() => setTileEnabled({}, "g_abc123", false)).toThrow(/g_abc123/);
  });
});

describe("copyWidget", () => {
  const linked: PacingWidgetInstance = {
    id: "w_src000",
    kind: "composite",
    title: "Delivery",
    schemaVersion: 2,
    lib: { src: "user", key: "entry-1" },
    from: { src: "user", key: "entry-1" },
    spec: { views: [{ kind: "kpi" }] },
  };

  it("should mint an id no tile on this pacing is using", () => {
    const copy = copyWidget(linked, ["w_src000"]);
    expect(copy.id).not.toBe("w_src000");
    expect(copy.id).toMatch(/^w_[a-z0-9]{4,16}$/);
  });

  it("should drop the library link and the provenance, because a copy is a private widget", () => {
    // Keeping `lib` would make a SECOND linked tile: editing it would surprise the entry's author,
    // and this pacing would count the same entry's usage twice.
    const copy = copyWidget(linked, []);
    expect(copy.lib).toBeUndefined();
    expect(copy.from).toBeUndefined();
  });

  it("should name the copy after the original and clip to the server's title cap", () => {
    expect(copyWidget(linked, []).title).toBe("Delivery (copy)");
    const long = copyWidget({ ...linked, title: "x".repeat(100) }, []);
    expect(long.title).toHaveLength(TITLE_CAP);
  });

  it("should not mint 'undefined (copy)' for a widget carrying no title of its own", () => {
    const copy = copyWidget({ id: "w_src000" }, []);
    expect(copy.title).toBe(`${widgetTitle({})} (copy)`);
  });

  it("should deep-copy the spec, so editing the copy cannot reach back into the original", () => {
    const copy = copyWidget(linked, []);
    expect(copy.spec).toEqual(linked.spec);
    expect(copy.spec).not.toBe(linked.spec);
  });
});

describe("newWidgetId / newGroupId", () => {
  it("should never hand back an id already in use", () => {
    // A collision would silently merge two tiles into one, which is why it is checked rather than
    // assumed. Exhausting the alphabet is not practical, so this pins the loop by starving it of
    // every id it is told about and checking it still escapes.
    const used = new Set<string>();
    for (let i = 0; i < 200; i++) used.add(newWidgetId(used));
    expect(used.size).toBe(200);
    expect([...used].every((id) => /^w_[a-z0-9]{4,16}$/.test(id))).toBe(true);
  });

  it("should mint group ids in Pacing's own shape", () => {
    expect(newGroupId()).toMatch(/^g_[a-z0-9]{4,16}$/);
  });
});

describe("withWidgetRemoved", () => {
  const widgets: PacingWidgetInstance[] = [{ id: "w_aaa111" }, { id: "w_bbb222" }];

  it("should drop the widget, its on/off entry, and its group membership", () => {
    const groups: PacingWidgetGroup[] = [{ id: "g_one000", tileIds: ["w_aaa111", "w_bbb222"], bg: "slate" }];
    const next = withWidgetRemoved(widgets, groups, { w_aaa111: false, w_bbb222: false }, "w_aaa111");

    expect(next.widgets.map((w) => w.id)).toEqual(["w_bbb222"]);
    expect(next.enabled).toEqual({ w_bbb222: false });
    expect(next.groups).toEqual([{ id: "g_one000", tileIds: ["w_bbb222"], bg: "slate" }]);
  });

  it("should dissolve a group whose last member went", () => {
    const groups: PacingWidgetGroup[] = [{ id: "g_one000", tileIds: ["w_aaa111"], bg: "slate" }];
    expect(withWidgetRemoved(widgets, groups, {}, "w_aaa111").groups).toEqual([]);
  });
});
