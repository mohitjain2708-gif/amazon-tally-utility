# Amazon Sales to Tally XML Utility

This is a local browser utility for converting Amazon GST MTR B2B/B2C CSV reports into TallyPrime Sales Voucher XML.

## How to Use

1. Run `node static-server.js 59231`.
2. Open `http://127.0.0.1:59231/` in a browser.
3. Upload the Amazon GST MTR CSV report.
4. Confirm Tally ledger names and SKU-to-stock-item mappings.
5. Click `Validate & Preview`.
6. Download `amazon-sales-tally.xml`.
7. In TallyPrime, import it as transaction XML under `Import > Transactions`.

## Public Hosting on Vercel

This app is a static browser utility. The CSV is processed in the user's browser, and the generated XML is downloaded locally.

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
- Voucher type generated: Sales.
- Included rows: `Transaction Type = Shipment`.
- Skipped rows: `Refund` and `Cancel`, shown in the validation report.
- Party ledger can be auto-detected: B2B uses `B2B Amazon Sales`, B2C uses `B2C Amazon Sales`.
- Sales ledger is selected by the user and applied to every inventory allocation.
- B2B buyer name and GSTIN are still written into buyer/consignee/GST fields where available.

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
