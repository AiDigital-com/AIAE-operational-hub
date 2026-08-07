insert into hub_report_views (id, campaign_id, name, type, status, note, dimensions, metrics, created_at, updated_at)
values (10, 42, 'All data', 'basic', 'saved', null, 'date,line_item_id', 'impressions,clicks', '2026-01-01 10:00:00', '2026-01-01 10:00:00'),
       (11, 42, 'Weekly reporting', 'basic', 'draft', null, 'date', 'spend', '2026-01-02 10:00:00', '2026-01-02 10:00:00'),
       (20, 99, 'Other campaign view', 'basic', 'draft', null, '', '', '2026-01-01 09:00:00', '2026-01-01 09:00:00');
