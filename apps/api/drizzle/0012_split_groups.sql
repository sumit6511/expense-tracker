CREATE TYPE "public"."split_method" AS ENUM('equal', 'exact', 'percent', 'shares');--> statement-breakpoint
CREATE TABLE "split_expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"paid_by_member_id" uuid NOT NULL,
	"method" "split_method" NOT NULL,
	"linked_transaction_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"simplify_debts" boolean DEFAULT true NOT NULL,
	"category_id" uuid,
	"created_by" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"date" date NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"linked_transaction_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_shares" (
	"expense_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"value" integer,
	CONSTRAINT "split_shares_expense_id_member_id_pk" PRIMARY KEY("expense_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "split_expenses" ADD CONSTRAINT "split_expenses_group_id_split_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."split_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expenses" ADD CONSTRAINT "split_expenses_paid_by_member_id_split_members_id_fk" FOREIGN KEY ("paid_by_member_id") REFERENCES "public"."split_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expenses" ADD CONSTRAINT "split_expenses_linked_transaction_id_transactions_id_fk" FOREIGN KEY ("linked_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expenses" ADD CONSTRAINT "split_expenses_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_groups" ADD CONSTRAINT "split_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_groups" ADD CONSTRAINT "split_groups_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_groups" ADD CONSTRAINT "split_groups_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_members" ADD CONSTRAINT "split_members_group_id_split_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."split_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_members" ADD CONSTRAINT "split_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlements" ADD CONSTRAINT "split_settlements_group_id_split_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."split_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlements" ADD CONSTRAINT "split_settlements_from_member_id_split_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."split_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlements" ADD CONSTRAINT "split_settlements_to_member_id_split_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."split_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlements" ADD CONSTRAINT "split_settlements_linked_transaction_id_transactions_id_fk" FOREIGN KEY ("linked_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlements" ADD CONSTRAINT "split_settlements_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_shares" ADD CONSTRAINT "split_shares_expense_id_split_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."split_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_shares" ADD CONSTRAINT "split_shares_member_id_split_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."split_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "split_expenses_group_id_date_index" ON "split_expenses" USING btree ("group_id","date");--> statement-breakpoint
CREATE INDEX "split_groups_workspace_id_index" ON "split_groups" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "split_members_group_id_index" ON "split_members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "split_members_group_id_user_id_index" ON "split_members" USING btree ("group_id","user_id") WHERE "split_members"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "split_settlements_group_id_date_index" ON "split_settlements" USING btree ("group_id","date");--> statement-breakpoint
CREATE INDEX "split_shares_member_id_index" ON "split_shares" USING btree ("member_id");