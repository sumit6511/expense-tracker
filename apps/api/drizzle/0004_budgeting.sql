CREATE TYPE "public"."goal_kind" AS ENUM('account', 'category', 'manual');--> statement-breakpoint
CREATE TYPE "public"."budget_rollover" AS ENUM('none', 'surplus', 'all');--> statement-breakpoint
CREATE TABLE "budget_caps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "goal_kind" NOT NULL,
	"target_minor" bigint NOT NULL,
	"target_date" date,
	"account_id" uuid,
	"category_id" uuid,
	"saved_minor" bigint DEFAULT 0 NOT NULL,
	"icon" text DEFAULT 'piggy-bank' NOT NULL,
	"color" text DEFAULT '#0f766e' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "budget_rollover" "budget_rollover" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "rollover_since" date;--> statement-breakpoint
ALTER TABLE "budget_caps" ADD CONSTRAINT "budget_caps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_caps_workspace_id_period_start_index" ON "budget_caps" USING btree ("workspace_id","period_start");--> statement-breakpoint
CREATE INDEX "goals_workspace_id_index" ON "goals" USING btree ("workspace_id");