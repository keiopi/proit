-- Earlier seed data ended product life before extended support finished. End of
-- life cannot come first, so it moves to the end of extended support.
UPDATE lifecycle_records SET eol_at = extended_at WHERE eol_at < extended_at;
