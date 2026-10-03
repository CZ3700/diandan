SET search_path=public;
-- Audit PAY-01: consecutive provider deferrals of one payment recovery. Each deferral doubles the next
-- wait (capped at one hour); any recorded provider result resets it. `generation` cannot serve: every
-- claim advances it, including successful reconciles while a fan is still on the hosted page.
ALTER TABLE public.payment_runtime_operations
 ADD COLUMN defer_count integer NOT NULL DEFAULT 0
 CONSTRAINT payment_runtime_operations_defer_count_check CHECK(defer_count>=0);
