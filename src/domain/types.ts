export type Category =
  | 'Entrate'
  | 'Spesa'
  | 'Cibo fuori'
  | 'Trasporti'
  | 'Abbonamenti'
  | 'Shopping'
  | 'Svago'
  | 'Salute'
  | 'Casa'
  | 'Istruzione'
  | 'Contanti'
  | 'Risparmio'
  | 'Interno'
  | 'Altro'

export const CATEGORIES: readonly Category[] = [
  'Entrate',
  'Spesa',
  'Cibo fuori',
  'Trasporti',
  'Abbonamenti',
  'Shopping',
  'Svago',
  'Salute',
  'Casa',
  'Istruzione',
  'Contanti',
  'Risparmio',
  'Interno',
  'Altro',
]

/** Categories that move money between your own accounts: neither income nor spending. */
export const NON_SPENDING: ReadonlySet<Category> = new Set(['Entrate', 'Risparmio', 'Interno'])

export interface Transaction {
  /** Stable hash of the source row, so re-importing the same CSV never duplicates. */
  id: string
  /** ISO date, YYYY-MM-DD (completion date when available). */
  date: string
  /** Sortable timestamp, YYYY-MM-DD HH:MM:SS, used to order rows within a day. */
  datetime: string
  description: string
  /** Signed amount net of fees: negative = money out. */
  amount: number
  currency: string
  /** Raw Revolut type, e.g. CARD_PAYMENT, TOPUP, TRANSFER. */
  type: string
  /** Raw Revolut product, e.g. Current, Savings. */
  product: string
  /** Account balance after this row, when the export has it. */
  balance: number | null
  category: Category
  /** True when the user picked the category by hand; rules never overwrite it. */
  manualCategory?: boolean
}

export interface Rule {
  id?: number
  /** Lowercase substring matched against the normalized description. */
  match: string
  category: Category
}
