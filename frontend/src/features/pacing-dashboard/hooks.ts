import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getPacingDashboard, getPacingRefreshStatus } from "./api";

/**
 * The pacing dashboard payload (§6 of the migration plan, US-114/115) - one request per pacing, same
 * pattern as `usePacingOverview`/`useCampaignPacings`.
 */
export function usePacingDashboard(slug: string | undefined) {
  return useQuery({
    queryKey: ["pacing", "dashboard", slug],
    queryFn: () => getPacingDashboard(slug as string),
    enabled: !!slug,
  });
}

const REFRESH_POLL_INTERVAL_MS = 4000;
const REFRESH_POLL_TIMEOUT_MS = 150_000;

/**
 * The pacing's last completed refresh (US-119). While `watching` is true, polls every 4s until either
 * `refreshId` changes from the baseline captured when watching started, or 150s pass without a change
 * (roughly the 120s cooldown plus headroom) - mirroring the retired SPA's `refresh-poll.js` timing.
 * Not a generic "always poll" hook: outside an active watch it is a single fetch, so opening the
 * dashboard never starts a background timer nobody asked for.
 */
export function useRefreshStatus(slug: string | undefined) {
  const queryClient = useQueryClient();
  const [watching, setWatching] = useState(false);
  const baselineRef = useRef<string | null | undefined>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery({
    queryKey: ["pacing", "refresh-status", slug],
    queryFn: () => getPacingRefreshStatus(slug as string),
    enabled: !!slug,
    refetchInterval: watching ? REFRESH_POLL_INTERVAL_MS : false,
  });

  useEffect(() => {
    if (!watching || !query.data) return;
    if (baselineRef.current === undefined) return; // baseline not captured yet (see startWatching)
    // `refreshId` is optional on the wire and absent until a first build exists; normalise it the same
    // way the baseline is, or "no data yet" (undefined) would read as a change from itself (null) and
    // end the watch on its very first check - before any poll ever ran.
    if ((query.data.refreshId ?? null) !== baselineRef.current) {
      setWatching(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [watching, query.data]);

  function startWatching() {
    baselineRef.current = query.data?.refreshId ?? null;
    setWatching(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setWatching(false), REFRESH_POLL_TIMEOUT_MS);
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  /**
   * Re-pulls everything a landed refresh changes: this pacing's dashboard payload, and the pacing lists
   * whose rows carry its server-computed health (pace/margin/budget - the dashboard's hero cards read
   * those straight off `row`, see pacing-dashboard.tsx). Without the lists, a first build would fill
   * the charts in while the hero cards kept reading "No data" until a full page reload.
   */
  function invalidateDashboard() {
    void queryClient.invalidateQueries({ queryKey: ["pacing", "dashboard", slug] });
    void queryClient.invalidateQueries({ queryKey: ["pacing", "campaign"] });
    void queryClient.invalidateQueries({ queryKey: ["pacing", "overview"] });
  }

  return { ...query, watching, startWatching, invalidateDashboard };
}
