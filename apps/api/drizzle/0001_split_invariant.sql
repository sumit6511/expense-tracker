-- Ledger invariant, checked at commit time (deferred) so a transaction and its splits can be
-- written in any order within one database transaction:
--   * a regular transaction has at least one split, and its splits add up to its amount;
--   * a transfer leg (transfer_group_id set) has no splits.
CREATE OR REPLACE FUNCTION check_transaction_splits() RETURNS trigger AS $$
DECLARE
  tx_id uuid;
  tx_amount bigint;
  tx_transfer uuid;
  split_count integer;
  split_sum bigint;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    tx_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    tx_id := OLD.transaction_id;
  ELSE
    tx_id := NEW.transaction_id;
  END IF;

  SELECT amount_minor, transfer_group_id INTO tx_amount, tx_transfer
    FROM transactions WHERE id = tx_id;
  IF NOT FOUND THEN
    RETURN NULL; -- the transaction itself was deleted; its splits went with it
  END IF;

  SELECT count(*), coalesce(sum(amount_minor), 0) INTO split_count, split_sum
    FROM transaction_splits WHERE transaction_id = tx_id;

  IF tx_transfer IS NOT NULL THEN
    IF split_count <> 0 THEN
      RAISE EXCEPTION 'transfer transaction % must not have splits', tx_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'transaction_splits_balance';
    END IF;
  ELSIF split_count = 0 OR split_sum <> tx_amount THEN
    RAISE EXCEPTION 'splits of transaction % add up to % but the amount is %', tx_id, split_sum, tx_amount
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transaction_splits_balance';
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_splits_balance
  AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_transaction_splits();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_splits_balance
  AFTER INSERT OR UPDATE OF amount_minor, transfer_group_id ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_transaction_splits();
