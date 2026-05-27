-- Run this in the Supabase SQL editor after creating your project.
-- Supabase Auth manages auth.users; this schema extends it with app data.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── User profiles ────────────────────────────────────────────────────────────
CREATE TABLE public.users (
  id                              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                           text UNIQUE NOT NULL,
  plan                            text NOT NULL DEFAULT 'basic',
  xactimate_credentials_encrypted text,        -- AES-256 encrypted; never store plaintext
  created_at                      timestamptz NOT NULL DEFAULT now()
);

-- Auto-create a user profile row when a new Supabase Auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Jobs ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.jobs (
  id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status           text        NOT NULL DEFAULT 'uploading',
  address          text,
  description      text,
  vm_instance_name text,
  vm_ip            text,
  retry_count      integer     NOT NULL DEFAULT 0,
  estimate_file_id uuid,       -- set when agent uploads estimate.pdf; references files(id)
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

-- Auto-update updated_at on every jobs row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Files ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.files (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  filename      text        NOT NULL,
  gcs_key       text        NOT NULL,
  file_type     text,
  size_bytes    integer,
  malware_clean boolean,               -- null = scan pending, true = clean, false = infected
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Job events (append-only agent log) ───────────────────────────────────────
CREATE TABLE public.job_events (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id     uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  event_type text        NOT NULL,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_profile"    ON public.users      FOR ALL USING (auth.uid() = id);
CREATE POLICY "users_own_jobs"       ON public.jobs       FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_files"      ON public.files      FOR ALL USING (
  job_id IN (SELECT id FROM public.jobs WHERE user_id = auth.uid())
);
CREATE POLICY "users_own_job_events" ON public.job_events FOR ALL USING (
  job_id IN (SELECT id FROM public.jobs WHERE user_id = auth.uid())
);

-- ── Migrations: run these against an existing Supabase instance ──────────────
-- ALTER TABLE public.users DROP COLUMN IF EXISTS docusign_access_token;
-- ALTER TABLE public.users DROP COLUMN IF EXISTS docusign_refresh_token;
-- ALTER TABLE public.users DROP COLUMN IF EXISTS docusign_account_id;
-- ALTER TABLE public.users DROP COLUMN IF EXISTS docusign_base_uri;
-- ALTER TABLE public.jobs  DROP COLUMN IF EXISTS docusign_envelope_id;
-- ALTER TABLE public.jobs  DROP COLUMN IF EXISTS docusign_fallback_pdf_path;
-- ALTER TABLE public.jobs  ADD COLUMN IF NOT EXISTS estimate_file_id uuid;
-- ALTER TABLE public.jobs  ADD COLUMN IF NOT EXISTS vm_ip text;
