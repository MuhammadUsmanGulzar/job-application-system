-- Persist ATS analysis before and after agent-assisted resume optimization.
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS ats_score INTEGER CHECK (ats_score BETWEEN 0 AND 100);
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS ats_report JSONB;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS tailored_ats_score INTEGER CHECK (tailored_ats_score BETWEEN 0 AND 100);
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS tailored_ats_report JSONB;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS resume_snapshot TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS tailored_resume_content TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS ats_analyzed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.application_ats_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('before', 'after')),
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    matched_skills TEXT[] NOT NULL DEFAULT '{}',
    missing_skills TEXT[] NOT NULL DEFAULT '{}',
    suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary TEXT,
    resume_name TEXT,
    resume_snapshot TEXT,
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.application_ats_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ATS reports" ON public.application_ats_reports;
CREATE POLICY "Users can view own ATS reports" ON public.application_ats_reports
FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own ATS reports" ON public.application_ats_reports;
CREATE POLICY "Users can insert own ATS reports" ON public.application_ats_reports
FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own ATS reports" ON public.application_ats_reports;
CREATE POLICY "Users can update own ATS reports" ON public.application_ats_reports
FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own ATS reports" ON public.application_ats_reports;
CREATE POLICY "Users can delete own ATS reports" ON public.application_ats_reports
FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_application_ats_reports_app_created
ON public.application_ats_reports(application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_application_ats_reports_user_score
ON public.application_ats_reports(user_id, score DESC);
