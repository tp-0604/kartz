// From a reviewed extractor row to a record the database stores.
//
// This is the same mapping the old save made, and it is the one place the extractor's shape and
// the database's shape meet: the roster name is the identity, null for somebody new; the drawn
// name is kept because it changes from month to month; the alliance is the player's own.
export function extractedToRecord(r, outName) {
  return {
    place:    r.rank,
    search:   r.match ? r.match.search : null,
    ingame:   r.name || outName(r),
    alliance: r.alliancePick || (r.match ? (r.match.alliance || null) : null),
    points:   r.points,
    edited:   0,
  };
}
