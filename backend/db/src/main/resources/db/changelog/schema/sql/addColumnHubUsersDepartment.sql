-- Access rework (2026-10-23): the employee's Rippling department path, as the daily sync reads it
-- ("Media & Performance Optimization > Media Optimization"). "Add people" on a campaign is limited to
-- MPO - the whole tree under app.netsuite-sync.director-root-department - and that question has to be
-- answered from the Hub's own rows, at share time, without a BigQuery read per candidate.
--
-- Nullable: filled by the next sync run; a user provisioned by login before the sync reaches them, or
-- created by hand, has none and so is not MPO until the sync says otherwise (fails closed).
ALTER TABLE hub_users ADD COLUMN department TEXT;
