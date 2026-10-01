CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"response_status" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"op" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"events" text[] NOT NULL,
	"secret_sealed" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"created_by" text,
	"last_success_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_id_created_at_index" ON "webhook_deliveries" USING btree ("webhook_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_next_attempt_at_index" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webhooks_workspace_id_index" ON "webhooks" USING btree ("workspace_id");--> statement-breakpoint
-- Webhook outbox: every committed change to a transaction (or its splits and tags) in a workspace
-- with a webhook turned on leaves a row here, and a NOTIFY wakes the dispatcher. Soft deletes are
-- "deleted", coming back from the trash is "created", and changes to trashed rows are ignored.
CREATE OR REPLACE FUNCTION capture_transaction_change() RETURNS trigger AS $$
DECLARE
  ws uuid;
  tx uuid;
  change text;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    IF TG_OP = 'INSERT' THEN
      ws := NEW.workspace_id; tx := NEW.id;
      change := CASE WHEN NEW.deleted_at IS NULL THEN 'created' END;
    ELSIF TG_OP = 'UPDATE' THEN
      ws := NEW.workspace_id; tx := NEW.id;
      change := CASE
        WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted'
        WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'created'
        WHEN NEW.deleted_at IS NULL THEN 'updated'
      END;
    ELSE
      ws := OLD.workspace_id; tx := OLD.id;
      change := CASE WHEN OLD.deleted_at IS NULL THEN 'deleted' END;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN tx := OLD.transaction_id; ELSE tx := NEW.transaction_id; END IF;
    -- Gone with its transaction (a cascade) or in the trash: nothing to tell.
    SELECT workspace_id INTO ws FROM transactions WHERE id = tx AND deleted_at IS NULL;
    change := 'updated';
  END IF;

  IF change IS NULL OR ws IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM webhooks w WHERE w.workspace_id = ws AND w.enabled) THEN
    INSERT INTO webhook_outbox (workspace_id, transaction_id, op) VALUES (ws, tx, change);
    PERFORM pg_notify('webhook_outbox', '');
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transactions_webhook_outbox
  AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION capture_transaction_change();
--> statement-breakpoint
CREATE TRIGGER transaction_splits_webhook_outbox
  AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
  FOR EACH ROW EXECUTE FUNCTION capture_transaction_change();
--> statement-breakpoint
CREATE TRIGGER transaction_tags_webhook_outbox
  AFTER INSERT OR UPDATE OR DELETE ON transaction_tags
  FOR EACH ROW EXECUTE FUNCTION capture_transaction_change();
