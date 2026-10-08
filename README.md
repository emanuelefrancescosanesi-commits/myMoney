# myMoney

App personale per gestire i soldi: importa l'estratto conto Revolut, categorizza da sola, mostra **tasso di risparmio**, **fondo emergenza** e **patrimonio netto**.

**Local-first:** i dati restano nel browser (IndexedDB). Nessun server, nessun account. Fai backup dalle impostazioni.

## Avvio

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # test del dominio (parser, categorie, metriche)
npm run build    # build statica in dist/
```

Per provarla senza dati veri: importa `samples/revolut-esempio.csv`.

## Come funziona

| Cartella | Cosa fa |
|---|---|
| `src/domain/revolut.ts` | Legge il CSV Revolut (intestazioni EN/IT, `,` o `;`, decimali con virgola). Scarta movimenti rifiutati/annullati, sottrae le commissioni, genera id stabili per non duplicare se reimporti. |
| `src/domain/categorize.ts` | Regole: casi strutturali (cambio valuta, salvadanai, prelievi) → regole tue → regole predefinite per negozi italiani. Le entrate restano entrate anche se la descrizione somiglia a un negozio. |
| `src/domain/metrics.ts` | Riepilogo mensile, spesa media, saldo, formula del *Milionario della porta accanto* (età × reddito ÷ 10). |
| `src/db.ts` | Database locale (Dexie), backup/ripristino JSON. |
| `src/App.tsx` | Dashboard. Correggendo una categoria l'app propone di creare una regola per tutti i movimenti simili. |

## Roadmap

1. ~~Sistema automatico su Revolut~~ (guida, fuori dall'app)
2. **MVP**: import CSV, categorie, dashboard ← qui
3. Sync automatica via open banking, avvisi di budget
4. Modulo investimenti (PAC ETF) e proiezioni di interesse composto
