CREATE TABLE "holding_values" (
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value_minor" bigint NOT NULL,
	CONSTRAINT "holding_values_account_id_date_pk" PRIMARY KEY("account_id","date")
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL,
	"price" numeric(24, 8),
	"price_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holding_values" ADD CONSTRAINT "holding_values_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holdings_account_id_index" ON "holdings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "holdings_workspace_id_index" ON "holdings" USING btree ("workspace_id");