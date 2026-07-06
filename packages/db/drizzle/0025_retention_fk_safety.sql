-- 0025 — retention FK safety: allow usage_events/devices deletion without
-- breaking referencing ledger/usage rows. Idempotent for safe deploys.

alter table "credit_transactions" drop constraint if exists "credit_transactions_usage_event_id_usage_events_id_fk";
--> statement-breakpoint
alter table "credit_transactions"
  add constraint "credit_transactions_usage_event_id_usage_events_id_fk"
  foreign key ("usage_event_id") references "usage_events"("id") on delete set null;
--> statement-breakpoint
alter table "usage_events" drop constraint if exists "usage_events_device_id_devices_id_fk";
--> statement-breakpoint
alter table "usage_events"
  add constraint "usage_events_device_id_devices_id_fk"
  foreign key ("device_id") references "devices"("id") on delete set null;
