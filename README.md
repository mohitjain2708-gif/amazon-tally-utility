# Amazon Sales to Tally XML Utility

This is a browser utility for converting Amazon GST MTR B2B/B2C CSV reports into TallyPrime Sales Voucher XML. It can also read Amazon Bulk Invoice ZIP files to enrich vouchers with complete Bill To and Ship To addresses from the invoice PDFs. A settlement module can generate Tally Journal XML from the enriched Amazon settlement Excel workbook.

## How to Use

1. Serve the folder locally, for example `python -m http.server 59231`.
2. Open `http://127.0.0.1:59231/` in a browser.
3. Upload the Amazon GST MTR CSV report.
4. Upload one or more Amazon Bulk Invoice ZIP files if full addresses are required.
5. Confirm Tally ledger names and SKU-to-stock-item mappings.
6. Click `Validate & Preview`.
7. Download the accounting preview report if you want to review the expected debit/credit postings before import.
8. Download `amazon-sales-tally.xml`.
9. In TallyPrime, import it as transaction XML under `Import > Transactions`.

## Settlement Journal XML

Use the `Settlement XML` section for Amazon payout accounting after sales and credit note vouchers are imported.

1. Upload the enriched Amazon settlement Excel workbook.
2. Confirm the Journal voucher type and settlement ledgers.
3. Click `Validate Settlement`.
4. Review payout, sales clearing, fees, TCS, TDS, and order count.
5. Optionally choose a smaller settlement date range.
6. Download the audit report if review items appear.
7. Download the accounting preview report to review voucher-wise debit/credit postings.
8. Download `amazon-settlement-tally.xml`.

The enriched workbook should include the user-added `transaction` column (`B2B` / `B2C`) and `GST` column. These fields are used to split clearing entries between `B2B Amazon Sales` and `B2C Amazon Sales`.

## Public Hosting on Vercel

This app is a static browser utility. CSV, ZIP, and PDF invoice files are processed in the user's browser, and the generated XML is downloaded locally.

Recommended Vercel setup:

1. Push this repository to GitHub.
2. Create a new Vercel project.
3. Set the Vercel Root Directory to `amazon-tally-utility`.
4. Framework preset: `Other`.
5. Build command: `npm run build`.
6. Output directory: leave blank / project root.
7. Deploy.

The `.vercelignore` file excludes generated XML/report/test folders so private accounting data is not deployed.

Important for public trials:

- Do not upload real customer/accounting files unless you trust the browser/device being used.
- Company name is blank by default so Tally imports into the company currently open in TallyPrime.
- Users must still import the downloaded file in Tally as XML/Data Interchange, not Excel.

## Current Scope

- Source formats: Amazon GST MTR B2C CSV and B2B CSV.
- Optional address source: Amazon Bulk Invoice ZIP files containing invoice PDFs.
- Voucher type generated: Sales.
- Included rows: `Transaction Type = Shipment` and `Transaction Type = Refund`.
- Refund rows are generated as Tally `Amazon Cr. Note` vouchers by default, using Amazon `Credit Note No` as voucher number and the original invoice number as reference.
- Skipped rows: unsupported transaction types such as `Cancel`, shown in the validation report.
- Party ledger can be auto-detected: B2B uses `B2B Amazon Sales`, B2C uses `B2C Amazon Sales`.
- Sales ledger is selected by the user and applied to every inventory allocation.
- B2B buyer name and GSTIN are still written into buyer/consignee/GST fields where available.
- When matching invoice PDFs are uploaded, PDF Bill To and Ship To address blocks override the incomplete CSV address fields in the generated XML.
- Settlement XML is generated as Tally `Journal` vouchers. It clears Amazon sales ledgers and records payout, Amazon fee ledgers, TCS receivable, TDS receivable, reimbursements, and other charges. Reimbursements are netted into the BLR Amazon seller ledger by default to match the learned Tally voucher pattern.
- Settlement review items are exported as an audit-style CSV with severity, issue code, settlement ID, voucher date, affected orders, affected amount, assumption applied, accounting impact, and fix steps.
- Accounting preview CSVs are available for both sales/credit note XML and settlement XML. These reports show the voucher-wise ledgers, debit amounts, credit amounts, bill/order references, and basis so users can review the expected Tally posting before importing XML.

## Tally Notes

The following masters should already exist in TallyPrime:

- Sales voucher type.
- Party ledgers, such as `Amazon B2C - Uttar Pradesh`.
- Sales ledger, such as `Sales GST 18%`.
- GST ledgers, such as `Output IGST 18%`.
- Stock items matching SKU, ASIN, or selected stock naming mode.
- Unit, such as `Nos`.

Important: the Sales ledger used for item vouchers must have inventory values enabled in Tally (`AFFECTSSTOCK = Yes` / inventory values are affected). If it is disabled, Tally may import the voucher accounting entries but drop the item allocation.

For best compatibility, create one representative Sales Voucher manually in the target Tally company, export it as XML, then compare tags with the generated XML.

## CLI Test

```powershell
node .\amazon-tally-utility\cli.js "C:\Users\yasht\Downloads\GST_MTR_B2C_CUSTOM-A1WETBUGIK7MZ8-2026_04_13-2026_04_19.csv"
```

The CLI writes XML, report CSV, and summary JSON into `amazon-tally-utility/output`.

## Learn Mappings From History

Use the browser section `Learn from historical Tally data`, or run:

```powershell
node .\amazon-tally-utility\analyze-history.js "C:\Users\yasht\Downloads\DayBook.xml" .\amazon-tally-utility\learned-output "C:\Users\yasht\Downloads\GST_MTR_B2B_CUSTOM-A1WETBUGIK7MZ8-2026_04_04-2026_05_18.csv" "C:\Users\yasht\Downloads\GST_MTR_B2C_CUSTOM-A1WETBUGIK7MZ8-2026_04_04-2026_05_18.csv"
```

This creates:

- `learned-mapping.json` for reusable import settings.
- `mapping-analysis.json` for full diagnostics.
- `matched-vouchers.csv` for audit/review.

## Automated TallyPrime Smoke Test

If TallyPrime is open with a test company loaded and XML integration is enabled on port `9000`, run:

```powershell
node .\amazon-tally-utility\tally-smoke-test.js "C:\Users\yasht\Downloads\GST_MTR_B2B_CUSTOM-A1WETBUGIK7MZ8-2026_04_04-2026_05_18.csv" 3
```

The smoke test creates a tiny Educational Mode-safe XML dated `01/04/2026`, posts required masters to TallyPrime, posts the test vouchers, exports the vouchers back from Tally, and verifies the important read-back fields: voucher number, date, reference, buyer order, party ledger, GSTIN, stock item, godown, quantity, taxable value, tax ledgers/amounts, total, bill allocation, buyer/consignee fields, and place of supply.
