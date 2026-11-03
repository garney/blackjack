CREATE TABLE IF NOT EXISTS public.credit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  amount_credits numeric(12, 2) NOT NULL CHECK (amount_credits > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  request_reason text NOT NULL,
  admin_note text,
  reviewed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = check_user_id
  );
$$;

ALTER TABLE public.credit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_requests_select_own ON public.credit_requests;
CREATE POLICY credit_requests_select_own ON public.credit_requests
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS credit_requests_insert_own ON public.credit_requests;
CREATE POLICY credit_requests_insert_own ON public.credit_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS credit_requests_admin ON public.credit_requests;
CREATE POLICY credit_requests_admin ON public.credit_requests
  FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS credit_requests_touch_updated_at ON public.credit_requests;
CREATE TRIGGER credit_requests_touch_updated_at
  BEFORE UPDATE ON public.credit_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
