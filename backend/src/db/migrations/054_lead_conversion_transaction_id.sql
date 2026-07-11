-- Store the payment-provider transaction/reference identifier for a conversion.
ALTER TABLE lead_conversion
  ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_lead_conversion_transaction_id
  ON lead_conversion(transaction_id)
  WHERE transaction_id IS NOT NULL;
