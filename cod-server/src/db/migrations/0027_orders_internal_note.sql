-- Merchant-private order note, editable from the dashboard orders list.
-- Never sent to carriers: dispatch adapters only read orders.notes
-- (customer/carrier remarks). This column is dashboard-only.
ALTER TABLE `orders` ADD `internal_note` text;
