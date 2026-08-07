import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aHubUserSummaryV1, aRoleAssignmentV1, aRoleV1, aUserV1 } from "@/test/factories";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { assignRole, getCurrentUser, listRoleAssignments, listRoles, revokeRole, searchUsers } from "../rbac/api";
import type { HubUserPageResponseV1, HubUserSummaryV1 } from "../rbac/types";
import { createTeam, listTeams, searchTeams, syncNetSuite, updateTeam } from "../teams/api";
import type { TeamPageResponseV1, TeamV1 } from "../teams/types";
import { TeamManagement } from "./team-management";

const CURRENT_ADMIN_ID = 999;

vi.mock("@clerk/clerk-react", () => ({
  UserButton: () => null,
  SignOutButton: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../rbac/api", () => ({
  searchUsers: vi.fn(),
  listRoles: vi.fn(),
  listRoleAssignments: vi.fn(),
  revokeRole: vi.fn(),
  assignRole: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("../teams/api", () => ({
  listTeams: vi.fn(),
  searchTeams: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  syncNetSuite: vi.fn(),
}));

function aUserPage(content: HubUserSummaryV1[]): HubUserPageResponseV1 {
  return { content, pageNumber: 1, pageSize: 20, totalElements: content.length, totalPages: 1 };
}

function aTeam(overrides: Partial<TeamV1> = {}): TeamV1 {
  return { id: 1, team_name: "Growth", pod_key: "growth-pod", status: "ACTIVE", fromNetSuite: false, ...overrides };
}

function aTeamPage(content: TeamV1[]): TeamPageResponseV1 {
  return { content, pageNumber: 1, pageSize: 20, totalElements: content.length, totalPages: 1 };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TeamManagement />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("TeamManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRoles).mockResolvedValue([
      aRoleV1({ id: 1, role_code: "MPO_MANAGER", display_name: "MPO Manager", future: false }),
      aRoleV1({ id: 2, role_code: "TL", display_name: "MPO Team Lead", future: false }),
      aRoleV1({ id: 3, role_code: "DIRECTOR", display_name: "MPO Director", future: false }),
      aRoleV1({ id: 4, role_code: "ADMIN", display_name: "Administrator", future: false }),
      aRoleV1({ id: 5, role_code: "CLIENT_SERVICES", display_name: "Client Services", future: true }),
    ]);
    vi.mocked(listRoleAssignments).mockResolvedValue([]);
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ hub_user_id: CURRENT_ADMIN_ID, roles: ["ADMIN"] }));
    vi.mocked(searchUsers).mockResolvedValue(aUserPage([
      aHubUserSummaryV1({ hub_user_id: 1, full_name: "Ada Lovelace", email: "ada@x.io", role_code: "ADMIN" }),
      aHubUserSummaryV1({ hub_user_id: 2, full_name: "Alan Turing", email: "alan@x.io", role_code: undefined }),
    ]));
    vi.mocked(listTeams).mockResolvedValue([aTeam({ id: 7, team_name: "Growth" })]);
    vi.mocked(searchTeams).mockResolvedValue(aTeamPage([aTeam({ id: 7, team_name: "Growth" })]));
  });

  it("should show the Users tab with both tab counts by default", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Users Management" })).toBeInTheDocument();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(await screen.findByRole("tab", { name: /Users/ })).getByText("2")).toBeInTheDocument();
    expect(within(await screen.findByRole("tab", { name: /Teams/ })).getByText("1")).toBeInTheDocument();
  });

  it("should not offer a way to create users", async () => {
    renderPage();
    await screen.findByText("Ada Lovelace");

    expect(screen.queryByRole("button", { name: /create/i })).not.toBeInTheDocument();
  });

  it("should filter users by name through the Filters popover", async () => {
    renderPage();
    await screen.findByText("Ada Lovelace");

    // Search lives behind the single Filters control
    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    await userEvent.type(screen.getByLabelText("Search users by name"), "ada");

    await waitFor(() => {
      expect(searchUsers).toHaveBeenCalledWith(
        1,
        20,
        expect.objectContaining({
          filters: [{ field: "FULL_NAME", value: "ada", operation: "CONTAINS", caseSensitive: false }],
        })
      );
    });
  });

  it("should assign a role scoped to the chosen team", async () => {
    vi.mocked(assignRole).mockResolvedValue({} as never);

    renderPage();
    await screen.findByText("Alan Turing");

    const roleSelect = screen.getByLabelText("Role for Alan Turing");
    await userEvent.selectOptions(roleSelect, "MPO_MANAGER");
    await userEvent.click(screen.getByLabelText("Team for Alan Turing"));
    await userEvent.click(screen.getByRole("button", { name: "Growth" }));
    const row = roleSelect.closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Assign role" }));

    await waitFor(() => {
      expect(assignRole).toHaveBeenCalledWith(2, { role_code: "MPO_MANAGER", scope_code: "TEAM", scope_id: 7 });
    });
  });

  it("should not refetch the admin's own profile after editing another user's role", async () => {
    vi.mocked(assignRole).mockResolvedValue({} as never);

    renderPage();
    await screen.findByText("Alan Turing");
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(1));
    vi.mocked(getCurrentUser).mockClear();

    const roleSelect = screen.getByLabelText("Role for Alan Turing");
    await userEvent.selectOptions(roleSelect, "MPO_MANAGER");
    await userEvent.click(screen.getByLabelText("Team for Alan Turing"));
    await userEvent.click(screen.getByRole("button", { name: "Growth" }));
    const row = roleSelect.closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Assign role" }));

    await waitFor(() => expect(assignRole).toHaveBeenCalled());
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("should refetch the admin's own profile after editing their own role", async () => {
    vi.mocked(assignRole).mockResolvedValue({} as never);
    vi.mocked(searchUsers).mockResolvedValue(aUserPage([
      aHubUserSummaryV1({ hub_user_id: CURRENT_ADMIN_ID, full_name: "Current Admin", email: "admin@x.io", role_code: undefined }),
    ]));

    renderPage();
    await screen.findByText("Current Admin");
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(1));
    vi.mocked(getCurrentUser).mockClear();

    const roleSelect = screen.getByLabelText("Role for Current Admin");
    await userEvent.selectOptions(roleSelect, "ADMIN");
    const row = roleSelect.closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Assign role" }));

    await waitFor(() => expect(assignRole).toHaveBeenCalled());
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(1));
  });

  it("should offer roles by name without codes, including admin and No role", async () => {
    renderPage();
    await screen.findByText("Alan Turing");

    const roleSelect = screen.getByLabelText("Role for Alan Turing");
    expect(within(roleSelect).getByRole("option", { name: "MPO Manager" })).toBeInTheDocument();
    expect(within(roleSelect).getByRole("option", { name: "MPO Team Lead" })).toBeInTheDocument();
    expect(within(roleSelect).getByRole("option", { name: "MPO Director" })).toBeInTheDocument();
    expect(within(roleSelect).getByRole("option", { name: "Administrator" })).toBeInTheDocument();
    expect(within(roleSelect).getByRole("option", { name: "No role" })).toBeInTheDocument();
    // Future roles and raw codes are not shown
    expect(within(roleSelect).queryByRole("option", { name: "Client Services" })).not.toBeInTheDocument();
    expect(within(roleSelect).queryByRole("option", { name: /MPO_MANAGER/ })).not.toBeInTheDocument();
  });

  it("should assign an admin role with the ALL scope and no team", async () => {
    vi.mocked(assignRole).mockResolvedValue({} as never);

    renderPage();
    await screen.findByText("Alan Turing");

    const roleSelect = screen.getByLabelText("Role for Alan Turing");
    await userEvent.selectOptions(roleSelect, "ADMIN");
    expect(screen.getByLabelText("Team for Alan Turing")).toBeDisabled();
    const row = roleSelect.closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Assign role" }));

    await waitFor(() => {
      expect(assignRole).toHaveBeenCalledWith(2, { role_code: "ADMIN", scope_code: "ALL" });
    });
  });

  it("should revoke a user's role by choosing No role and applying", async () => {
    vi.mocked(listRoleAssignments).mockResolvedValue([
      aRoleAssignmentV1({ id: 99, user_id: 1, role_code: "ADMIN", status: "ACTIVE" }),
    ]);
    vi.mocked(revokeRole).mockResolvedValue(undefined as never);

    renderPage();
    await screen.findByText("Ada Lovelace");

    const roleSelect = screen.getByLabelText("Role for Ada Lovelace");
    await userEvent.selectOptions(roleSelect, ""); // No role
    const row = roleSelect.closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Assign role" }));

    await waitFor(() => {
      expect(revokeRole).toHaveBeenCalledWith(1, 99);
    });
  });

  it("should expose deactivate and delete in the user actions menu", async () => {
    renderPage();
    await screen.findByText("Alan Turing");

    await userEvent.click(screen.getByRole("button", { name: "Actions for Alan Turing" }));
    expect(screen.getByRole("menuitem", { name: "Deactivate User" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete User" }));

    expect(await screen.findByText(/out of scope for this phase/i)).toBeInTheDocument();
  });

  it("should disable Revoke Role in the actions menu for a user with no active role", async () => {
    renderPage();
    await screen.findByText("Alan Turing");

    await userEvent.click(screen.getByRole("button", { name: "Actions for Alan Turing" }));

    expect(screen.getByRole("menuitem", { name: "Revoke Role" })).toBeDisabled();
  });

  it("should revoke a user's role directly from the actions menu", async () => {
    vi.mocked(listRoleAssignments).mockResolvedValue([
      aRoleAssignmentV1({ id: 99, user_id: 1, role_code: "ADMIN", status: "ACTIVE" }),
    ]);
    vi.mocked(revokeRole).mockResolvedValue(undefined as never);

    renderPage();
    await screen.findByText("Ada Lovelace");

    await userEvent.click(screen.getByRole("button", { name: "Actions for Ada Lovelace" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Revoke Role" }));

    await waitFor(() => {
      expect(revokeRole).toHaveBeenCalledWith(1, 99);
    });
  });

  it("should let you search teams inside the assignment dropdown", async () => {
    vi.mocked(listTeams).mockResolvedValue([
      aTeam({ id: 7, team_name: "Growth" }),
      aTeam({ id: 8, team_name: "Data" }),
    ]);

    renderPage();
    await screen.findByText("Alan Turing");
    await userEvent.click(screen.getByLabelText("Team for Alan Turing"));

    // Both teams listed, then narrowed by the in-dropdown search
    expect(screen.getByRole("button", { name: "Data" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search teams"), "grow");
    expect(screen.getByRole("button", { name: "Growth" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Data" })).not.toBeInTheDocument();
  });

  it("should create a team (defaulting to active) from the Teams tab", async () => {
    vi.mocked(searchTeams).mockResolvedValue(aTeamPage([]));
    vi.mocked(createTeam).mockResolvedValue(aTeam({ id: 2, team_name: "Data" }));

    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: /Teams/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Create New" }));
    await userEvent.type(screen.getByLabelText("Team name"), "Data");
    await userEvent.type(screen.getByLabelText("Pod key"), "data-pod");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createTeam).toHaveBeenCalledWith(
        { team_name: "Data", pod_key: "data-pod", status: "ACTIVE" },
        expect.anything()
      );
    });
  });

  it("should filter the teams list by name server-side through the Filters control", async () => {
    vi.mocked(searchTeams).mockResolvedValue(aTeamPage([aTeam({ id: 7, team_name: "Growth" })]));

    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: /Teams/ }));
    expect(await screen.findByText("Growth")).toBeInTheDocument();

    // Same Filters control as the Users tab; the name is pushed to the server-side search
    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    await userEvent.type(screen.getByLabelText("Search teams by name"), "grow");

    await waitFor(() => {
      expect(searchTeams).toHaveBeenCalledWith(1, 20, { name: "grow" });
    });
  });

  it("should not offer inactive teams when assigning a role", async () => {
    vi.mocked(listTeams).mockResolvedValue([
      aTeam({ id: 7, team_name: "Growth", status: "ACTIVE" }),
      aTeam({ id: 8, team_name: "Archived", status: "INACTIVE" }),
    ]);

    renderPage();
    await screen.findByText("Alan Turing");
    await userEvent.click(screen.getByLabelText("Team for Alan Turing"));

    expect(screen.getByRole("button", { name: "Growth" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archived" })).not.toBeInTheDocument();
  });

  it("should render NetSuite teams as read-only (badge, no actions menu)", async () => {
    vi.mocked(searchTeams).mockResolvedValue(aTeamPage([
      aTeam({ id: 7, team_name: "Growth", fromNetSuite: false }),
      aTeam({ id: 8, team_name: "MPO Pod", fromNetSuite: true }),
    ]));

    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: /Teams/ }));
    expect(await screen.findByText("MPO Pod")).toBeInTheDocument();

    // NetSuite team is badged and has no actions menu
    expect(screen.getByText("NetSuite")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for MPO Pod" })).not.toBeInTheDocument();
    // Manual team keeps its actions menu
    expect(screen.getByRole("button", { name: "Actions for Growth" })).toBeInTheDocument();
  });

  it("should deactivate a team from its actions menu", async () => {
    vi.mocked(updateTeam).mockResolvedValue(aTeam({ id: 7, status: "INACTIVE" }));

    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: /Teams/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Growth" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Deactivate" }));

    await waitFor(() => {
      expect(updateTeam).toHaveBeenCalledWith(7, { team_name: "Growth", pod_key: "growth-pod", status: "INACTIVE" });
    });
  });

  it("should issue exactly one users request, for page 1, when the search changes while on a later page", async () => {
    // Given: two pages of users
    vi.mocked(searchUsers).mockResolvedValue({
      content: [aHubUserSummaryV1({ hub_user_id: 1, full_name: "Ada Lovelace", email: "ada@x.io" })],
      pageNumber: 1,
      pageSize: 20,
      totalElements: 40,
      totalPages: 2,
    });

    renderPage();
    await screen.findByText("Ada Lovelace");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(searchUsers).toHaveBeenLastCalledWith(2, 20, expect.anything()));
    vi.mocked(searchUsers).mockClear();

    // When: the user searches while page 2 is showing
    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    await userEvent.type(screen.getByLabelText("Search users by name"), "ada");

    // Then: exactly one request fires, for page 1 with the new filter — never a wasted
    // (page 2, new search) request
    await waitFor(() => {
      expect(searchUsers).toHaveBeenCalledWith(
        1,
        20,
        expect.objectContaining({
          filters: [{ field: "FULL_NAME", value: "ada", operation: "CONTAINS", caseSensitive: false }],
        })
      );
    });
    expect(searchUsers).toHaveBeenCalledTimes(1);
  });

  it("should issue exactly one teams request, for page 1, when the search changes while on a later page", async () => {
    // Given: two pages of teams
    vi.mocked(searchTeams).mockResolvedValue({
      content: [aTeam({ id: 7, team_name: "Growth" })],
      pageNumber: 1,
      pageSize: 20,
      totalElements: 40,
      totalPages: 2,
    });

    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: /Teams/ }));
    await screen.findByText("Growth");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(searchTeams).toHaveBeenLastCalledWith(2, 20, expect.anything()));
    vi.mocked(searchTeams).mockClear();

    // When: the user searches while page 2 is showing
    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    await userEvent.type(screen.getByLabelText("Search teams by name"), "grow");

    // Then: exactly one request fires, for page 1 with the new filter — never a wasted
    // (page 2, new search) request
    await waitFor(() => {
      expect(searchTeams).toHaveBeenCalledWith(1, 20, { name: "grow" });
    });
    expect(searchTeams).toHaveBeenCalledTimes(1);
  });

  it("should not repeat the tab-count requests on a remount within the staleTime window", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TeamManagement />
        </ToastProvider>
      </QueryClientProvider>
    );

    const { unmount } = render(page);
    await screen.findByText("Ada Lovelace");
    const countCall = (calls: unknown[][]) => calls.filter(([, pageSize]) => pageSize === 1).length;
    expect(countCall(vi.mocked(searchUsers).mock.calls)).toBe(1);
    expect(countCall(vi.mocked(searchTeams).mock.calls)).toBe(1);

    // When: the screen is left and revisited (a fresh TeamManagement mount, same cache)
    unmount();
    render(page);
    await screen.findByText("Ada Lovelace");

    // Then: the tab-count requests are not repeated
    expect(countCall(vi.mocked(searchUsers).mock.calls)).toBe(1);
    expect(countCall(vi.mocked(searchTeams).mock.calls)).toBe(1);
  });

  it("should not re-request the roles dictionary or team list when switching tabs repeatedly", async () => {
    renderPage();
    await screen.findByText("Ada Lovelace");
    expect(listRoles).toHaveBeenCalledTimes(1);
    expect(listTeams).toHaveBeenCalledTimes(1);

    await userEvent.click(await screen.findByRole("tab", { name: /Teams/ }));
    await screen.findByText("Growth");
    await userEvent.click(await screen.findByRole("tab", { name: /Users/ }));
    await screen.findByText("Ada Lovelace");
    await userEvent.click(await screen.findByRole("tab", { name: /Teams/ }));
    await screen.findByText("Growth");
    await userEvent.click(await screen.findByRole("tab", { name: /Users/ }));
    await screen.findByText("Ada Lovelace");

    expect(listRoles).toHaveBeenCalledTimes(1);
    expect(listTeams).toHaveBeenCalledTimes(1);
  });

  it("should sync from NetSuite and report the summary", async () => {
    vi.mocked(syncNetSuite).mockResolvedValue({ teams: 3, users: 12, assignmentsUpdated: 5, agenciesMapped: 8 });

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Sync from BQ" }));

    await waitFor(() => expect(syncNetSuite).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/Synced 3 teams, 12 users, 5 assignments updated, 8 agencies mapped\./)
    ).toBeInTheDocument();
  });
});
