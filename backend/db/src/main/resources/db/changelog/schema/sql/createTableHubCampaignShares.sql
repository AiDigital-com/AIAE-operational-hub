-- Campaign sharing (2026-10-20): one row per person a NetSuite campaign was shared with from inside
-- the campaign ("Add people"). The row widens that person's Hub visibility to this campaign and, through
-- the Pacing scope the Hub signs, to every pacing under it - regardless of which team's agencies they
-- would otherwise see. Removing access deletes the row; nothing here is soft-deleted, because a share
-- carries no history worth keeping beyond who granted it.
CREATE TABLE hub_campaign_shares
(
    id                 BIGINT NOT NULL,
    campaign_id        BIGINT NOT NULL,
    user_id            BIGINT NOT NULL,
    granted_by_user_id BIGINT NOT NULL,
    created_at         TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at         TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_campaign_shares PRIMARY KEY (id),
    CONSTRAINT fk_hub_campaign_shares_user
        FOREIGN KEY (user_id) REFERENCES hub_users (id),
    CONSTRAINT fk_hub_campaign_shares_granted_by
        FOREIGN KEY (granted_by_user_id) REFERENCES hub_users (id),
    -- One row per person per campaign: sharing again is a no-op, not a duplicate.
    CONSTRAINT uq_hub_campaign_shares_campaign_user UNIQUE (campaign_id, user_id)
);

-- Visibility resolution asks "which campaigns were shared with THIS person" on every cache miss.
CREATE INDEX idx_hub_campaign_shares_user ON hub_campaign_shares (user_id);

CREATE SEQUENCE hub_campaign_shares_seq START WITH 1 INCREMENT BY 50;
