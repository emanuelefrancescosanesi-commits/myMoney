import { describe, expect, it } from 'vitest'
import { applyRules, categorize, ruleKeyFor } from './categorize.ts'
import { averageMonthlySpending, latestBalance, stanleyExpectedNetWorth, summarizeMonth } from './metrics.ts'
import { parseRevolutCsv, toIsoDate, toNumber } from './revolut.ts'
import type { Transaction } from './types.ts'

const EN_CSV = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TOPUP,Current,2026-09-01 09:00:00,2026-09-01 09:00:05,Payment from Mario Rossi,200.00,0.00,EUR,COMPLETED,250.00
CARD_PAYMENT,Current,2026-09-02 12:00:00,2026-09-03 08:00:00,Esselunga Milano,-23.40,0.00,EUR,COMPLETED,226.60
CARD_PAYMENT,Current,2026-09-04 08:00:00,2026-09-04 08:00:00,Bar Centrale,-1.20,0.00,EUR,COMPLETED,225.40
CARD_PAYMENT,Current,2026-09-04 08:30:00,2026-09-04 08:30:00,Bar Centrale,-1.20,0.00,EUR,COMPLETED,224.20
TRANSFER,Current,2026-09-05 10:00:00,2026-09-05 10:00:00,To pocket EUR Emergenza,-40.00,0.00,EUR,COMPLETED,184.20
CARD_PAYMENT,Current,2026-09-06 10:00:00,,Netflix,-7.99,0.00,EUR,DECLINED,
ATM,Current,2026-09-07 10:00:00,2026-09-07 10:00:00,Cash at Bancomat,-50.00,1.00,EUR,COMPLETED,133.20
`

const IT_CSV = `Tipo;Prodotto;Data di inizio;Data di completamento;Descrizione;Importo;Costo;Valuta;Stato;Saldo
Pagamento con carta;Attuale;05/10/2026 10:00;05/10/2026 10:00;Glovo;-12,50;0,00;EUR;COMPLETATO;1.087,50`

describe('parseRevolutCsv', () => {
  it('reads the English export, skips declined rows and nets fees', () => {
    const r = parseRevolutCsv(EN_CSV)
    expect(r.errors).toEqual([])
    expect(r.skipped).toBe(1)
    expect(r.transactions).toHaveLength(6)
    const atm = r.transactions.find((t) => t.type === 'ATM')!
    expect(atm.amount).toBe(-51)
    expect(r.transactions[1].date).toBe('2026-09-03') // completion date wins
    expect(r.transactions[1].datetime).toBe('2026-09-03 08:00:00')
  })

  it('gives identical same-day rows distinct ids, and stable ids across imports', () => {
    const a = parseRevolutCsv(EN_CSV).transactions
    const b = parseRevolutCsv(EN_CSV).transactions
    expect(new Set(a.map((t) => t.id)).size).toBe(a.length)
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id))
  })

  it('reads an Italian export with semicolons and comma decimals', () => {
    const r = parseRevolutCsv(IT_CSV)
    expect(r.errors).toEqual([])
    expect(r.transactions[0]).toMatchObject({ date: '2026-10-05', amount: -12.5, balance: 1087.5 })
  })

  it('rejects files that are not Revolut exports', () => {
    expect(parseRevolutCsv('foo,bar\n1,2').errors[0]).toMatch(/Revolut/)
  })
})

describe('number and date parsing', () => {
  it.each([
    ['1234.56', 1234.56],
    ['-12,50', -12.5],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['', null],
    ['abc', null],
  ])('toNumber(%s)', (input, expected) => expect(toNumber(input)).toBe(expected))

  it('normalizes dates', () => {
    expect(toIsoDate('2026-01-02 10:00:00')).toBe('2026-01-02')
    expect(toIsoDate('2/1/2026')).toBe('2026-01-02')
    expect(toIsoDate('yesterday')).toBeNull()
  })
})

describe('categorize', () => {
  const raw = (description: string, amount: number, type = 'CARD_PAYMENT', product = 'Current') => ({
    id: 'x', date: '2026-09-01', datetime: '2026-09-01 00:00:00', description, amount, currency: 'EUR', type, product, balance: null,
  })

  it('uses defaults, longest match first', () => {
    expect(categorize(raw('Esselunga Milano', -10), [])).toBe('Spesa')
    expect(categorize(raw('Amazon Prime*AB12', -4.99), [])).toBe('Abbonamenti')
    expect(categorize(raw('Amazon.it*XY', -20), [])).toBe('Shopping')
  })

  it('does not match short keywords inside other words', () => {
    expect(categorize(raw('Timberland', -80), [])).toBe('Altro')
  })

  it('handles structural cases', () => {
    expect(categorize(raw('To pocket EUR Emergenza', -40, 'TRANSFER'), [])).toBe('Risparmio')
    expect(categorize(raw('Exchanged to USD', -10, 'EXCHANGE'), [])).toBe('Interno')
    expect(categorize(raw('Cash', -50, 'ATM'), [])).toBe('Contanti')
    expect(categorize(raw('Payment from Mario', 100, 'TOPUP'), [])).toBe('Entrate')
    expect(categorize(raw('Payment from Lavoro Pizzeria', 300, 'TRANSFER'), [])).toBe('Entrate')
    expect(categorize(raw('From pocket EUR Emergenza', 20, 'TRANSFER'), [])).toBe('Risparmio')
    expect(categorize(raw('Zalando refund', 39.9, 'CARD_REFUND'), [])).toBe('Shopping')
  })

  it('lets user rules override defaults', () => {
    expect(categorize(raw('Esselunga Milano', -10), [{ match: 'esselunga', category: 'Casa' }])).toBe('Casa')
  })

  it('keeps manual categories when re-applying rules', () => {
    const tx: Transaction = { ...raw('Esselunga', -10), category: 'Svago', manualCategory: true }
    expect(applyRules([tx], [])[0].category).toBe('Svago')
  })

  it('builds rule keys without card numbers or dates', () => {
    expect(ruleKeyFor('ESSELUNGA 1234 MILANO')).toBe('esselunga milano')
    expect(ruleKeyFor('Glovo*12/09 Order')).toBe('glovo order')
  })
})

describe('metrics', () => {
  const txs: Transaction[] = parseRevolutCsv(EN_CSV).transactions.map((t) => ({ ...t, category: categorize(t, []) }))

  it('summarizes a month', () => {
    const s = summarizeMonth(txs, '2026-09')
    expect(s.income).toBe(200)
    expect(s.movedToSavings).toBe(40)
    expect(s.spending).toBe(23.4 + 2.4 + 51)
    expect(s.savingsRate).toBeCloseTo((200 - 76.8) / 200)
    expect(s.byCategory[0]).toEqual({ category: 'Contanti', amount: 51 })
  })

  it('returns a null savings rate with no income', () => {
    expect(summarizeMonth(txs, '2025-01').savingsRate).toBeNull()
  })

  it('computes average spending and latest balance', () => {
    expect(averageMonthlySpending(txs)).toBe(76.8)
    expect(latestBalance(txs)).toBe(133.2)
  })

  it('applies the Millionaire Next Door formula', () => {
    expect(stanleyExpectedNetWorth(20, 6000)).toBe(12000)
  })
})

describe('vault rows', () => {
  it('ignores the vault side of a transfer so savings are not cancelled out', () => {
    const csv = `${EN_CSV}TRANSFER,Savings,2026-09-05 10:00:00,2026-09-05 10:00:00,From EUR Current,40.00,0.00,EUR,COMPLETED,40.00\n`
    const txs = parseRevolutCsv(csv).transactions.map((t) => ({ ...t, category: categorize(t, []) }))
    expect(summarizeMonth(txs, '2026-09').movedToSavings).toBe(40)
    expect(latestBalance(txs)).toBe(133.2)
  })
})
