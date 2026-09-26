-- Streaks stopped being recorded when the backend moved to Python: messages were saved
-- but never counted, so everyone showed 0. The live counter is back (streaks_d1.
-- record_message); this rebuilds each user's numbers from the messages they have sent
-- (agent_messages, role 'user'). Days follow India time (UTC+05:30), like the live
-- counter. Safe to run again: it recomputes the same values, and never lowers a count
-- or longest streak someone already has.
WITH days AS (
  SELECT DISTINCT user_id, date(created_at, '+330 minutes') AS d
  FROM agent_messages
  WHERE role = 'user' AND created_at IS NOT NULL
),
runs AS (
  -- Consecutive days share a group: day number minus its position in the sequence.
  SELECT user_id, d,
         julianday(d) - ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d) AS grp
  FROM days
),
islands AS (
  SELECT user_id, COUNT(*) AS len, MAX(d) AS last_d
  FROM runs
  GROUP BY user_id, grp
),
totals AS (
  SELECT user_id, COUNT(*) AS n
  FROM agent_messages
  WHERE role = 'user'
  GROUP BY user_id
)
UPDATE "user" SET
  "total_messages_sent" = MAX(
    "total_messages_sent",
    (SELECT n FROM totals WHERE totals.user_id = "user"."id")
  ),
  "longest_streak" = MAX(
    "longest_streak",
    COALESCE((SELECT MAX(len) FROM islands WHERE islands.user_id = "user"."id"), 0)
  ),
  "current_streak" = COALESCE(
    (SELECT len FROM islands WHERE islands.user_id = "user"."id" ORDER BY last_d DESC LIMIT 1),
    "current_streak"
  ),
  "last_active_date" = COALESCE(
    (SELECT MAX(last_d) FROM islands WHERE islands.user_id = "user"."id"),
    "last_active_date"
  )
WHERE "id" IN (SELECT user_id FROM totals);
