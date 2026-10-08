import type { RawTransaction } from './revolut.ts'
import type { Category, Rule, Transaction } from './types.ts'

/** Starting rules for common Italian merchants. User rules always win over these. */
export const DEFAULT_RULES: readonly Rule[] = [
  ...words('Spesa', ['esselunga', ' coop', 'conad', 'lidl', 'eurospin', 'carrefour', ' pam ', 'penny', 'aldi', 'md spa', 'despar', ' tigre', ' iper', 'bennet', 'famila', 'crai']),
  ...words('Cibo fuori', ['mcdonald', 'burger king', 'kfc', 'glovo', 'just eat', 'deliveroo', 'uber eats', 'starbucks', ' bar ', 'caffe', 'caffè', 'pizzeria', 'ristorante', 'sushi', 'autogrill', 'old wild west', 'poke']),
  ...words('Trasporti', ['trenitalia', 'italo', 'atm milano', 'atac', 'gtt', 'tper', 'flixbus', 'uber', 'free now', 'freenow', ' bolt ', ' lime ', ' dott ', 'q8', ' eni ', 'enilive', ' ip ', 'tamoil', 'esso', 'telepass', 'autostrade', 'ryanair', 'easyjet', 'wizz']),
  ...words('Abbonamenti', ['netflix', 'spotify', 'disney', 'prime video', 'amazon prime', 'dazn', 'youtube', 'apple.com', 'icloud', 'google one', 'chatgpt', 'openai', 'anthropic', 'claude', 'iliad', 'ho. mobile', 'ho mobile', 'vodafone', ' tim ', 'windtre', 'fastweb', 'very mobile', 'playstation', 'xbox', 'nintendo']),
  ...words('Shopping', ['amazon', 'zalando', 'shein', 'temu', 'aliexpress', 'ebay', 'vinted', 'decathlon', 'zara', 'h&m', 'primark', 'mediaworld', 'unieuro', 'ikea', 'foot locker', 'nike', 'adidas']),
  ...words('Svago', ['cinema', ' uci ', 'the space', 'steam', 'epic games', 'ticketone', 'vivaticket', 'palestra', 'mcfit', 'virgin active']),
  ...words('Salute', ['farmacia', 'parafarmacia', 'ospedale', 'dentist', ' medic']),
  ...words('Istruzione', ['universit', 'feltrinelli', 'mondadori', 'libreria', 'udemy', 'coursera']),
  ...words('Risparmio', ['to pocket', 'from pocket', 'pocket withdrawal', 'salvadanaio', 'vault', 'savings', 'arrotondamento', 'round up', 'round-up']),
]

function words(category: Category, list: string[]): Rule[] {
  return list.map((match) => ({ match, category }))
}

export function normalize(description: string): string {
  return ` ${description.toLowerCase().replace(/\s+/g, ' ').trim()} `
}

/**
 * Picks a category. Order matters: structural signals (internal moves, cash)
 * first, then user rules, then defaults, then income/other by sign.
 */
export function categorize(tx: RawTransaction, userRules: readonly Rule[]): Category {
  const type = tx.type.toUpperCase()
  const product = tx.product.toLowerCase()

  if (type === 'EXCHANGE') return 'Interno'
  if (product.includes('saving') || product.includes('pocket') || product.includes('risparmio')) return 'Risparmio'
  if (type === 'ATM') return 'Contanti'

  const text = normalize(tx.description)
  const userHit = findRule(text, userRules)
  if (userHit) return userHit.category
  const defaultHit = findRule(text, DEFAULT_RULES)

  // Money in that isn't a refund is income, even from a "pizzeria" you work at.
  if (tx.amount > 0 && !type.includes('REFUND')) return defaultHit?.category === 'Risparmio' ? 'Risparmio' : 'Entrate'
  return defaultHit?.category ?? 'Altro'
}

// Longest match wins, so "amazon prime" beats "amazon".
function findRule(text: string, rules: readonly Rule[]): Rule | undefined {
  let best: Rule | undefined
  for (const r of rules) {
    if (text.includes(r.match) && (!best || r.match.length > best.match.length)) best = r
  }
  return best
}

/** Re-runs rules on every transaction except the ones the user fixed by hand. */
export function applyRules(txs: readonly Transaction[], userRules: readonly Rule[]): Transaction[] {
  return txs.map((tx) => (tx.manualCategory ? tx : { ...tx, category: categorize(tx, userRules) }))
}

/**
 * Turns a description into a reusable rule key: drops card numbers, dates and
 * reference codes so "Esselunga 1234 Milano" and "Esselunga 987 Milano" match.
 */
export function ruleKeyFor(description: string): string {
  const cleaned = description
    .toLowerCase()
    .replace(/[*#]/g, ' ')
    .replace(/\b\d[\d\-/.:]*\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const firstWords = cleaned.split(' ').slice(0, 2).join(' ')
  return firstWords || description.toLowerCase().trim()
}
