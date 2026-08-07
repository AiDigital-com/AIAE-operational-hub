CREATE TABLE hub_sync_lock
(
    lock_name TEXT    NOT NULL,
    locked    BOOLEAN NOT NULL DEFAULT false,
    locked_at TIMESTAMP(6) WITHOUT TIME ZONE,
    CONSTRAINT pk_hub_sync_lock PRIMARY KEY (lock_name)
);

INSERT INTO hub_sync_lock (lock_name, locked) VALUES ('netsuite_sync', false);
