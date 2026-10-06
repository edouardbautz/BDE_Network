-- The login identifies a person, not the e-mail address. With a unique address, a 42 profile whose
-- address another account already holds could not sign in at all. Nothing looks a user up by
-- address, so the constraint protected nothing and could only lock someone out.
DROP INDEX "User_email_key";
