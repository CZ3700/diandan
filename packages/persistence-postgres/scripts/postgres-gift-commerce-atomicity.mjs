/** A normal trigger fault after real writes proves the savepoint and outer transaction both roll back. */
export async function verifyGiftCommerceAtomicity({
  client,
  write,
  pricing,
  inventory,
  priceCommand,
  inventoryCommand,
  check,
}) {
  const count = async () =>
    (
      await client.query(`SELECT (SELECT count(*) FROM public.price_books)::int AS books,(SELECT count(*) FROM public.prices)::int AS prices,
 (SELECT count(*) FROM public.gift_price_revision_receipts)::int AS price_receipts,(SELECT count(*) FROM public.gift_inventory_adjustment_receipts)::int AS inventory_receipts,
 (SELECT count(*) FROM public.inventory_ledger)::int AS ledger,(SELECT count(*) FROM public.audit_logs)::int AS audits`)
    ).rows[0];
  for (const [kind, repository, command] of [
    ["price", pricing, priceCommand],
    ["inventory", inventory, inventoryCommand],
  ]) {
    const before = await count();
    await client.query(
      `CREATE FUNCTION public.gift_commerce_test_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_code='COMMERCE_ATOMICITY' THEN RAISE EXCEPTION 'synthetic audit fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END; $$`,
    );
    await client.query(
      "CREATE TRIGGER gift_commerce_test_audit_fault BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.gift_commerce_test_audit_fault()",
    );
    const sameCommand = {
      ...command,
      reasonCode: "COMMERCE_ATOMICITY",
      idempotencyKey: `commerce-atomicity-${kind}`,
    };
    let failed = false;
    try {
      await write(repository, sameCommand);
    } catch (error) {
      failed = error.failure?.error?.code === "UNEXPECTED_ADAPTER_FAILURE";
    } finally {
      await client.query(
        "DROP TRIGGER gift_commerce_test_audit_fault ON public.audit_logs",
      );
      await client.query(
        "DROP FUNCTION public.gift_commerce_test_audit_fault()",
      );
    }
    check(
      failed,
      true,
      `${kind}: fixed audit failure aborts the whole mutation`,
    );
    check(
      await count(),
      before,
      `${kind}: failure leaves no partial data, receipt or audit`,
    );
    check(
      (await write(repository, sameCommand)).outcome,
      "SUCCESS",
      `${kind}: same command succeeds after the failed transaction is removed`,
    );
  }
}
