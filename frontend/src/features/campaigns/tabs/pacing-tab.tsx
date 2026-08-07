import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { cn } from "../../../shared/style/cn";
import { SearchIcon, SettingsIcon } from "../../../shared/ui/icons/icons";
import { fmtMoney } from "../../pacing/mock/format";
import { useCampaignPacing } from "../../pacing/mock/hooks";
import { paceOf, pdCompute } from "../../pacing/mock/pacing";
import type { CampaignTabContext } from "../campaign-workspace";
import { PacingSettings } from "./pacing-settings";
import "./pacing-tab.css";

const TIME_SEGMENTS = ["Flight", "30d", "14d", "7d", "Custom"] as const;
const MARGIN_SCALE_PP = 10;

function nf(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * W2 — the mocked stand-in for the real pacing-src dashboard (see 03-REAL-DASHBOARD-INTEGRATION.md).
 * The filter row is visual only this phase (no list to filter against yet); the KPI grid and financial
 * strip are computed from `useCampaignPacing` + `pdCompute`, stable per campaign since pacing is seeded
 * by the real campaign id. "Pacing settings" opens the W6 slide-over (see `./pacing-settings`).
 */
export function PacingTab() {
  const { campaign } = useOutletContext<CampaignTabContext>();
  const pacingQuery = useCampaignPacing(campaign);
  const [filterText, setFilterText] = useState("");
  const [timeSegment, setTimeSegment] = useState<(typeof TIME_SEGMENTS)[number]>("Flight");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const pacing = pacingQuery.data;
  if (!pacing) return null;

  // A zero-budget campaign has no meaningful pacing figure to compare against (see Overview/Campaigns'
  // identical `isNoData` treatment) - margin is nulled out the same way; pp stays numeric (pdCompute's
  // input requires a number) but its display state is resolved via the same paceOf() used everywhere.
  const isNoData = pacing.budget === 0;
  const displayPace = paceOf({ budget: pacing.budget, pp: pacing.pp });
  const marginA = isNoData ? null : pacing.marginA;

  const k = pdCompute({
    start: campaign.start_date ?? "",
    end: campaign.end_date ?? "",
    budget: pacing.budget,
    pp: pacing.pp,
    marginA,
    marginT: pacing.marginT,
  });

  const opRead =
    displayPace === "over" ? "Ahead of pace"
      : displayPace === "under" ? "Behind pace"
      : displayPace === "nodata" ? "No data"
      : "On pace";
  const opReadNote =
    displayPace === "over" ? "Latest day exceeded the daily target. Overall pace is ahead."
      : displayPace === "under" ? "Delivery is trailing the plan. Consider boosting."
      : displayPace === "nodata" ? "No delivery recorded yet."
      : "Delivery is tracking the plan.";
  const deliveryGood = pacing.pp >= 0;
  const marginDiff = k.marginDiff;
  const marginGood = marginDiff != null && marginDiff >= 0;
  const marginMarkerLeft = 50 + (Math.max(-MARGIN_SCALE_PP, Math.min(MARGIN_SCALE_PP, marginDiff ?? 0)) / MARGIN_SCALE_PP) * 50;

  const cpm = (20 + (pacing.budget % 7)).toFixed(2);
  const dspFact = pacing.budget * Math.min(1, k.actualPct / 100);
  const clientFact = dspFact * 1.12;

  return (
    <div className="pacing-tab">
      <div className="pacing-tab__filters">
        <label className="pacing-tab__search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Filter anything…"
            aria-label="Filter anything"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
          />
        </label>
        <select className="pacing-tab__fsel" aria-label="Filter by channel" defaultValue="">
          <option value="">All Channels</option>
          <option>Display</option>
          <option>Video</option>
          <option>Search</option>
          <option>CTV/OTT</option>
          <option>Audio</option>
        </select>
        <select className="pacing-tab__fsel" aria-label="Filter by platform" defaultValue="">
          <option value="">All Platforms</option>
          <option>DV360</option>
          <option>The Trade Desk</option>
        </select>
        <div className="pacing-tab__seg" role="group" aria-label="Time range">
          {TIME_SEGMENTS.map((segment) => (
            <button
              key={segment}
              type="button"
              className={cn("pacing-tab__seg-btn", timeSegment === segment && "pacing-tab__seg-btn--active")}
              onClick={() => setTimeSegment(segment)}
            >
              {segment}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="button button--ghost button--sm pacing-tab__settings-btn"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon />
          Pacing settings
        </button>
      </div>

      <PacingSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className="pacing-tab__grid">
        <div className="pacing-tab__col">
          <div className="pacing-tab__card">
            <div className="pacing-tab__lbl">Flight Plan units</div>
            <div className="pacing-tab__val">{nf(k.planUnits)} <span className="pacing-tab__unit">impr</span></div>
            <div className="pacing-tab__note">Full-flight plan from NetSuite.</div>
          </div>
          <div className="pacing-tab__card">
            <div className="pacing-tab__lbl">Plan rate on {k.asOf}</div>
            <div className="pacing-tab__val">
              {nf(k.planRate)}<span className="pacing-tab__unit">/day</span> <span className="pacing-tab__unit">impr</span>
            </div>
            <div className="pacing-tab__note">{nf(k.planUnits)} ÷ {k.flightDays} days.</div>
          </div>
          <div className="pacing-tab__card">
            <div className="pacing-tab__lbl">Actual by {k.asOf}</div>
            <div className="pacing-tab__val">{nf(k.actualByDay)} <span className="pacing-tab__unit">impr</span></div>
            <div className="pacing-tab__note">
              <b>{nf(k.aboveExpected)} impr</b> {k.aboveExpected >= 0 ? "above" : "below"} expected.
            </div>
          </div>
        </div>

        <div className="pacing-tab__card">
          <div className="pacing-tab__h">Delivery</div>
          <div className="pacing-tab__sub">Plan Pace vs Fact Pace</div>
          <div className="pacing-tab__deliv-row">
            <span>Impressions</span>
            <span>Actual <b>{k.actualPct.toFixed(1)}%</b> / Plan {k.planPct.toFixed(1)}%</span>
          </div>
          <div className="pacing-tab__progress">
            <div
              className="pacing-tab__progress-fill"
              style={{ width: `${Math.min(100, k.actualPct)}%`, background: deliveryGood ? "var(--good)" : "var(--bad)" }}
            />
            <div className="pacing-tab__progress-marker" style={{ left: `${Math.min(100, k.planPct)}%` }} />
          </div>
          <div className={cn("pacing-tab__delta", deliveryGood ? "pacing-tab__delta--good" : "pacing-tab__delta--bad")}>
            {pacing.pp > 0 ? "+" : ""}{pacing.pp.toFixed(1)} pp {deliveryGood ? "ahead" : "behind"} of plan · {opRead}
          </div>
        </div>

        <div className="pacing-tab__card">
          <div className="pacing-tab__h">Margin</div>
          <div className="pacing-tab__sub">Target {pacing.marginT.toFixed(1)}%</div>
          {marginDiff == null ? (
            <>
              <div className="pacing-tab__bignum">—</div>
              <div className="pacing-tab__delta">No margin data</div>
            </>
          ) : (
            <>
              <div className={cn("pacing-tab__bignum", marginGood ? "pacing-tab__bignum--good" : "pacing-tab__bignum--bad")}>
                {marginA?.toFixed(1)}%
              </div>
              <div className={cn("pacing-tab__delta", marginGood ? "pacing-tab__delta--good" : "pacing-tab__delta--bad")}>
                {marginDiff > 0 ? "+" : ""}{marginDiff.toFixed(1)} pp vs target
              </div>
              <div className="pacing-tab__scale">
                <span>−{MARGIN_SCALE_PP}pp</span>
                <span>Target</span>
                <span>+{MARGIN_SCALE_PP}pp</span>
              </div>
              <div className="pacing-tab__progress">
                <div
                  className="pacing-tab__progress-marker pacing-tab__progress-marker--tall"
                  style={{ left: `${marginMarkerLeft}%`, background: marginGood ? "var(--good)" : "var(--bad)" }}
                />
              </div>
              <span className={cn("pacing-tab__chip", marginGood ? "pacing-tab__chip--good" : "pacing-tab__chip--bad")}>
                {marginGood ? "On target" : "Below target"}
              </span>
            </>
          )}
        </div>

        <div className="pacing-tab__col">
          <div className="pacing-tab__card">
            <div className="pacing-tab__lbl">Needed on {k.asOf} to be on pace</div>
            <div className={cn("pacing-tab__val", k.neededPerDay < 0 && "pacing-tab__val--neg")}>
              {k.neededPerDay > 0 ? "+" : ""}{nf(k.neededPerDay)}<span className="pacing-tab__unit">/day</span>
            </div>
            <div className="pacing-tab__note">{nf(k.neededTotal)} impr ÷ {k.daysLeftN} days.</div>
          </div>
          <div className="pacing-tab__card">
            <div className="pacing-tab__lbl">Actual on {k.asOf}</div>
            <div className="pacing-tab__val">{nf(k.actualToday)} <span className="pacing-tab__unit">impr</span></div>
            <div className="pacing-tab__note">
              <b>{nf(k.aboveDaily)}</b> {k.aboveDaily >= 0 ? "above" : "below"} daily target · {fmtMoney(k.daySpend)} spend
            </div>
          </div>
          <div className="pacing-tab__card">
            <div className="pacing-tab__lbl">Operational Read</div>
            <div className="pacing-tab__read">{opRead}</div>
            <div className="pacing-tab__note">{opReadNote}</div>
          </div>
        </div>
      </div>

      <div className="pacing-tab__daynote">Day {k.dayN} of {k.flightDays} · {k.daysLeftN} days left</div>

      <div className="pacing-tab__fin">
        <div className="pacing-tab__fincard">
          <div className="pacing-tab__fin-h">Client Plan <span className="pacing-tab__tag">Client Side</span></div>
          <div className="pacing-tab__fin-sub">Budget Plan</div>
          <div className="pacing-tab__fin-val">{fmtMoney(pacing.budget)}</div>
        </div>
        <div className="pacing-tab__fincard">
          <div className="pacing-tab__fin-h">Buying Guardrail <span className="pacing-tab__tag">Rate Ceiling</span></div>
          <div className="pacing-tab__fin-sub">Our Cost Plan (CPM)</div>
          <div className="pacing-tab__fin-val">${cpm}</div>
        </div>
        <div className="pacing-tab__fincard">
          <div className="pacing-tab__fin-h">DSP Side <span className="pacing-tab__tag">Actuals</span></div>
          <div className="pacing-tab__fin-sub">DSP Spend Fact</div>
          <div className="pacing-tab__fin-val">{fmtMoney(dspFact)}</div>
        </div>
        <div className="pacing-tab__fincard">
          <div className="pacing-tab__fin-h">Client Fact <span className="pacing-tab__tag">Actuals</span></div>
          <div className="pacing-tab__fin-sub">Client Budget Fact</div>
          <div className="pacing-tab__fin-val">{fmtMoney(clientFact)}</div>
        </div>
      </div>
    </div>
  );
}
