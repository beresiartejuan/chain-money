-- Custom SQL migration file, put your code below! --
SELECT 1;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transactions_no_update
BEFORE UPDATE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions are immutable');
END;
