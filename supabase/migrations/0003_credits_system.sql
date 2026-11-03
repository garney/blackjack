CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'credits_balance'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN credits_balance numeric(12, 2) NOT NULL DEFAULT 0 CHECK (credits_balance >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_transaction_kind') THEN
    CREATE TYPE public.credit_transaction_kind AS ENUM (
      'deposit', 'withdrawal', 'adjustment', 'buy_in', 'payout', 'fee'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  amount_credits numeric(12, 2) NOT NULL,
  kind public.credit_transaction_kind NOT NULL,
  description text NOT NULL,
  table_id text,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_transactions_user_id_created_at_idx
  ON public.credit_transactions (user_id, created_at DESC);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_transactions_select_own ON public.credit_transactions;
CREATE POLICY credit_transactions_select_own ON public.credit_transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.adjust_credits(p_user_id uuid, p_delta numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_balance numeric;
BEGIN
  UPDATE public.profiles
  SET credits_balance = credits_balance + p_delta
  WHERE id = p_user_id
    AND credits_balance + p_delta >= 0
  RETURNING credits_balance INTO next_balance;

  IF next_balance IS NULL THEN
    RAISE EXCEPTION 'Not enough credits';
  END IF;

  RETURN next_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_credits(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_credits(uuid, numeric) TO service_role;
