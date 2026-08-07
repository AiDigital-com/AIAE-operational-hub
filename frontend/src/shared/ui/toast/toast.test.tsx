import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
});
