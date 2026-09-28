import { describe, expect, it } from "vitest";
import { DEVICE_GROUPS, fold, groupValue, groupsFor } from "./dim-groups";

describe("fold", () => {
  it("removes case, spaces and underscores", () => {
    expect(fold("Connected_Tv")).toBe("connectedtv");
    expect(fold(" Smart Phone ")).toBe("smartphone");
    expect(fold("CTV")).toBe("ctv");
  });

  it("collapses a hyphen only BETWEEN letters, so '-1' survives as its own value", () => {
    // Removing every hyphen would fold a bare '1' onto the dropped '-1' - the first
    // number a new platform reports would inherit a drop rule written for something else.
    expect(fold("Set-Top-Box")).toBe("settopbox");
    expect(fold("-1")).toBe("-1");
    expect(fold("1")).toBe("1");
    expect(fold("-1")).not.toBe(fold("1"));
  });

  it("answers '' for null and undefined", () => {
    expect(fold(null)).toBe("");
    expect(fold(undefined)).toBe("");
  });
});

describe("groupsFor", () => {
  it("answers the built-in device table for device_type and null for anything else", () => {
    expect(groupsFor("device_type")).toBe(DEVICE_GROUPS);
    expect(groupsFor("city")).toBeNull();
    // An inherited Object.prototype name must not answer with a function.
    expect(groupsFor("toString")).toBeNull();
  });
});

describe("groupValue", () => {
  it("merges the four device families across their spellings", () => {
    for (const v of ["Ctv", "Connected Tvs", "Set Top Box", "Games_Console", "connected_device"]) {
      expect(groupValue("device_type", v)).toEqual({ label: "CTV", drop: false });
    }
    expect(groupValue("device_type", "IPHONE")).toEqual({ label: "Mobile", drop: false });
    expect(groupValue("device_type", "personal computer")).toEqual({ label: "Desktop", drop: false });
    expect(groupValue("device_type", "ipad")).toEqual({ label: "Tablet", drop: false });
  });

  it("marks Unknown / -1 / Wap as drop - folded into no-value, never deleted", () => {
    // drop keeps the original label: the caller folds the amount into the no-value
    // bucket, it does not erase the row (the parts must still add up to delivery).
    expect(groupValue("device_type", "Unknown")).toEqual({ label: "Unknown", drop: true });
    expect(groupValue("device_type", "-1")).toEqual({ label: "-1", drop: true });
    expect(groupValue("device_type", "WAP")).toEqual({ label: "WAP", drop: true });
    // A bare '1' must NOT inherit the '-1' drop rule.
    expect(groupValue("device_type", "1")).toEqual({ label: "1", drop: false });
  });

  it("passes an unknown value through unchanged - the table is merges, not an allowlist", () => {
    expect(groupValue("device_type", "Homeassistant")).toEqual({ label: "Homeassistant", drop: false });
    expect(groupValue("city", "Austin")).toEqual({ label: "Austin", drop: false });
  });

  it("answers a blank value as-is with no drop", () => {
    expect(groupValue("device_type", "")).toEqual({ label: "", drop: false });
    expect(groupValue("device_type", null)).toEqual({ label: "", drop: false });
  });

  it("lets a stored per-source dictionary override the built-in table entirely", () => {
    const stored = [{ label: "Streaming", members: ["ctv"] }];
    expect(groupValue("device_type", "Ctv", stored)).toEqual({ label: "Streaming", drop: false });
    // The stored dictionary REPLACES the built-in one - a value the built-in table
    // knows but the stored one does not passes through unchanged.
    expect(groupValue("device_type", "Iphone", stored)).toEqual({ label: "Iphone", drop: false });
  });

  it("falls back to the built-in table when the stored list is empty", () => {
    expect(groupValue("device_type", "Ctv", [])).toEqual({ label: "CTV", drop: false });
  });

  it("honours a stored drop group through the same fold as the members", () => {
    const stored = [{ label: "junk", members: ["None"], drop: true }];
    expect(groupValue("city", "NONE", stored)).toEqual({ label: "NONE", drop: true });
  });

  it("makes a group labelled '__proto__' a real key rather than silently vanishing", () => {
    const stored = [{ label: "__proto__", members: ["Weird"] }];
    expect(groupValue("city", "Weird", stored)).toEqual({ label: "__proto__", drop: false });
    // And the lookup table must not have leaked onto Object.prototype.
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "Weird")).toBe(false);
  });

  it("skips malformed stored entries instead of throwing", () => {
    const stored = [null, { label: "", members: ["x"] }, { label: "Ok", members: "nope" }, { label: "Real", members: ["y"] }];
    expect(groupValue("city", "y", stored)).toEqual({ label: "Real", drop: false });
    expect(groupValue("city", "x", stored)).toEqual({ label: "x", drop: false });
  });
});
