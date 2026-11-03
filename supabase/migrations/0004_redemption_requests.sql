CREATE TABLE IF NOT EXISTS public.redemption_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  amount_credits numeric(12, 2) NOT NULL CHECK (amount_credits > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  claim_details text NOT NULL,
  admin_note text,
  reviewed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS redemption_requests_user_id_created_at_idx
  ON public.redemption_requests (user_id, created_at DESC);

ALTER TABLE public.redemption_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS redemption_requests_select_own ON public.redemption_requests;
CREATE POLICY redemption_requests_select_own ON public.redemption_requests
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS redemption_requests_touch_updated_at ON public.redemption_requests;
CREATE TRIGGER redemption_requests_touch_updated_at
  BEFORE UPDATE ON public.redemption_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
