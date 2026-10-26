import { describe, expect, it } from "vitest";
import { aPacingLibraryEntryV1 } from "@/test/factories";
import { creationLayoutOptions } from "./layout-options";

describe("creationLayoutOptions", () => {
  it("merges own/private and shared Layouts once, sorts, and disambiguates names", () => {
    // Given: the reference's own fixture (tests/creation-layout-test.mjs), on this app's rows
    const video = aPacingLibraryEntryV1({ id: "c", kind: "layout", name: "Video", ownerName: "Chao", mine: false });
    const shared = [
      video,
      aPacingLibraryEntryV1({ id: "a", kind: "layout", name: "Display", ownerName: "Ada", mine: false }),
      aPacingLibraryEntryV1({ id: "x", kind: "widget", name: "A widget" }),
    ];
    const mine = [
      video,
      aPacingLibraryEntryV1({ id: "b", kind: "layout", name: "Display", ownerName: "Bea", visibility: "private" }),
    ];

    // When-Then:
    expect(creationLayoutOptions(shared, mine)).toEqual([
      { id: "a", label: "Display · Ada" },
      { id: "b", label: "Display · Bea" },
      { id: "c", label: "Video" },
    ]);
    expect(creationLayoutOptions(undefined, undefined)).toEqual([]);
  });
});
