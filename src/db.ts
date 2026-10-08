import Dexie, { type EntityTable } from 'dexie'
import type { Rule, Transaction } from './domain/types.ts'

export interface Settings {
  key: 'main'
  emergencyTarget: number
  /** Balance of the emergency vault, typed in by hand (the CSV covers the main account only). */
  emergencyCurrent: number
  /** Everything else you own: other vaults, investments, cash. */
  otherAssets: number
  age: number | null
  annualIncome: number | null
}

export const DEFAULT_SETTINGS: Settings = {
  key: 'main',
  emergencyTarget: 1000,
  emergencyCurrent: 0,
  otherAssets: 0,
  age: null,
  annualIncome: null,
}

// Everything lives in the browser (IndexedDB): no server ever sees your bank data.
export const db = new Dexie('mymoney') as Dexie & {
  transactions: EntityTable<Transaction, 'id'>
  rules: EntityTable<Rule, 'id'>
  settings: EntityTable<Settings, 'key'>
}

db.version(1).stores({
  transactions: 'id, date, datetime, category',
  rules: '++id, &match',
  settings: 'key',
})

export interface Backup {
  version: 1
  exportedAt: string
  transactions: Transaction[]
  rules: Rule[]
  settings: Settings[]
}

export async function exportBackup(): Promise<Backup> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions: await db.transactions.toArray(),
    rules: await db.rules.toArray(),
    settings: await db.settings.toArray(),
  }
}

export async function restoreBackup(b: Backup): Promise<void> {
  if (b.version !== 1 || !Array.isArray(b.transactions)) throw new Error('Backup non valido')
  await db.transaction('rw', db.transactions, db.rules, db.settings, async () => {
    await Promise.all([db.transactions.clear(), db.rules.clear(), db.settings.clear()])
    await db.transactions.bulkPut(b.transactions)
    await db.rules.bulkPut(b.rules)
    await db.settings.bulkPut(b.settings)
  })
}

export async function wipeAll(): Promise<void> {
  await Promise.all([db.transactions.clear(), db.rules.clear(), db.settings.clear()])
}
