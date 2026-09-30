CREATE TYPE "public"."recurring_frequency" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."recurring_kind" AS ENUM('expense', 'income', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."recurring_mode" AS ENUM('auto', 'remind');--> statement-breakpoint
CREATE TABLE "recurring" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "recurring_kind" NOT NULL,
	"account_id" uuid NOT NULL,
	"to_account_id" uuid,
	"amount_minor" bigint NOT NULL,
	"to_amount_minor" bigint,
	"variable_amount" boolean DEFAULT false NOT NULL,
	"payee_id" uuid,
	"category_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"tag_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"calendar" "calendar_system" NOT NULL,
	"start_date" date NOT NULL,
	"last_day_of_month" boolean DEFAULT false NOT NULL,
	"next_index" integer DEFAULT 0 NOT NULL,
	"next_date" date,
	"end_date" date,
	"remaining" integer,
	"mode" "recurring_mode" DEFAULT 'remind' NOT NULL,
	"remind_days_before" integer DEFAULT 3 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_posted_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_workspace_id_next_date_index" ON "recurring" USING btree ("workspace_id","next_date");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_id_recurring_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_recurring_id_index" ON "transactions" USING btree ("recurring_id");