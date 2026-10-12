// The `api` seam the moved Settings editors were written against, over the Hub's own client.
//
// Those editors came from the retired SPA, where `api.sheetProbe(...)` returned Pacing's answer
// verbatim - snake_case, with an `ok` flag. The Hub talks to Pacing through its own backend, which
// renames those fields on the way past. Rather than rewrite ~2000 lines of editor to the new names
// (and re-review every one of them), this translates the Hub's answers back into the shape the
// editors already read.
//
// It is a SEAM, not a second client: no request is built here, nothing is cached, and every call is
// one line of renaming over a function in `../api.ts`. When an editor is eventually rewritten
// against the Hub's names, this file goes with it.

import {
  getPacingDashboard,
  probePacingSheet,
  readPacingDimSource,
  readPacingDimSourceValues,
  suggestPacingDimSource,
} from "../api";

/** The `{ ok: false, error }` shape the editors check for, from a thrown Hub error. */
function failed(err) {
  const status = err && typeof err === "object" ? err.status : undefined;
  return { ok: false, error: err?.message || "request failed", status };
}

export const api = {
  /**
   * What a spreadsheet holds. `readable` becomes `ok` and the tabs keep their own field names, which
   * is what the column editor reads them by.
   */
  sheetProbe: async (slug, url) => {
    try {
      const out = await probePacingSheet(slug, url);
      return {
        ok: !!out.readable,
        title: out.title ?? "",
        spreadsheet_id: out.spreadsheetId ?? "",
        share_with: out.shareWith ?? null,
        error: out.error ?? null,
        tabs: (out.tabs ?? []).map((tab) => ({
          sheet_id: tab.sheetId,
          title: tab.title,
          row_count: tab.rowCount,
          col_count: tab.colCount,
          header_row: tab.headerRow,
          headers: tab.headers ?? [],
          sample: tab.sample ?? [],
          grid: tab.grid ?? [],
        })),
      };
    } catch (err) {
      return failed(err);
    }
  },

  /** The distinct values of a tab's columns. */
  sheetDimValues: async (slug, spreadsheetId, sheetId, columns, headerRow = 0) => {
    try {
      const out = await readPacingDimSourceValues(slug, spreadsheetId, sheetId, columns, headerRow);
      return {
        ok: true,
        columns: out.columns ?? [],
        values: out.values ?? [],
        truncated: !!out.truncated,
        scanned_rows: out.scannedRows ?? 0,
      };
    } catch (err) {
      return failed(err);
    }
  },

  /** Re-read a configured source now. */
  dimSourceRead: async (slug, sourceId) => {
    try {
      const out = await readPacingDimSource(slug, sourceId);
      return {
        ok: true,
        source_id: out.sourceId,
        rows: out.rows ?? 0,
        unbound_rows: out.unboundRows ?? 0,
        unparsed_cells: out.unparsedCells ?? 0,
        bytes: out.bytes ?? 0,
        coverage_hint: out.coverageHint ?? null,
      };
    } catch (err) {
      return failed(err);
    }
  },

  /**
   * The dashboard payload.
   *
   * The moved editors re-read it after a re-read, to show the figures the read just produced. The
   * Hub's own copy is a react-query cache, so the host ALSO refetches - this call is what the
   * component itself reads, and its `dimSources` is the slice it is after.
   */
  dashboardData: async (slug) => {
    try {
      return await getPacingDashboard(slug);
    } catch (err) {
      // The caller treats a missing blob as "the figures will catch up on the next load", which is
      // true: the read itself already happened on the server.
      return failed(err);
    }
  },

  /**
   * Ask for a proposal.
   *
   * `available: false` arrives as a NOTICE rather than as a thrown failure - no model is connected,
   * or the sheet has not been read yet - and the editors show `error` text for it, so the notice is
   * passed through there. That keeps "nothing to ask" and "the ask failed" one shape in the editor,
   * which is the shape it was written against.
   */
  dimSourceSuggest: async (slug, sourceId, payload) => {
    try {
      const out = await suggestPacingDimSource(slug, sourceId, {
        kind: payload?.kind ?? "groups",
        dim: payload?.dim ?? null,
        label: payload?.label ?? null,
        unbound: payload?.unbound ?? [],
        candidates: payload?.candidates ?? [],
      });
      if (!out.available) return { ok: false, error: out.notice || "nothing to suggest" };
      return {
        ok: true,
        bindings: (out.bindings ?? []).map((b) => ({ value: b.value, line_item_id: b.lineItemId })),
        members: out.members ?? [],
        groups: out.groups ?? [],
        considered: out.considered ?? 0,
      };
    } catch (err) {
      return failed(err);
    }
  },
};
