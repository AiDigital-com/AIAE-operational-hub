import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function Harness() {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.showError("boom failed")}>fail</button>
      <button type="button" onClick={() => toast.showSuccess("saved ok")}>ok</button>
    </div>
  );
}

describe("ToastProvider", () => {
  it("should show an error toast when showError is called", async () => {
    // Given: a component inside the provider
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    );

    // When: an error toast is requested
    await user.click(screen.getByRole("button", { name: "fail" }));

    // Then: an alert with the message is shown
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom failed");
  });

  it("should dismiss a toast when its close button is clicked", async () => {
    // Given: a shown success toast
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "ok" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("saved ok");

    // When: the toast is dismissed
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    // Then: the toast is gone
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("should keep an error until it is dismissed by hand", async () => {
    // Given: fake timers, so a long wait can pass without waiting it out
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <Harness />
        </ToastProvider>
      );

      // When: an error is raised and five minutes pass
      // fireEvent rather than userEvent: the latter waits on real timers of its own, which a fake clock
      // never advances, so the click never resolves.
      fireEvent.click(screen.getByRole("button", { name: "fail" }));
      await act(async () => {
        vi.advanceTimersByTime(300_000);
      });

      // Then: it is still there. An error can arrive while another window is in front, and a failure that
      // has already gone is one nobody can act on or report.
      expect(screen.getByRole("alert")).toHaveTextContent("boom failed");

      // When: it is closed
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      // Then: only then does it go
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("should clear a confirmation on its own", async () => {
    // Given:
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <Harness />
        </ToastProvider>
      );

      // When: a success is shown and its six seconds pass
      fireEvent.click(screen.getByRole("button", { name: "ok" }));
      expect(screen.getByRole("alert")).toHaveTextContent("saved ok");
      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      // Then: it leaves without being asked - a confirmation is worth nothing once the thing it confirms is
      // on screen, and dismissing one after every routine save would be its own chore
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("should not stack a second copy of an error already on screen", async () => {
    // Given: a failing action that has been retried
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <Harness />
        </ToastProvider>
      );

      // When: the same failure is raised three times
      fireEvent.click(screen.getByRole("button", { name: "fail" }));
      fireEvent.click(screen.getByRole("button", { name: "fail" }));
      fireEvent.click(screen.getByRole("button", { name: "fail" }));

      // Then: one notice, not three. Errors no longer leave on their own, so repeating them would bury the
      // surface the user is trying to fix.
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
