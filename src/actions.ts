import { db } from './db.ts'
import { applyRules, categorize, ruleKeyFor } from './domain/categorize.ts'
import { parseRevolutCsv } from './domain/revolut.ts'
import type { Category, Transaction } from './domain/types.ts'

export interface ImportReport {
  added: number
  duplicates: number
  skipped: number
  errors: string[]
}

export async function importCsv(text: string): Promise<ImportReport> {
  const { transactions, skipped, errors } = parseRevolutCsv(text)
  const rules = await db.rules.toArray()

  return db.transaction('rw', db.transactions, async () => {
    const existing = new Set((await db.transactions.bulkGet(transactions.map((t) => t.id))).filter(Boolean).map((t) => t!.id))
    // Never overwrite rows already imported: they may carry a category you fixed by hand.
    const fresh: Transaction[] = transactions
      .filter((t) => !existing.has(t.id))
      .map((t) => ({ ...t, category: categorize(t, rules) }))
    await db.transactions.bulkAdd(fresh)
    return { added: fresh.length, duplicates: transactions.length - fresh.length, skipped, errors }
  })
}

/**
 * Changes one transaction's category. With `learn`, also saves a rule so every
 * similar past and future transaction gets the same category automatically.
 */
export async function setCategory(tx: Transaction, category: Category, learn: boolean): Promise<void> {
  await db.transaction('rw', db.transactions, db.rules, async () => {
    await db.transactions.update(tx.id, { category, manualCategory: true })
    if (!learn) return
    const match = ruleKeyFor(tx.description)
    const existing = await db.rules.where('match').equals(match).first()
    if (existing) await db.rules.update(existing.id!, { category })
    else await db.rules.add({ match, category })
    await recategorizeAll()
  })
}

export async function deleteRule(id: number): Promise<void> {
  await db.transaction('rw', db.transactions, db.rules, async () => {
    await db.rules.delete(id)
    await recategorizeAll()
  })
}

async function recategorizeAll(): Promise<void> {
  const [txs, rules] = await Promise.all([db.transactions.toArray(), db.rules.toArray()])
  await db.transactions.bulkPut(applyRules(txs, rules))
}
