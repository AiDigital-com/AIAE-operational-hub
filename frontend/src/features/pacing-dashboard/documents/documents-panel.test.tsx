import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { PacingDocumentsSection } from "./documents-panel";
import type { SettingsSectionHandle } from "../settings-section";
import type { PacingCampaignLinkV1 } from "../types";

vi.mock("../api", () => ({
  savePacingCampaignLinks: vi.fn(),
}));

/**
 * The documents section with a Save of its own - the real Save belongs to the settings drawer and
 * is tested there; here it is a plain trigger, so these cases stay about what the section sends
 * and what it refuses.
 */
function renderPanel(links: PacingCampaignLinkV1[] | undefined, orderNumber?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const saved = vi.fn();
  function Harness() {
    const ref = useRef<SettingsSectionHandle>(null);
    const [message, setMessage] = useState<string | null>(null);
    return (
      <>
        <PacingDocumentsSection
          ref={ref}
          slug="nike-ss26"
          links={links}
          orderNumber={orderNumber}
          seedKey={1}
          onDirtyChange={() => {}}
        />
        {message && <p data-testid="save-message">{message}</p>}
        <button
          type="button"
          onClick={async () => {
            const result = await ref.current?.save();
            if (result?.ok) saved();
            else if (result) setMessage(result.message);
          }}
        >
          Save
        </button>
        <button type="button" onClick={() => ref.current?.reset()}>
          Reset draft
        </button>
      </>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  );
  return { saved };
}

describe("PacingDocumentsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.savePacingCampaignLinks).mockResolvedValue(undefined);
  });

  it("should show the stored preset URLs in their labelled slots and the rest under Custom links", () => {
    // Given: two presets and a DSP console, stored in arbitrary order
    renderPanel([
      { name: "DV360", url: "https://displayvideo.google.com/p/1" },
      { name: "Asana", url: "https://app.asana.com/0/1/2" },
      { name: "Slack", url: "https://aidigital.slack.com/archives/C1" },
    ]);

    // Then: each preset input carries its own URL, untouched slots are empty, and the DSP link
    // is a custom row
    expect(screen.getByRole("textbox", { name: "Asana URL" })).toHaveValue("https://app.asana.com/0/1/2");
    expect(screen.getByRole("textbox", { name: "Slack URL" })).toHaveValue("https://aidigital.slack.com/archives/C1");
    expect(screen.getByRole("textbox", { name: "IO URL" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Media Plan URL" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Custom link 1 name" })).toHaveValue("DV360");
    expect(screen.getByRole("textbox", { name: "Custom link 1 URL" })).toHaveValue(
      "https://displayvideo.google.com/p/1"
    );
  });

  it("should show the IO number read-only when the pacing has one", () => {
    // Given:
    renderPanel([], "SO-12345");

    // Then: a value, not a field - it is synced from NetSuite, never edited here
    expect(screen.getByText("SO-12345")).toBeInTheDocument();
    expect(screen.getByText("Synced from NetSuite")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /IO number/ })).not.toBeInTheDocument();
  });

  it("should save the whole array, preserving stored order when editing by index (US-140)", async () => {
    // Given: a custom link stored BEFORE a preset - the reference editor patches by index and
    // keeps the stored order; its older sibling rebuilt the array and lost it
    renderPanel([
      { name: "DV360", url: "https://displayvideo.google.com/p/1" },
      { name: "Asana", url: "https://app.asana.com/0/1/2" },
    ]);

    // When: the Asana URL is edited in place and a new preset is filled
    const asana = screen.getByRole("textbox", { name: "Asana URL" });
    await userEvent.clear(asana);
    await userEvent.type(asana, "https://app.asana.com/0/9/9");
    await userEvent.type(screen.getByRole("textbox", { name: "IO URL" }), "https://drive.google.com/io");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: one request, the whole list, original order first, the appended slot last
    expect(api.savePacingCampaignLinks).toHaveBeenCalledTimes(1);
    expect(api.savePacingCampaignLinks).toHaveBeenCalledWith("nike-ss26", [
      { name: "DV360", url: "https://displayvideo.google.com/p/1" },
      { name: "Asana", url: "https://app.asana.com/0/9/9" },
      { name: "IO", url: "https://drive.google.com/io" },
    ]);
  });

  it("should drop a cleared preset and an abandoned empty custom row on save (US-140)", async () => {
    // Given: one stored preset and one stored custom link
    renderPanel([
      { name: "Asana", url: "https://app.asana.com/0/1/2" },
      { name: "Old doc", url: "https://example.com/old" },
    ]);

    // When: the preset is cleared with its × button, an empty custom row is added and left
    // untouched, and the custom link is removed
    await userEvent.click(screen.getByRole("button", { name: "Clear Asana URL" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Add link" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove custom link 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: deleting the last links is a legitimate save - the whole-array replace travels as []
    expect(api.savePacingCampaignLinks).toHaveBeenCalledWith("nike-ss26", []);
  });

  it("should refuse a non-http URL with the offending link named, and send nothing", async () => {
    // Given:
    renderPanel([]);

    // When: a javascript: URL is pasted into a custom row
    await userEvent.click(screen.getByRole("button", { name: "+ Add link" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Custom link 1 name" }), "Console");
    await userEvent.type(screen.getByRole("textbox", { name: "Custom link 1 URL" }), "javascript:alert(1)");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: the request never leaves, the message names the link, and the row is marked invalid
    expect(api.savePacingCampaignLinks).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "'Console': the URL must be a full http:// or https:// address."
    );
    expect(screen.getByRole("textbox", { name: "Custom link 1 URL" })).toHaveAttribute("aria-invalid", "true");
  });

  it("should refuse an Asana slot that does not look like an Asana project link (US-141)", async () => {
    // Given:
    renderPanel([]);

    // When: a non-Asana URL is pasted into the Asana preset
    await userEvent.type(screen.getByRole("textbox", { name: "Asana URL" }), "https://example.com/tasks");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then:
    expect(api.savePacingCampaignLinks).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Asana link must point at an Asana project (an app.asana.com URL)."
    );
  });

  it("should accept a real Asana project link in the Asana slot (US-141)", async () => {
    // Given:
    const { saved } = renderPanel([]);

    // When:
    await userEvent.type(
      screen.getByRole("textbox", { name: "Asana URL" }),
      "https://app.asana.com/0/1201234567890/list"
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then:
    expect(api.savePacingCampaignLinks).toHaveBeenCalledWith("nike-ss26", [
      { name: "Asana", url: "https://app.asana.com/0/1201234567890/list" },
    ]);
    expect(saved).toHaveBeenCalled();
  });

  it("should save nothing at all when the section is not dirty", async () => {
    // Given: untouched
    renderPanel([{ name: "Asana", url: "https://app.asana.com/0/1/2" }]);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: an untouched section writes nothing - the drawer's contract for every section
    expect(api.savePacingCampaignLinks).not.toHaveBeenCalled();
  });

  it("should drop the draft back to the stored links on reset", async () => {
    // Given: an edit in place
    renderPanel([{ name: "Asana", url: "https://app.asana.com/0/1/2" }]);
    const asana = screen.getByRole("textbox", { name: "Asana URL" });
    await userEvent.clear(asana);
    await userEvent.type(asana, "https://app.asana.com/0/9/9");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Reset draft" }));

    // Then:
    expect(screen.getByRole("textbox", { name: "Asana URL" })).toHaveValue("https://app.asana.com/0/1/2");
  });
});
