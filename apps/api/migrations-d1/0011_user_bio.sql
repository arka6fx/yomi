-- Short free-text bio on the profile; also given to the agent as context about the user.
ALTER TABLE "user" ADD COLUMN "bio" TEXT;
