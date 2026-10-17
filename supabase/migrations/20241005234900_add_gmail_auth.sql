ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_connected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS google_oauth_state TEXT;
