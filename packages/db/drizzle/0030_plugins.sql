CREATE TABLE IF NOT EXISTS plugins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id text NOT NULL,
  name text NOT NULL,
  version text NOT NULL,
  entrypoint text NOT NULL,
  required_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  optional_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  registered_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT plugins_plugin_id_unique UNIQUE (plugin_id)
);
