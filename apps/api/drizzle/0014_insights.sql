ALTER TYPE "public"."notification_kind" ADD VALUE 'insight';--> statement-breakpoint
CREATE TABLE "insight_dismissals" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_dismissals_workspace_id_user_id_key_pk" PRIMARY KEY("workspace_id","user_id","key")
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "insights" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "insight_dismissals" ADD CONSTRAINT "insight_dismissals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_dismissals" ADD CONSTRAINT "insight_dismissals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;