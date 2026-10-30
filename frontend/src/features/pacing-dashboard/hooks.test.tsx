/**
 * `usePacingDashboard` waits for `/api/v1/auth/me` and hands its two Pacing facts to the loader
 * (DASHBOARD-DATA-PASSTHROUGH-PLAN, H2/H3): the journal's `canEdit` is computed in the browser now,
 * from `UserV1.pacingUserId` / `pacingUnrestricted`, so the dashboard must not be asked for before
 * those are known.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingDashboardV1, aUserV1 } from "@/test/factories";
import { getCurrentUser } from "../rbac/api";
import { getPacingDashboard } from "./api";
import { usePacingDashboard } from "./hooks";

vi.mock("../rbac/api", () => ({ getCurrentUser: vi.fn() }));
vi.mock("./api", () => ({
  getPacingDashboard: vi.fn(),
  getPacingRefreshStatus: vi.fn(),
  savePacingCampaignLinks: vi.fn(),
  savePacingDataSettings: vi.fn(),
  savePacingNotifySettings: vi.fn(),
}));

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("usePacingDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPacingDashboard).mockResolvedValue(aPacingDashboardV1());
  });

  it("does not ask for the dashboard until /auth/me has answered", async () => {
    // Given: /auth/me still in flight
    let resolveMe: (user: ReturnType<typeof aUserV1>) => void = () => {};
    vi.mocked(getCurrentUser).mockReturnValue(new Promise((resolve) => { resolveMe = resolve; }));

    // When:
    const { result } = renderHook(() => usePacingDashboard("nike-ss26"), { wrapper: wrapper() });

    // Then: nothing yet - the loader needs the caller's identity first
    await new Promise((r) => setTimeout(r, 20));
    expect(getPacingDashboard).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);

    // When: /auth/me lands
    resolveMe(aUserV1({ pacingUserId: "pu-1", pacingUnrestricted: true }));

    // Then: the dashboard is asked for, with exactly what the Java mapper used to take
    await waitFor(() => expect(getPacingDashboard).toHaveBeenCalledTimes(1));
    expect(getPacingDashboard).toHaveBeenCalledWith("nike-ss26", { ownPacingUserId: "pu-1", unrestricted: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("reads an unsynced person as 'no own id, restricted'", async () => {
    // Given: pacingUserId absent (the §2 sync has not reached them), restricted scope
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ pacingUserId: null, pacingUnrestricted: false }));

    // When:
    renderHook(() => usePacingDashboard("nike-ss26"), { wrapper: wrapper() });

    // Then:
    await waitFor(() => expect(getPacingDashboard).toHaveBeenCalledTimes(1));
    expect(getPacingDashboard).toHaveBeenCalledWith("nike-ss26", { ownPacingUserId: null, unrestricted: false });
  });

  it("still loads, with the most restrictive context, when /auth/me failed", async () => {
    // Given: the shell never renders this page on a failed /auth/me; a test that mounts it without one
    // is the case that reaches here - and it must not stall.
    vi.mocked(getCurrentUser).mockRejectedValue(new Error("down"));

    // When:
    renderHook(() => usePacingDashboard("nike-ss26"), { wrapper: wrapper() });

    // Then:
    await waitFor(() => expect(getPacingDashboard).toHaveBeenCalledTimes(1));
    expect(getPacingDashboard).toHaveBeenCalledWith("nike-ss26", { ownPacingUserId: null, unrestricted: false });
  });

  it("does nothing without a slug", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1());

    const { result } = renderHook(() => usePacingDashboard(undefined), { wrapper: wrapper() });

    await waitFor(() => expect(getCurrentUser).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(getPacingDashboard).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });
});
