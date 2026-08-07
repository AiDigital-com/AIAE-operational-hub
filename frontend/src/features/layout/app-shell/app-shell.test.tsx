import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth, useClerk } from "@clerk/clerk-react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aUserV1 } from "@/test/factories";
import { ApiError } from "../../../shared/api/api-error";
import { ThemeProvider } from "../../../shared/style/theme";
import { ToastProvider } from "../../../shared/ui/toast/toast";
import { searchAgencies } from "../../agencies/api";
import { searchClients } from "../../clients/api";
import { getCurrentUser, listRoles, listScopeTypes, searchUsers } from "../../rbac/api";
import { AppShell } from "./app-shell";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: vi.fn(),
  useClerk: vi.fn(),
  UserButton: () => null,
  SignOutButton: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../../rbac/api", () => ({
  getCurrentUser: vi.fn(),
  searchUsers: vi.fn(),
  listRoles: vi.fn(),
  listScopeTypes: vi.fn(),
  listStatuses: vi.fn(),
  listRoleAssignments: vi.fn(),
  assignRole: vi.fn(),
  revokeRole: vi.fn(),
}));

vi.mock("../../agencies/api", () => ({
  searchAgencies: vi.fn(),
}));

vi.mock("../../clients/api", () => ({
  searchClients: vi.fn(),
}));

function mockAuth(token: string | null) {
  const getToken = vi.fn<() => Promise<string | null>>().mockResolvedValue(token);
  vi.mocked(useAuth).mockReturnValue({
    getToken,
    isLoaded: true,
    isSignedIn: true,
  } as unknown as ReturnType<typeof useAuth>);
}

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/"]}>
            <AppShell />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchUsers).mockResolvedValue({
      content: [],
      pageNumber: 1,
      pageSize: 20,
      totalElements: 0,
      totalPages: 0,
    });
    vi.mocked(listRoles).mockResolvedValue([]);
    vi.mocked(listScopeTypes).mockResolvedValue([]);
    vi.mocked(searchAgencies).mockResolvedValue({
      content: [],
      pageNumber: 1,
      pageSize: 20,
      totalElements: 0,
      totalPages: 0,
    });
    vi.mocked(searchClients).mockResolvedValue({
      content: [],
      pageNumber: 1,
      pageSize: 20,
      totalElements: 0,
      totalPages: 0,
    });
  });

  it("should show the loading state while the auth token resolves", async () => {
    // Given: a signed-in user whose profile has not resolved yet
    mockAuth("jwt-token");
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1());

    // When: the shell renders
    renderShell();

    // Then: the loading panel is shown first
    expect(screen.getByRole("status", { name: "Loading profile" })).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("should show an auth error when Clerk returns no template token", async () => {
    // Given: a signed-in user for whom Clerk yields no token
    mockAuth(null);

    // When: the shell renders
    renderShell();

    // Then: the error panel explains the missing template token and no profile is loaded
    expect(await screen.findByText("Profile cannot be loaded")).toBeInTheDocument();
    expect(screen.getByText(/Clerk did not return JWT template/)).toBeInTheDocument();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("should show an access-denied panel and sign out automatically when the user is not a provisioned employee", async () => {
    // Given: a signed-in identity that the backend rejects with 403 (not a synced employee)
    mockAuth("jwt-token");
    const signOut = vi.fn();
    vi.mocked(useClerk).mockReturnValue({ signOut } as unknown as ReturnType<typeof useClerk>);
    vi.mocked(getCurrentUser).mockRejectedValue(
      new ApiError("User is not a registered employee. Contact your administrator.", 403)
    );

    // When: the shell renders
    renderShell();

    // Then: a calm access-denied panel explains the denial (not the red failure panel), and the
    // identity is signed out automatically instead of being stuck with no way back to sign-in
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.getByText(/not a registered employee/)).toBeInTheDocument();
    expect(screen.getByText("Signing you out…")).toBeInTheDocument();
    expect(screen.queryByText("Profile cannot be loaded")).not.toBeInTheDocument();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("should show Team and Admin nav items for admins", async () => {
    // Given: a signed-in admin user
    mockAuth("jwt-token");
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ roles: ["ADMIN"], hub_user_id: 5 }));

    // When: the shell renders
    renderShell();

    // Then: admin sees Overview link, Team link, Admin button, and the operational overview heading
    expect(await screen.findByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admin" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("should hide Team and Admin nav for non-admins", async () => {
    // Given: a signed-in non-admin user
    mockAuth("jwt-token");
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ roles: ["USER"], hub_user_id: 6 }));

    // When: the shell renders
    renderShell();

    // Then: only the Overview link is in the nav; Team and Admin are hidden
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
  });
});
