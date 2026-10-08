import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { deleteRule, importCsv, setCategory, type ImportReport } from './actions.ts'
import { DEFAULT_SETTINGS, db, exportBackup, restoreBackup, wipeAll, type Settings } from './db.ts'
import {
  averageMonthlySpending,
  latestBalance,
  months,
  stanleyExpectedNetWorth,
  summarizeMonth,
} from './domain/metrics.ts'
import { CATEGORIES, type Category, type Transaction } from './domain/types.ts'

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const pct = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 0 })
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })

export default function App() {
  const txs = useLiveQuery(() => db.transactions.orderBy('datetime').toArray(), [])
  const rules = useLiveQuery(() => db.rules.toArray(), [])
  const settings = useLiveQuery(async () => (await db.settings.get('main')) ?? DEFAULT_SETTINGS, [])
  const [report, setReport] = useState<ImportReport | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const monthList = useMemo(() => (txs ? months(txs) : []), [txs])
  const month = picked && monthList.includes(picked) ? picked : monthList[0]

  if (!txs || !settings || !rules) return null

  async function onFile(file: File) {
    setReport(await importCsv(await file.text()))
  }

  return (
    <div className="app">
      <header>
        <h1>myMoney</h1>
        <div className="actions">
          {monthList.length > 0 && (
            <select value={month} onChange={(e) => setPicked(e.target.value)} aria-label="Mese">
              {monthList.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          )}
          <FileButton label="Importa CSV" accept=".csv,text/csv" onFile={onFile} primary />
        </div>
      </header>

      {report && <ImportBanner report={report} onClose={() => setReport(null)} />}

      {txs.length === 0 ? (
        <EmptyState />
      ) : (
        <Dashboard txs={txs} month={month} settings={settings} />
      )}

      <SettingsPanel settings={settings} rules={rules} />
    </div>
  )
}

function Dashboard({ txs, month, settings }: { txs: Transaction[]; month: string; settings: Settings }) {
  const s = summarizeMonth(txs, month)
  const avgSpend = averageMonthlySpending(txs)
  const balance = latestBalance(txs) ?? 0
  const netWorth = balance + settings.emergencyCurrent + settings.otherAssets
  const emergencyPct = settings.emergencyTarget > 0 ? Math.min(1, settings.emergencyCurrent / settings.emergencyTarget) : 0
  const monthsCovered = avgSpend > 0 ? settings.emergencyCurrent / avgSpend : null
  const maxCat = s.byCategory[0]?.amount ?? 0
  const monthTxs = txs.filter((t) => t.date.startsWith(month)).reverse()

  return (
    <>
      <section className="kpis">
        <Kpi label="Entrate" value={eur.format(s.income)} />
        <Kpi label="Spese" value={eur.format(s.spending)} />
        <Kpi
          label="Tasso di risparmio"
          value={s.savingsRate === null ? '—' : pct.format(s.savingsRate)}
          tone={s.savingsRate === null ? undefined : s.savingsRate >= 0.2 ? 'good' : s.savingsRate < 0 ? 'bad' : 'warn'}
          hint="Obiettivo: almeno 20%"
        />
        <Kpi label="Messo nei salvadanai" value={eur.format(s.movedToSavings)} />
      </section>

      <section className="grid">
        <div className="card">
          <h2>Fondo emergenza</h2>
          <div className="big">
            {eur.format(settings.emergencyCurrent)} <span className="muted">/ {eur.format(settings.emergencyTarget)}</span>
          </div>
          <div className="bar" role="progressbar" aria-valuenow={Math.round(emergencyPct * 100)}>
            <div style={{ width: `${emergencyPct * 100}%` }} />
          </div>
          <p className="muted">
            {monthsCovered === null
              ? 'Importa qualche mese per stimare quanti mesi copre.'
              : `Copre ${monthsCovered.toFixed(1)} mesi delle tue spese medie (${eur.format(avgSpend)}/mese).`}
          </p>
        </div>

        <div className="card">
          <h2>Patrimonio netto</h2>
          <div className="big">{eur.format(netWorth)}</div>
          <ul className="breakdown">
            <li>
              <span>Conto Revolut</span>
              <span>{eur.format(balance)}</span>
            </li>
            <li>
              <span>Fondo emergenza</span>
              <span>{eur.format(settings.emergencyCurrent)}</span>
            </li>
            <li>
              <span>Altro (salvadanai, investimenti)</span>
              <span>{eur.format(settings.otherAssets)}</span>
            </li>
          </ul>
          <StanleyCheck netWorth={netWorth} settings={settings} />
        </div>
      </section>

      <section className="card">
        <h2>Dove vanno i soldi a {monthLabel(month)}</h2>
        {s.byCategory.length === 0 && <p className="muted">Nessuna spesa questo mese.</p>}
        <ul className="cats">
          {s.byCategory.map((c) => (
            <li key={c.category}>
              <span className="cat-name">{c.category}</span>
              <div className="bar small">
                <div style={{ width: `${(c.amount / maxCat) * 100}%` }} />
              </div>
              <span className="cat-amount">{eur.format(c.amount)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Movimenti</h2>
        <p className="muted">Correggi una categoria: ti chiedo se applicarla anche ai movimenti simili, così impara.</p>
        <ul className="txs">
          {monthTxs.map((t) => (
            <TxRow key={t.id} tx={t} />
          ))}
        </ul>
      </section>
    </>
  )
}

function StanleyCheck({ netWorth, settings }: { netWorth: number; settings: Settings }) {
  if (!settings.age || !settings.annualIncome) {
    return <p className="muted">Inserisci età e reddito annuo nelle impostazioni per il confronto col "Milionario della porta accanto".</p>
  }
  const expected = stanleyExpectedNetWorth(settings.age, settings.annualIncome)
  const ratio = expected > 0 ? netWorth / expected : 0
  const verdict = ratio >= 2 ? 'Accumulatore prodigioso' : ratio >= 0.5 ? 'Nella media' : 'Sotto-accumulatore'
  return (
    <p className="muted">
      Formula di Stanley (età × reddito ÷ 10): atteso {eur.format(expected)}. Sei a {pct.format(ratio)}: <strong>{verdict}</strong>.
    </p>
  )
}

function TxRow({ tx }: { tx: Transaction }) {
  async function change(category: Category) {
    const learn = window.confirm(`Applicare "${category}" anche a tutti i movimenti simili a "${tx.description}"?`)
    await setCategory(tx, category, learn)
  }
  return (
    <li>
      <div className="tx-main">
        <span className="tx-desc">{tx.description}</span>
        <span className="muted tx-date">{new Date(`${tx.date}T00:00:00`).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}</span>
      </div>
      <select value={tx.category} onChange={(e) => change(e.target.value as Category)} aria-label="Categoria">
        {CATEGORIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <span className={tx.amount >= 0 ? 'amount pos' : 'amount'}>{eur.format(tx.amount)}</span>
    </li>
  )
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`card kpi ${tone ?? ''}`}>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="muted hint">{hint}</span>}
    </div>
  )
}

function EmptyState() {
  return (
    <section className="card empty">
      <h2>Inizia importando l'estratto conto</h2>
      <ol>
        <li>App Revolut → conto principale → <strong>Estratti conto</strong></li>
        <li>Formato <strong>Excel/CSV</strong>, ultimi 3–6 mesi</li>
        <li>Premi <strong>Importa CSV</strong> qui sopra</li>
      </ol>
      <p className="muted">I dati restano solo in questo browser. Puoi reimportare lo stesso file: i doppioni vengono ignorati.</p>
    </section>
  )
}

function ImportBanner({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  return (
    <div className={`banner ${report.errors.length ? 'warn' : ''}`}>
      <span>
        {report.added} movimenti aggiunti, {report.duplicates} già presenti, {report.skipped} rifiutati/annullati ignorati.
        {report.errors.length > 0 && ` ${report.errors.length} problemi: ${report.errors.slice(0, 3).join(' ')}`}
      </span>
      <button onClick={onClose} aria-label="Chiudi">✕</button>
    </div>
  )
}

function SettingsPanel({ settings, rules }: { settings: Settings; rules: { id?: number; match: string; category: Category }[] }) {
  const save = (patch: Partial<Settings>) => db.settings.put({ ...settings, ...patch })
  const num = (v: string) => (v === '' ? null : Number(v))

  async function download() {
    const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mymoney-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function restore(file: File) {
    if (!window.confirm('Il ripristino sostituisce tutti i dati attuali. Continuare?')) return
    try {
      await restoreBackup(JSON.parse(await file.text()))
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Backup non valido')
    }
  }

  return (
    <details className="card settings">
      <summary>Impostazioni, regole e backup</summary>
      <div className="form">
        <label>
          Saldo fondo emergenza (€)
          <input type="number" inputMode="decimal" value={settings.emergencyCurrent} onChange={(e) => save({ emergencyCurrent: num(e.target.value) ?? 0 })} />
        </label>
        <label>
          Obiettivo fondo emergenza (€)
          <input type="number" inputMode="decimal" value={settings.emergencyTarget} onChange={(e) => save({ emergencyTarget: num(e.target.value) ?? 0 })} />
        </label>
        <label>
          Altri risparmi e investimenti (€)
          <input type="number" inputMode="decimal" value={settings.otherAssets} onChange={(e) => save({ otherAssets: num(e.target.value) ?? 0 })} />
        </label>
        <label>
          Età
          <input type="number" inputMode="numeric" value={settings.age ?? ''} onChange={(e) => save({ age: num(e.target.value) })} />
        </label>
        <label>
          Reddito annuo lordo (€)
          <input type="number" inputMode="decimal" value={settings.annualIncome ?? ''} onChange={(e) => save({ annualIncome: num(e.target.value) })} />
        </label>
      </div>

      <h3>Regole che hai insegnato</h3>
      {rules.length === 0 ? (
        <p className="muted">Nessuna ancora. Si creano quando correggi una categoria.</p>
      ) : (
        <ul className="rules">
          {rules.map((r) => (
            <li key={r.id}>
              <span>
                "{r.match}" → <strong>{r.category}</strong>
              </span>
              <button onClick={() => deleteRule(r.id!)}>Elimina</button>
            </li>
          ))}
        </ul>
      )}

      <h3>Backup</h3>
      <p className="muted">I dati stanno solo in questo browser: se cancelli i dati del sito li perdi. Scarica un backup ogni tanto.</p>
      <div className="actions">
        <button onClick={download}>Scarica backup</button>
        <FileButton label="Ripristina backup" accept="application/json,.json" onFile={restore} />
        <button
          className="danger"
          onClick={() => window.confirm('Cancellare TUTTI i dati? Non si può annullare.') && wipeAll()}
        >
          Cancella tutto
        </button>
      </div>
    </details>
  )
}

function FileButton({ label, accept, onFile, primary }: { label: string; accept: string; onFile: (f: File) => void; primary?: boolean }) {
  return (
    <label className={`button ${primary ? 'primary' : ''}`}>
      {label}
      <input
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </label>
  )
}
