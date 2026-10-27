/**
 * What removing a person from a campaign's people list needs (2026-10-23): who, and whether the remover
 * has confirmed taking over the pacings that person owns on the campaign - without that the backend
 * refuses with 409 when there are any.
 */
export interface ShareRemoval {
  hubUserId: number;
  transferPacings: boolean;
}
