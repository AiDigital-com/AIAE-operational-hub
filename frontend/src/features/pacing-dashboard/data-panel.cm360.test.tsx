import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { PacingDataSection } from "./data-panel";
import type { SettingsSectionHandle } from "./settings-section";

vi.mock("./api", () => ({
  savePacingDataSettings: vi.fn(),
  savePacingThirdParty: vi.fn(),
  getPacingThirdPartyCampaigns: vi.fn(),
  getPacingThirdPartyStatus: vi.fn(),
  refetchPacingThirdParty: vi.fn(),
}));

/**
 * The CM360 source list on Settings → Data.
 *
 * The case worth pinning hardest is the one nobody would see happen: the save is a WHOLE-ARRAY
 * replace, so an editor that showed only the first source would delete the others the moment
 * anything else on this tab was saved.
 */

const CAMPAIGNS = {
  ok: true,
  stale: false,
  campaigns: [
    { name: "Spring Sale", report: "R1", imp: 1000, lastSeen: "2026-09-01" },
    { name: "Autumn Push", report: "R1", imp: 500, lastSeen: "2026-09-02" },
    { name: "Winter Tease", report: "R2", imp: 20, lastSeen: "2026-09-03" },
  ],
};

function renderPanel(thirdParty: Record<string, unknown>[] | undefined, ref?: React.Ref<SettingsSectionHandle>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PacingDataSection
        ref={ref}
        slug="nike-ss26"
        data={undefined}
        seedKey={1}
        visible
        thirdParty={thirdParty}
        onDirtyChange={() => {}}
        onSwitchesChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

const sources = () => [...document.querySelectorAll(".pdata__cm360")];

describe("several CM360 sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getPacingThirdPartyCampaigns).mockResolvedValue(CAMPAIGNS as never);
    vi.mocked(api.getPacingThirdPartyStatus).mockResolvedValue({ state: "none" } as never);
    vi.mocked(api.savePacingThirdParty).mockResolvedValue(undefined);
  });

  const TWO = [
    { id: "tp_a", type: "cm360", report_name: "R1", campaigns: ["Spring Sale"] },
    { id: "tp_b", type: "cm360", report_name: "R2", campaigns: ["Winter Tease"] },
  ];

  it("shows every stored source, not just the first", async () => {
    renderPanel(TWO);
    await waitFor(() => expect(sources()).toHaveLength(2));
  });

  it("a save keeps the sources it was not asked to change", async () => {
    // The whole point: editing source A must not delete source B.
    const ref = createRef<SettingsSectionHandle>();
    renderPanel(TWO, ref);
    await screen.findByRole("checkbox", { name: /Autumn Push/ });

    // Tick a second campaign on the FIRST source only.
    const first = sources()[0] as HTMLElement;
    await userEvent.click(within(first).getByRole("checkbox", { name: /Autumn Push/ }));
    await ref.current!.save();

    const [, sent] = vi.mocked(api.savePacingThirdParty).mock.calls[0];
    expect(sent).toHaveLength(2);
    expect(sent![0]).toMatchObject({ id: "tp_a", campaigns: ["Spring Sale", "Autumn Push"] });
    expect(sent![1]).toMatchObject({ id: "tp_b", campaigns: ["Winter Tease"] });
  });

  it("drops a source whose campaigns were all unticked, and keeps the other", async () => {
    const ref = createRef<SettingsSectionHandle>();
    renderPanel(TWO, ref);
    await screen.findByRole("checkbox", { name: /Winter Tease/ });

    const second = sources()[1] as HTMLElement;
    await userEvent.click(within(second).getByRole("checkbox", { name: /Winter Tease/ }));
    await ref.current!.save();

    const [, sent] = vi.mocked(api.savePacingThirdParty).mock.calls[0];
    expect(sent).toHaveLength(1);
    expect(sent![0]).toMatchObject({ id: "tp_a" });
  });

  it("gives a NEW source an id - Pacing drops an id-less entry without saying so", async () => {
    // The failure this pins is the quiet kind: `safeThirdPartyEntry` returns null for an entry with
    // no id, the array validates down to empty, the save answers 204, and the source simply never
    // exists. Nothing on screen says anything went wrong.
    const ref = createRef<SettingsSectionHandle>();
    renderPanel([], ref);
    await waitFor(() => expect(screen.getByRole("button", { name: /Add CM360 source/i })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: /Add CM360 source/i }));
    await userEvent.selectOptions(document.querySelector(".pdata__cm360 select")!, "R1");
    await userEvent.click(await screen.findByRole("checkbox", { name: /Spring Sale/ }));
    await ref.current!.save();

    const [, sent] = vi.mocked(api.savePacingThirdParty).mock.calls[0];
    expect(sent![0]).toMatchObject({ type: "cm360", campaigns: ["Spring Sale"] });
    expect((sent![0] as { id?: string }).id).toMatch(/^tp_/);
  });

  it("keeps the id a stored source already has", async () => {
    const ref = createRef<SettingsSectionHandle>();
    renderPanel([{ id: "tp_kept", type: "cm360", report_name: "R1", campaigns: ["Spring Sale"] }], ref);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Autumn Push/ }));
    await ref.current!.save();

    const [, sent] = vi.mocked(api.savePacingThirdParty).mock.calls[0];
    expect((sent![0] as { id?: string }).id).toBe("tp_kept");
  });

  it("adds a source without disturbing the one already there", async () => {
    renderPanel([TWO[0]]);
    await waitFor(() => expect(sources()).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: /Add CM360 source/i }));
    expect(sources()).toHaveLength(2);
  });

  it("each source picks from ITS OWN report, which is what scoping is for", async () => {
    renderPanel(TWO);
    await screen.findByRole("checkbox", { name: /Winter Tease/ });
    // R1 carries two campaigns, R2 one.
    expect(within(sources()[0] as HTMLElement).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(sources()[1] as HTMLElement).getAllByRole("checkbox")).toHaveLength(1);
  });
});

describe("when a save is worth sending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getPacingThirdPartyCampaigns).mockResolvedValue(CAMPAIGNS as never);
    vi.mocked(api.getPacingThirdPartyStatus).mockResolvedValue({ state: "none" } as never);
    vi.mocked(api.savePacingThirdParty).mockResolvedValue(undefined);
  });

  it("re-ticking the same campaigns in another order sends nothing", async () => {
    // Saving a source TRIGGERS a pull. Campaign order is not a fact about the source, so a list
    // that differs only in the order boxes were clicked must not re-fetch CM360.
    const ref = createRef<SettingsSectionHandle>();
    renderPanel([{ id: "tp_a", type: "cm360", report_name: "R1", campaigns: ["Spring Sale", "Autumn Push"] }], ref);
    const box = await screen.findByRole("checkbox", { name: /Spring Sale/ });
    await userEvent.click(box);   // off - order is now [Autumn Push]
    await userEvent.click(box);   // on  - order is now [Autumn Push, Spring Sale]
    await ref.current!.save();

    expect(api.savePacingThirdParty).not.toHaveBeenCalled();
  });
});

describe("pulling again", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getPacingThirdPartyCampaigns).mockResolvedValue(CAMPAIGNS as never);
    vi.mocked(api.getPacingThirdPartyStatus).mockResolvedValue({ state: "ready", rowCount: 10 } as never);
  });

  const ONE = [{ id: "tp_a", type: "cm360", report_name: "R1", campaigns: ["Spring Sale"] }];

  it("asks for a fresh pull", async () => {
    vi.mocked(api.refetchPacingThirdParty).mockResolvedValue({
      started: true, notConfigured: false, rateLimited: false,
    });
    renderPanel(ONE);
    await userEvent.click(await screen.findByRole("button", { name: /Pull again/i }));
    expect(api.refetchPacingThirdParty).toHaveBeenCalledWith("nike-ss26");
  });

  it("is refused while there is no source to pull", async () => {
    renderPanel([]);
    expect(await screen.findByRole("button", { name: /Pull again/i })).toBeDisabled();
  });

  it("says there is nothing to pull, rather than showing a failure", async () => {
    // The endpoint answers this as a normal outcome; a red error line would misread it.
    vi.mocked(api.refetchPacingThirdParty).mockResolvedValue({
      started: false, notConfigured: true, rateLimited: false,
    });
    renderPanel(ONE);
    await userEvent.click(await screen.findByRole("button", { name: /Pull again/i }));
    expect(await screen.findByText(/no CM360 source to pull/i)).toBeInTheDocument();
  });

  it("says to wait when the budget is spent", async () => {
    vi.mocked(api.refetchPacingThirdParty).mockResolvedValue({
      started: false, notConfigured: false, rateLimited: true,
    });
    renderPanel(ONE);
    await userEvent.click(await screen.findByRole("button", { name: /Pull again/i }));
    expect(await screen.findByText(/try again in a minute/i)).toBeInTheDocument();
  });
});

describe("the pull's state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getPacingThirdPartyCampaigns).mockResolvedValue(CAMPAIGNS as never);
    vi.mocked(api.savePacingThirdParty).mockResolvedValue(undefined);
  });

  it("says a pull is running", async () => {
    vi.mocked(api.getPacingThirdPartyStatus).mockResolvedValue({ state: "pending" } as never);
    renderPanel([]);
    expect(await screen.findByText(/Pulling ad-server rows/i)).toBeInTheDocument();
  });

  it("says how many rows landed, and when", async () => {
    vi.mocked(api.getPacingThirdPartyStatus).mockResolvedValue({
      state: "ready", rowCount: 13884, fetchedAt: "2026-10-07T13:38:36.441Z",
    } as never);
    renderPanel([]);
    // Formatted the way the rest of the app writes a date - not the raw ISO stamp with millis.
    expect(await screen.findByText(/13,884 · Oct 7, 2026/)).toBeInTheDocument();
  });

  it("says nothing was pulled yet, rather than leaving the section silent", async () => {
    vi.mocked(api.getPacingThirdPartyStatus).mockResolvedValue({ state: "none" } as never);
    renderPanel([]);
    expect(await screen.findByText(/Nothing pulled yet/i)).toBeInTheDocument();
  });
});
