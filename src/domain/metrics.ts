import { NON_SPENDING, type Category, type Transaction } from './types.ts'

export interface MonthSummary {
  month: string // YYYY-MM
  income: number
  /** Positive number: what left your pocket for good (refunds already netted). */
  spending: number
  /** Net amount moved into savings this month (can be negative if you dipped in). */
  movedToSavings: number
  /** (income - spending) / income; null when there was no income. */
  savingsRate: number | null
  byCategory: { category: Category; amount: number }[]
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function months(txs: readonly Transaction[]): string[] {
  return [...new Set(txs.map((t) => monthOf(t.date)))].sort().reverse()
}

export function summarizeMonth(txs: readonly Transaction[], month: string): MonthSummary {
  let income = 0
  let movedToSavings = 0
  const spend = new Map<Category, number>()

  for (const t of txs) {
    // Rows from the vault side mirror the main-account transfer; counting both would cancel out.
    if (monthOf(t.date) !== month || isVaultRow(t)) continue
    if (t.category === 'Entrate') income += t.amount
    else if (t.category === 'Risparmio') movedToSavings -= t.amount
    else if (!NON_SPENDING.has(t.category)) spend.set(t.category, (spend.get(t.category) ?? 0) - t.amount)
  }

  const byCategory = [...spend.entries()]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const spending = round2(byCategory.reduce((s, c) => s + c.amount, 0))

  return {
    month,
    income: round2(income),
    spending,
    movedToSavings: round2(movedToSavings),
    savingsRate: income > 0 ? (income - spending) / income : null,
    byCategory,
  }
}

/** Average monthly spending over the last `n` complete months present in the data. */
export function averageMonthlySpending(txs: readonly Transaction[], n = 3): number {
  const list = months(txs).slice(0, n)
  if (list.length === 0) return 0
  return round2(list.reduce((s, m) => s + summarizeMonth(txs, m).spending, 0) / list.length)
}

/** Latest balance reported by the bank on the main account. */
export function latestBalance(txs: readonly Transaction[]): number | null {
  const withBalance = txs.filter((t) => t.balance !== null && !isVaultRow(t))
  if (withBalance.length === 0) return null
  let latest = withBalance[0]
  for (const t of withBalance) if (t.datetime >= latest.datetime) latest = t
  return latest.balance
}

/**
 * "The Millionaire Next Door" rule of thumb: expected net worth =
 * age × annual pre-tax income ÷ 10. Above 2× = prodigious accumulator, below ½× = under-accumulator.
 */
export function stanleyExpectedNetWorth(age: number, annualIncome: number): number {
  return round2((age * annualIncome) / 10)
}

function isVaultRow(t: Transaction): boolean {
  const p = t.product.toLowerCase()
  return p.includes('saving') || p.includes('pocket') || p.includes('risparmio')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
