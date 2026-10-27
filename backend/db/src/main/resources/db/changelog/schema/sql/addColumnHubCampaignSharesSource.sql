-- Access rework (2026-10-23): where a share came from. 'manual' is "Add people" on the campaign;
-- 'pacing_created' is the automatic grant that follows owning a pacing on the campaign (creating one,
-- saving a plan that adds its line items, or receiving it in a transfer). The people list shows the
-- difference, and an automatic grant never overwrites a manual one - the row is simply kept.
--
-- The default backfills every existing row as 'manual': before this column, every share was.
ALTER TABLE hub_campaign_shares ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
