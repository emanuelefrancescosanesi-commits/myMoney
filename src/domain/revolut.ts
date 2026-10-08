import Papa from 'papaparse'
import type { Transaction } from './types.ts'

export type RawTransaction = Omit<Transaction, 'category' | 'manualCategory'>

export interface ParseResult {
  transactions: RawTransaction[]
  /** Rows dropped on purpose (declined, reverted, pending). */
  skipped: number
  /** Rows that could not be read, with the reason. */
  errors: string[]
}

type Field = 'type' | 'product' | 'started' | 'completed' | 'description' | 'amount' | 'fee' | 'currency' | 'state' | 'balance'

// Revolut exports headers in the app language; accept English and Italian.
const HEADER_ALIASES: Record<Field, string[]> = {
  type: ['type', 'tipo'],
  product: ['product', 'prodotto'],
  started: ['started date', 'data di inizio'],
  completed: ['completed date', 'data di completamento', 'data completamento'],
  description: ['description', 'descrizione'],
  amount: ['amount', 'importo'],
  fee: ['fee', 'commissione', 'costo', 'tariffa'],
  currency: ['currency', 'valuta'],
  state: ['state', 'stato'],
  balance: ['balance', 'saldo'],
}

const REQUIRED: Field[] = ['description', 'amount']

// Anything not listed here is kept, so unknown localized states don't silently drop money.
const SKIPPED_STATES = new Set(['declined', 'reverted', 'failed', 'pending', 'rifiutato', 'stornato', 'non riuscito', 'in sospeso'])

export function parseRevolutCsv(text: string): ParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true })
  const [header, ...rows] = parsed.data
  if (!header) return { transactions: [], skipped: 0, errors: ['Il file è vuoto.'] }

  const columns = mapColumns(header)
  const missing = REQUIRED.filter((f) => columns[f] === undefined)
  if (missing.length > 0 || (columns.completed === undefined && columns.started === undefined)) {
    return {
      transactions: [],
      skipped: 0,
      errors: [`Non sembra un estratto conto Revolut: colonne trovate "${header.join(', ')}".`],
    }
  }

  const transactions: RawTransaction[] = []
  const errors: string[] = []
  let skipped = 0
  const seen = new Map<string, number>()

  rows.forEach((row, i) => {
    const get = (f: Field) => (columns[f] === undefined ? '' : (row[columns[f]] ?? '').trim())
    const lineNo = i + 2

    if (SKIPPED_STATES.has(get('state').toLowerCase())) {
      skipped++
      return
    }

    const when = get('completed') || get('started')
    const date = toIsoDate(when)
    const amount = toNumber(get('amount'))
    const fee = toNumber(get('fee') || '0')
    if (!date || amount === null || fee === null) {
      errors.push(`Riga ${lineNo}: data o importo non leggibili.`)
      return
    }

    const balanceRaw = get('balance')
    const base = [date, get('description'), get('amount'), get('currency'), get('type'), get('product'), balanceRaw].join('|')
    // Two identical rows on the same day are legitimate (two coffees); number them.
    const occurrence = (seen.get(base) ?? 0) + 1
    seen.set(base, occurrence)

    transactions.push({
      id: hash(`${base}|${occurrence}`),
      date,
      datetime: `${date} ${toTime(when)}`,
      description: get('description'),
      amount: round2(amount - fee),
      currency: get('currency') || 'EUR',
      type: get('type').toUpperCase(),
      product: get('product'),
      balance: balanceRaw ? toNumber(balanceRaw) : null,
    })
  })

  return { transactions, skipped, errors }
}

function mapColumns(header: string[]): Partial<Record<Field, number>> {
  const normalized = header.map((h) => h.trim().toLowerCase())
  const result: Partial<Record<Field, number>> = {}
  for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
    const idx = normalized.findIndex((h) => HEADER_ALIASES[field].includes(h))
    if (idx >= 0) result[field] = idx
  }
  return result
}

/** Accepts "2024-03-05 10:11:12", "2024-03-05", "05/03/2024" and "05/03/2024 10:11". */
export function toIsoDate(value: string): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const eu = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
  if (eu) return `${eu[3]}-${eu[2].padStart(2, '0')}-${eu[1].padStart(2, '0')}`
  return null
}

function toTime(value: string): string {
  const t = value.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  return t ? `${t[1].padStart(2, '0')}:${t[2]}:${t[3] ?? '00'}` : '00:00:00'
}

/** Accepts "1234.56", "-12,50", "1.234,56" and "1,234.56". */
export function toNumber(value: string): number | null {
  let v = value.replace(/[\s€$£]/g, '')
  if (v === '') return null
  const lastComma = v.lastIndexOf(',')
  const lastDot = v.lastIndexOf('.')
  if (lastComma > lastDot) v = v.replace(/\./g, '').replace(',', '.')
  else v = v.replace(/,/g, '')
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Two FNV-1a passes with different seeds: 64 bits keeps collisions negligible for years of rows.
function hash(s: string): string {
  return fnv1a(s, 0x811c9dc5) + fnv1a(s, 0x01000193)
}

function fnv1a(s: string, seed: number): string {
  let h = seed
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36).padStart(7, '0')
}
