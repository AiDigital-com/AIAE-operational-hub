import { useMemo, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { formatError } from "../../../shared/format/error";
import { cn } from "../../../shared/style/cn";
import { BranchIcon, ChevronRightIcon, FolderIcon } from "../../../shared/ui/icons/icons";
import { LoadingBlock } from "../../../shared/ui/loading-spinner/loading-spinner";
import { displayStatusLabel, resolveStatusStyle, StatusBadge } from "../../../shared/ui/status-badge/status-badge";
import { Tooltip } from "../../../shared/ui/tooltip/tooltip";
import { STATUS, type MockStatus } from "../../pacing/mock/constants";
import { fmtDate, fmtMoney } from "../../pacing/mock/format";
import type { InsertionOrder, LineItem, SetupModel } from "../../pacing/mock/types";
import { useCampaignSetup } from "../hooks";
import type { CampaignTabContext } from "../campaign-workspace";
import "./setup-tab.css";

function matchesQuery(fields: string[], q: string): boolean {
  return fields.some((value) => value.toLowerCase().includes(q));
}

/**
 * W3 — Campaign setup (US-009…011): the real IO/LI tree read from NetSuite (`useCampaignSetup`), with
 * expand/collapse and real-time search. Manually adding a whole insertion order (US-013) is supported
 * as a client-only adjustment (never mutating the base rows); adding a line item to an existing order
 * (US-012) isn't yet, since Setup has no write path for it - only for whole manual orders.
 */
export function SetupTab() {
  const { campaign } = useOutletContext<CampaignTabContext>();
  const navigate = useNavigate();
  const location = useLocation();
  const setup = useCampaignSetup(campaign);

  const [query, setQuery] = useState("");
  const [closedIds, setClosedIds] = useState<Set<string>>(new Set());

  const data = setup.data;
  const q = query.trim().toLowerCase();

  const { blocks, shownLis, totalLis, totalBudget } = useMemo(() => {
    const ios = data?.ios ?? [];
    let totalLisCount = 0;
    let budget = 0;
    ios.forEach((io) => {
      totalLisCount += io.lis.length;
      budget += io.lis.reduce((sum, li) => sum + li.budget, 0);
    });

    let shown = 0;
    const groups = ios.map((io) => {
      // Channel is deliberately excluded here: an order's channel/channelExtra is just the deduped
      // union of its own line items' channels, so a channel search always matches at least one line
      // item too - letting it also match the order would show every one of the order's line items
      // (see the LI-level filter below) instead of only the ones whose own channel actually matched.
      const ioMatches = !q || matchesQuery([io.name, io.id], q);
      let lis = io.lis;
      if (q && !ioMatches) {
        lis = io.lis.filter((li) => matchesQuery([li.name, li.id, li.channel], q));
        if (!lis.length) return null;
      }
      shown += lis.length;
      const open = q ? true : !closedIds.has(io.id);
      return { io, lis, open, matchingSubset: q && !ioMatches };
    });

    return { blocks: groups.filter(Boolean) as NonNullable<(typeof groups)[number]>[], shownLis: shown, totalLis: totalLisCount, totalBudget: budget };
  }, [data, q, closedIds]);

  if (setup.isPending) {
    return <LoadingBlock label="Loading campaign setup" />;
  }
  if (setup.isError || !data) {
    return <p className="form-error">{formatError(setup.error)}</p>;
  }

  const allOpen = data.ios.every((io) => !closedIds.has(io.id));

  function toggleIO(ioId: string) {
    setClosedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ioId)) next.delete(ioId);
      else next.add(ioId);
      return next;
    });
  }

  function toggleAll() {
    setClosedIds(allOpen ? new Set((data as SetupModel).ios.map((io) => io.id)) : new Set());
  }

  return (
    <div className="setup-tab">
      <h2 className="setup-tab__title">Campaign setup</h2>

      <div className="setup-tab__toolbar">
        <div className="setup-tab__meta">
          <span><b>{data.ios.length}</b> insertion orders</span>
          <span><b>{totalLis}</b> line items</span>
          <span><b>{fmtMoney(totalBudget)}</b> total media</span>
          <span className="setup-tab__sync-note">
            <span className="setup-tab__led" />
            Pre-loaded from NetSuite
          </span>
        </div>
        <div className="setup-tab__actions">
          <button
            type="button"
            className="button button--ghost button--sm"
            style={{ visibility: q ? "hidden" : "visible" }}
            onClick={toggleAll}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      <div className="setup-tab__search-row">
        <label className="setup-tab__search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            type="search"
            placeholder="Search line items, insertion orders or channels…"
            aria-label="Search setup"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {q && (
          <span className="setup-tab__search-count">
            {shownLis} line item{shownLis !== 1 ? "s" : ""} matching
          </span>
        )}
      </div>

      <div className="setup-tab__tbl-wrap">
        <table className="setup-tab__tbl">
          <thead>
            <tr>
              <th>Insertion order / Line item</th>
              <th>Channel</th>
              <th>Flight dates</th>
              <th className="setup-tab__num">Budget</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {blocks.length === 0 && (
              <tr>
                <td colSpan={5} className="setup-tab__empty">
                  {q
                    ? `No insertion orders or line items match "${query.trim()}".`
                    : "No insertion orders found for this campaign in NetSuite."}
                </td>
              </tr>
            )}
            {blocks.map(({ io, lis, open, matchingSubset }) => (
              <IoRows
                key={io.id}
                io={io}
                lis={lis}
                open={open}
                matchingSubset={Boolean(matchingSubset)}
                onToggle={() => toggleIO(io.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="setup-tab__footer">
        <button
          type="button"
          className="button button--primary"
          onClick={() => navigate("../reporting", { state: location.state })}
        >
          Verify &amp; create report →
        </button>
      </div>
    </div>
  );
}

/** Manually-added rows still choose from the mock's own 5-value status vocabulary (the add form's
 * `FORM_STATUSES`); real rows carry a real NetSuite `order_status` string. Resolves either to a
 * badge label/color, preferring the mock's own labelled map for the former and the shared real-status
 * color map (`resolveStatusStyle`) for the latter. */
const MOCK_STATUSES = new Set<string>(["draft", "live", "paused", "complete", "archived"]);

function statusBadgeProps(status: string): { label: string; color: string; glow?: boolean } {
  if (MOCK_STATUSES.has(status)) {
    const mock = STATUS[status as MockStatus];
    return { label: mock.label, color: mock.color };
  }
  const style = resolveStatusStyle(status);
  return { label: displayStatusLabel(status), color: style.color, glow: style.glow };
}

/**
 * One primary channel pill, plus an optional +N pill when the IO rolls up several media tactics. The
 * +N pill shows the rest of the tactics in a hover tooltip instead of forcing a click/expand to see them.
 */
function ChannelTags({ channel, more = 0, extra = [] }: { channel: string; more?: number; extra?: string[] }) {
  return (
    <span className="setup-tab__tags">
      <span className="setup-tab__tag">{channel}</span>
      {more > 0 && (
        <Tooltip content={extra.join(", ")}>
          <span className="setup-tab__tag" tabIndex={0}>+{more}</span>
        </Tooltip>
      )}
    </span>
  );
}

interface IoRowsProps {
  io: InsertionOrder;
  lis: LineItem[];
  open: boolean;
  matchingSubset: boolean;
  onToggle: () => void;
}

function IoRows({ io, lis, open, matchingSubset, onToggle }: IoRowsProps) {
  const ioStatus = statusBadgeProps(io.status);
  return (
    <>
      <tr className={cn("setup-tab__io-row", open && "setup-tab__io-row--open")} onClick={onToggle}>
        <td>
          <div className="setup-tab__io-tog">
            <ChevronRightIcon className="setup-tab__chev" />
            <div className="setup-tab__io-ic"><FolderIcon /></div>
            <div>
              <div className="setup-tab__io-name">
                {io.name}
                {io.manual && <span className="setup-tab__manual-tag">Manual</span>}
              </div>
              <div className="setup-tab__io-id">
                ID {io.id} · {io.lis.length} line item{io.lis.length !== 1 ? "s" : ""}
                {matchingSubset ? ` · ${lis.length} matching` : ""}
              </div>
            </div>
          </div>
        </td>
        <td><ChannelTags channel={io.channel} more={io.channelMore} extra={io.channelExtra} /></td>
        <td className="setup-tab__flight">{fmtDate(io.start)} — {fmtDate(io.end)}</td>
        <td className="setup-tab__num">{fmtMoney(io.budget)}</td>
        <td><StatusBadge label={ioStatus.label} color={ioStatus.color} glow={ioStatus.glow} /></td>
      </tr>
      {open && lis.map((li) => {
        const liStatus = statusBadgeProps(li.status);
        return (
          <tr key={li.id} className="setup-tab__li-row">
            <td>
              <div className="setup-tab__li-cell">
                <BranchIcon className="setup-tab__branch" />
                <div>
                  <span className="setup-tab__li-id">LI {li.id}</span>
                  {li.manual && <span className="setup-tab__manual-tag">Manual</span>}
                  <div className="setup-tab__li-sub">{li.name}</div>
                </div>
              </div>
            </td>
            <td><ChannelTags channel={li.channel} /></td>
            <td className="setup-tab__flight">{fmtDate(li.start)} — {fmtDate(li.end)}</td>
            <td className="setup-tab__num setup-tab__num--strong">{fmtMoney(li.budget)}</td>
            <td><StatusBadge label={liStatus.label} color={liStatus.color} glow={liStatus.glow} /></td>
          </tr>
        );
      })}
    </>
  );
}
