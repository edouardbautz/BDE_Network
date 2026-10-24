-- What must be true of the requests to publish events on the intra (see invariants.ts). Kept apart from invariants.sql because a
-- database of an older version, which the update suite looks at after the way back, does not have this table at all.
-- (The shape of each state, the hash and the link are CHECKs of the database; what only the application knows is below.)
SELECT 'a_request_for_the_intra_is_for_a_published_event' AS invariant, r."id" AS detail
FROM "IntraRequest" r JOIN "Event" e ON e."id" = r."eventId"
WHERE e."status" <> 'CONFIRMED' AND NOT EXISTS (SELECT 1 FROM "EventOccurrence" o WHERE o."eventId" = e."id" AND o."status" = 'CONFIRMED')
UNION ALL
SELECT 'a_request_for_the_intra_is_for_an_event_that_has_its_fields', r."id"
FROM "IntraRequest" r JOIN "Event" e ON e."id" = r."eventId"
WHERE e."intraOrganizerLogin" IS NULL
UNION ALL
SELECT 'a_request_sender_id_is_the_account_of_the_sender_login', r."id"
FROM "IntraRequest" r JOIN "User" u ON u."id" = r."requestedById" WHERE u."login" <> r."requestedByLogin"
UNION ALL
SELECT 'a_request_answerer_id_is_the_account_of_the_answerer_login', r."id"
FROM "IntraRequest" r JOIN "User" u ON u."id" = r."answeredById" WHERE u."login" <> r."answeredByLogin"
