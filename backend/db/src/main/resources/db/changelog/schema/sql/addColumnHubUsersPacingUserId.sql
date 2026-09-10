-- §2 of the Pacing migration plan (User Sync): Pacing keeps its own users table as a thin mirror of
-- Hub employees, upserted by email and returning Pacing's own user_id (a UUID) for each one. This
-- column is where the Hub remembers that id, so a later call can be attributed without re-deriving it
-- from email.
--
-- Nullable: unknown until the first sync writes it back, and a brand-new Hub employee has no Pacing
-- row at all until the next scheduled run.
ALTER TABLE hub_users ADD COLUMN pacing_user_id TEXT;
