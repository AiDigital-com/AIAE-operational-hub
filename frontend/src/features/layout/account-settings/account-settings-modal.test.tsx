import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../shared/style/theme";
import { ToastProvider } from "../../../shared/ui/toast/toast";
import * as api from "./account-api";
import { AccountSettingsModal } from "./account-settings-modal";
import type { PacingAccountV1 } from "./account-api";

/**
 * Account Settings: Appearance (theme, local) above Daily Summary (delivery preference, saves on
 * selection with no Save button - see the modal's own doc comment) plus, only while Auto is
 * selected, the person's own Slack group id, which gets its own Save action and its own result
 * (success / a Slack-unreachable warning / a specific refusal reason) instead of saving on every
 * keystroke.
 */

vi.mock("./account-api", () => ({
  getAccount: vi.fn(),
  updateAccount: vi.fn(),
}));

function renderModal(
  account: Pick<PacingAccountV1, "notifyDestination"> & Partial<PacingAccountV1> = { notifyDestination: "auto" },
  onClose: () => void = vi.fn()
) {
  vi.mocked(api.getAccount).mockResolvedValue({ slackChannelId: "", ...account });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AccountSettingsModal open onClose={onClose} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe("AccountSettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ThemeProvider persists to localStorage (where available) - cleared so each test starts from
    // its default (dark).
    globalThis.localStorage?.clear();
  });

  it("should seed the control from the stored preference and show its hint", async () => {
    // Given:
    renderModal({ notifyDestination: "dm" });

    // Then: the stored option renders pressed, and its own hint - not the other two stacked
    const dmButton = await screen.findByRole("button", { name: "DM", pressed: true });
    expect(dmButton).toBeInTheDocument();
    expect(screen.getByText("Always sent as a direct message.")).toBeInTheDocument();
    expect(screen.queryByText("The summary is not sent.")).not.toBeInTheDocument();
  });

  it("should save each option immediately, with no separate save step, round-tripping the stored Slack group id", async () => {
    // Given:
    vi.mocked(api.updateAccount).mockResolvedValue({ notifyDestination: "off", slackChannelId: "G-STORED" });
    renderModal({ notifyDestination: "auto", slackChannelId: "G-STORED" });
    await screen.findByRole("button", { name: "Auto", pressed: true });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Off" }));

    // Then: the write carried the exact destination picked, and the group id the SERVER had - not
    // a guess, not dropped - and there is no Save button for this control.
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledWith("off", "G-STORED"));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("should restore the previous selection and report the failure when a write fails", async () => {
    // Given:
    vi.mocked(api.updateAccount).mockRejectedValue(new Error("Pacing refused the value"));
    renderModal({ notifyDestination: "dm" });
    await screen.findByRole("button", { name: "DM", pressed: true });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Off" }));

    // Then: the control lands back on what the server still holds, and the failure is surfaced
    await waitFor(() => expect(screen.getByRole("button", { name: "DM" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByText("Pacing refused the value")).toBeInTheDocument();
  });

  it("should do nothing when the already-active option is picked again", async () => {
    // Given:
    renderModal({ notifyDestination: "auto" });
    await screen.findByRole("button", { name: "Auto", pressed: true });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Auto" }));

    // Then:
    expect(api.updateAccount).not.toHaveBeenCalled();
  });

  it("should switch the theme when a Light/Dark option is picked, and apply it immediately", async () => {
    // Given: no stored preference, so the provider's default (dark) renders pressed
    renderModal();
    expect(await screen.findByRole("button", { name: "Dark", pressed: true })).toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    // Then: the control flips, and the theme actually applies (not just a local checkbox)
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    // When: switching back
    await userEvent.click(screen.getByRole("button", { name: "Dark" }));

    // Then:
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  describe("Slack group id (only while Auto is selected)", () => {
    it("should show the field for Auto and hide it for DM/Off", async () => {
      // Given / Then:
      renderModal({ notifyDestination: "dm" });
      await screen.findByRole("button", { name: "DM", pressed: true });
      expect(screen.queryByLabelText("Your Slack group")).not.toBeInTheDocument();
    });

    it("should show the field, seeded from the stored value, once Auto is the active destination", async () => {
      // Given:
      renderModal({ notifyDestination: "auto", slackChannelId: "G-EXISTING" });

      // Then:
      const input = await screen.findByLabelText("Your Slack group");
      expect(input).toHaveValue("G-EXISTING");
      // Nothing changed yet, so there is nothing to save.
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("should save a new group id and show a plain success result", async () => {
      // Given:
      vi.mocked(api.updateAccount).mockResolvedValue({ notifyDestination: "auto", slackChannelId: "G-NEW" });
      renderModal({ notifyDestination: "auto", slackChannelId: "" });
      const input = await screen.findByLabelText("Your Slack group");

      // When:
      await userEvent.type(input, "G-NEW");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      // Then:
      await waitFor(() => expect(api.updateAccount).toHaveBeenCalledWith("auto", "G-NEW"));
      expect(await screen.findByText("Saved.")).toBeInTheDocument();
    });

    it("should clear the field back to empty and say so", async () => {
      // Given:
      vi.mocked(api.updateAccount).mockResolvedValue({ notifyDestination: "auto", slackChannelId: "" });
      renderModal({ notifyDestination: "auto", slackChannelId: "G-OLD" });
      const input = await screen.findByLabelText("Your Slack group");

      // When:
      await userEvent.clear(input);
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      // Then:
      await waitFor(() => expect(api.updateAccount).toHaveBeenCalledWith("auto", ""));
      expect(await screen.findByText(/Cleared/)).toBeInTheDocument();
    });

    it("should surface a Slack-unreachable warning as a warning, not a failure, and keep the saved value", async () => {
      // Given:
      vi.mocked(api.updateAccount).mockResolvedValue({
        notifyDestination: "auto",
        slackChannelId: "G-NEW",
        slackWarning: "Slack couldn't be reached to check this just now, so it was saved without verifying.",
      });
      renderModal({ notifyDestination: "auto", slackChannelId: "" });
      const input = await screen.findByLabelText("Your Slack group");

      // When:
      await userEvent.type(input, "G-NEW");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      // Then: the warning text itself is shown, and the field still reflects the saved value.
      expect(await screen.findByText(/Slack couldn't be reached to check this just now/)).toBeInTheDocument();
      expect(input).toHaveValue("G-NEW");
    });

    it("should show the specific refusal reason inline and leave the typed value in place to fix", async () => {
      // Given: e.g. dash-gate's not_member refusal.
      vi.mocked(api.updateAccount).mockRejectedValue(new Error("You aren't a member of that group yet. Join it, then save again."));
      renderModal({ notifyDestination: "auto", slackChannelId: "" });
      const input = await screen.findByLabelText("Your Slack group");

      // When:
      await userEvent.type(input, "G-NOT-MINE");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      // Then: the exact reason is shown, and the value is left as typed so it can be corrected.
      expect(await screen.findByText("You aren't a member of that group yet. Join it, then save again.")).toBeInTheDocument();
      expect(input).toHaveValue("G-NOT-MINE");
    });

    it("should keep Save disabled until the value actually changes", async () => {
      // Given:
      renderModal({ notifyDestination: "auto", slackChannelId: "G-SAME" });
      const input = await screen.findByLabelText("Your Slack group");
      const saveButton = screen.getByRole("button", { name: "Save" });
      expect(saveButton).toBeDisabled();

      // When: typing the exact same value back
      await userEvent.clear(input);
      await userEvent.type(input, "G-SAME");

      // Then:
      expect(saveButton).toBeDisabled();
      expect(api.updateAccount).not.toHaveBeenCalled();
    });
  });
});
