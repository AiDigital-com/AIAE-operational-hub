INSERT INTO hub_agency_owner_overrides
    (id, owner_user_id, team_lead_user_id, reason, status, created_at, updated_at)
SELECT nextval('hub_agency_owner_overrides_seq'),
       owner.id,
       team_lead.id,
       'NetSuite records this Brandworks Senior Director as the owner of 8 agencies. She is a director, '
           || 'so the sync never maps her agencies to a team, and nothing in NetSuite or Rippling says which '
           || 'team beneath her they belong to - regional_team carries both "Brand Works" and "House" on every '
           || 'one of them. She has exactly one Team Lead in her own department, so her agencies go to that '
           || 'team.',
       'ACTIVE',
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM hub_users owner,
     hub_users team_lead
WHERE lower(owner.email) = 'asya.tikhomolova@aidigital.com'
  AND lower(team_lead.email) = 'mariia.tonkovskaia@aidigital.com';
