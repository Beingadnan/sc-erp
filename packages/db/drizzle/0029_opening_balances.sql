ALTER TABLE "fee_payments" DROP CONSTRAINT "fee_payments_mode_chk";--> statement-breakpoint
ALTER TABLE "setup_imports" ADD COLUMN "kind" text DEFAULT 'setup' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_mode_chk" CHECK ("fee_payments"."mode" in ('cash', 'cheque', 'dd', 'upi', 'card', 'bank_transfer', 'online', 'opening'));--> statement-breakpoint
ALTER TABLE "setup_imports" ADD CONSTRAINT "setup_imports_kind_chk" CHECK ("setup_imports"."kind" in ('setup', 'opening'));