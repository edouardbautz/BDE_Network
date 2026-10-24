-- What must be true of the intra's fields of the events (see invariants.ts). Kept apart from invariants.sql because a database of
-- an older version, which the update suite looks at after the way back, does not have these columns at all.
-- (That they come all together or not at all is a CHECK of the database; what only the application knows is below.)
SELECT 'an_intra_kind_is_one_the_intra_offers' AS invariant, id AS detail
FROM "Event"
WHERE "intraKind" IS NOT NULL AND "intraKind" NOT IN ('Pedago/Rush', 'Pedago/Piscine', 'Pedago/Partnership', 'Meet/Conference', 'Meet/meet_up', 'Meet/event', 'Association', 'Speed working/Hackathon', 'Speed working/Workshop', 'Speed working/Challenge', 'Extern')
UNION ALL
SELECT 'an_intra_keyword_has_no_comma_and_is_not_empty', id
FROM "Event" e
WHERE EXISTS (SELECT 1 FROM unnest(e."intraKeywords") AS keyword WHERE keyword LIKE '%,%' OR btrim(keyword) = '')
UNION ALL
SELECT 'a_cut_series_row_has_the_intra_fields_of_its_first_row', e."id"
FROM "Event" e JOIN "Event" first ON first."id" = e."seriesId"
WHERE (e."intraOrganizerLogin" IS NULL) <> (first."intraOrganizerLogin" IS NULL)
