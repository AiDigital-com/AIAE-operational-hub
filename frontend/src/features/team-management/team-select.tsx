import { useEffect, useRef, useState } from "react";
import { cn } from "../../shared/style/cn";
import { SearchIcon } from "../../shared/ui/icons/icons";
import type { TeamV1 } from "../teams/types";

interface TeamSelectProps {
  teams: TeamV1[];
  value: string;
  onChange: (teamId: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}

/**
 * A searchable team picker: a select-like trigger that opens a popover with a name filter and the
 * matching teams. Used wherever a team must be chosen from a potentially long list.
 */
export function TeamSelect({ teams, value, onChange, disabled, ariaLabel }: TeamSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: globalThis.PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (disabled) {
    return (
      <button type="button" className="team-select__trigger" aria-label={ariaLabel} disabled>
        <span className="team-select__value team-select__placeholder">All (admin)</span>
      </button>
    );
  }

  const selected = teams.find((team) => String(team.id) === value);
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? teams.filter((team) => (team.team_name ?? "").toLowerCase().includes(needle))
    : teams;

  return (
    <div className="team-select" ref={ref}>
      <button
        type="button"
        className="team-select__trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        title={selected?.team_name ?? undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={cn("team-select__value", !selected && "team-select__placeholder")}>
          {selected?.team_name ?? "Select team"}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="team-select__chev" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="team-select__pop">
          <span className="team-select__search">
            <SearchIcon />
            <input
              type="search"
              autoFocus
              aria-label="Search teams"
              placeholder="Search teams…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
          <ul className="team-select__list">
            {matches.length === 0 && <li className="team-select__empty">No teams found</li>}
            {matches.map((team) => (
              <li key={team.id}>
                <button
                  type="button"
                  className={cn("team-select__option", String(team.id) === value && "team-select__option--selected")}
                  title={team.team_name ?? undefined}
                  onClick={() => {
                    onChange(String(team.id));
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {team.team_name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
