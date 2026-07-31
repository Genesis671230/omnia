// lib/inventory/apply-event.ts — the ONLY function that writes to inventory_master
export async function applyInventoryEvent(evt: {
    sku: string;
    delta: number;
    source: InventorySource;
    source_ref: string;
    reason?: string;
  }): Promise<{ newQty: number; syncId: string }> {
    return await db.transaction(async (tx) => {
      // 1. Idempotency check — same source_ref twice = no-op
      const existing = await tx.query(
        `SELECT id FROM inventory_events WHERE source = $1 AND source_ref = $2`,
        [evt.source, evt.source_ref]
      );
      if (existing.rows.length) {
        return { newQty: /* current */, syncId: /* existing */, skipped: true };
      }
  
      // 2. Append event
      const eventId = await tx.query(
        `INSERT INTO inventory_events (sku, delta, source, source_ref, reason)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [evt.sku, evt.delta, evt.source, evt.source_ref, evt.reason]
      );
  
      // 3. Mutate master (with row lock to prevent race)
      const { rows: [row] } = await tx.query(
        `UPDATE inventory_master
           SET qty_on_hand = qty_on_hand + $1,
               updated_at = now(),
               updated_by = $2
         WHERE sku = $3
         RETURNING qty_on_hand`,
        [evt.delta, evt.source + ':' + evt.source_ref, evt.sku]
      );
  
      // 4. Mark event applied
      await tx.query(`UPDATE inventory_events SET applied_at = now() WHERE id = $1`, [eventId]);
  
      // 5. Mark ALL listed channels as pending
      await tx.query(
        `UPDATE inventory_sync_state
           SET sync_state = 'pending'
         WHERE sku = $1 AND listed = true`,
        [evt.sku]
      );
  
      // 6. Enqueue push jobs (outside the tx would be safer — see note below)
      const syncId = await enqueuePushJobs(evt.sku, row.qty_on_hand);
  
      return { newQty: row.qty_on_hand, syncId };
    });
  }