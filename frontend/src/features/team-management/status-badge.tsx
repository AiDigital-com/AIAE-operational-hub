import { cn } from "../../shared/style/cn";

/**
 * Status indicator matching the reference design: a colored LED dot plus an Active/Inactive label
 * (green dot for active, grey for inactive) — not a pill.
 */
export function StatusBadge({ status }: { status?: string }) {
  const active = status === "ACTIVE";
  return (
    <span className={cn("team-mgmt__status-badge", active && "team-mgmt__status-badge--active")}>
      <span className="team-mgmt__status-led" aria-hidden="true" />
      {active ? "Active" : "Inactive"}
    </span>
  );
}
