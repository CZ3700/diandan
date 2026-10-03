SET search_path=public;
-- Only the backoff position is lost; recovery then retries at the fixed delay again.
ALTER TABLE public.payment_runtime_operations DROP COLUMN defer_count;
