const els = {
  dropZone: document.querySelector("[data-drop-zone]"),
  pdfDropZone: document.querySelector("[data-pdf-drop-zone]"),
  fileInput: document.querySelector("#fileInput"),
  pdfZipInput: document.querySelector("#pdfZipInput"),
  fileName: document.querySelector("[data-file-name]"),
  pdfFileName: document.querySelector("[data-pdf-file-name]"),
  pdfSummary: document.querySelector("[data-pdf-summary]"),
  csvUploadStatus: document.querySelector("[data-csv-upload-status]"),
  pdfUploadStatus: document.querySelector("[data-pdf-upload-status]"),
  processButton: document.querySelector("#processButton"),
  status: document.querySelector("[data-status]"),
  summary: document.querySelector("[data-summary]"),
  readyLabel: document.querySelector("[data-ready-label]"),
  readiness: document.querySelector("[data-readiness]"),
  validationSummary: document.querySelector("[data-validation-summary]"),
  validationCard: document.querySelector("[data-validation-card]"),
  previewBody: document.querySelector("[data-preview-body]"),
  issuesBody: document.querySelector("[data-issues-body]"),
  xmlButton: document.querySelector("#downloadXml"),
  reportButton: document.querySelector("#downloadReport"),
  historyCsvInput: document.querySelector("#historyCsvInput"),
  daybookInput: document.querySelector("#daybookInput"),
  analyzeHistoryButton: document.querySelector("#analyzeHistoryButton"),
  applyMappingButton: document.querySelector("#applyMappingButton"),
  downloadMappingButton: document.querySelector("#downloadMappingButton"),
  learningSummary: document.querySelector("[data-learning-summary]"),
  configForm: document.querySelector("#configForm"),
};

let currentSalesFiles = [];
let currentPdfFiles = [];
let currentAddressIndex = null;
let currentResult = null;
let currentLearnedMapping = null;

function setStatus(message, tone = "neutral") {
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

function renderEmptyState() {
  els.summary.innerHTML = `
    <div class="metric range-metric"><span>Voucher date range</span><strong>Upload files</strong><small>Waiting for sales data</small></div>
    <div class="metric"><span>Total vouchers</span><strong>0</strong><small>Sales & refund vouchers</small></div>
    <div class="metric"><span>Sales vouchers</span><strong>0</strong><small>Ready after validation</small></div>
    <div class="metric"><span>Refund / Credit Note</span><strong>0</strong><small>Ready after validation</small></div>
    <div class="metric"><span>PDF address coverage</span><strong>0</strong><small>Upload ZIP/PDF for full address</small></div>
  `;
  els.previewBody.innerHTML = '<tr><td colspan="11" class="empty">Upload Excel/CSV files and validate them to see voucher details here.</td></tr>';
  els.issuesBody.innerHTML = '<tr><td colspan="4" class="empty">Validation messages will appear here after preview.</td></tr>';
  if (els.readyLabel) els.readyLabel.textContent = "(Waiting for upload)";
  if (els.readiness) els.readiness.innerHTML = `${statusIcon()} Upload Amazon Excel/CSV files, add invoice ZIP/PDF files if available, then validate to generate XML.`;
  renderValidationSummary(0, 0, 0);
}

function readConfig() {
  const formData = new FormData(els.configForm);
  return {
    partyLedgerMode: formData.get("partyLedgerMode"),
    partyLedgerName: formData.get("partyLedgerName").trim(),
    b2bPartyLedgerName: formData.get("b2bPartyLedgerName").trim(),
    partyLedgerPrefix: formData.get("partyLedgerPrefix").trim(),
    voucherType: formData.get("voucherType").trim(),
    refundVoucherType: formData.get("refundVoucherType").trim(),
    companyName: formData.get("companyName").trim(),
    gstRegistrationName: formData.get("gstRegistrationName").trim(),
    companyGstState: formData.get("companyGstState").trim(),
    invoiceSuffix: formData.get("invoiceSuffix").trim(),
    salesLedgerName: formData.get("salesLedgerName").trim(),
    cgstLedgerName: formData.get("cgstLedgerName").trim(),
    sgstLedgerName: formData.get("sgstLedgerName").trim(),
    igstLedgerName: formData.get("igstLedgerName").trim(),
    roundOffLedgerName: formData.get("roundOffLedgerName").trim(),
    unitName: formData.get("unitName").trim() || "Nos",
    stockNameMode: formData.get("stockNameMode"),
    stockMapText: formData.get("stockMapText").trim(),
    godownPattern: formData.get("godownPattern").trim(),
    batchName: formData.get("batchName").trim(),
    includeBillAllocations: formData.get("includeBillAllocations") === "on",
  };
}

function plural(count, singular, pluralText = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

function statusIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.8 12.5 2.1 2.1 4.4-4.6"></path><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"></path></svg>';
}

function selectedFilesLabel(files, emptyLabel) {
  if (!files.length) return emptyLabel;
  if (files.length === 1) return files[0].name;
  return `${files[0].name} + ${files.length - 1} more`;
}

function selectSalesFiles(files) {
  currentSalesFiles = Array.from(files || []).filter((file) => /\.(csv|xlsx|xls)$/i.test(file.name));
  currentResult = null;
  els.fileName.textContent = selectedFilesLabel(currentSalesFiles, "Choose Excel / CSV files");
  els.dropZone.classList.toggle("has-file", currentSalesFiles.length > 0);
  els.processButton.disabled = !currentSalesFiles.length;
  els.xmlButton.disabled = true;
  els.reportButton.disabled = true;
  renderEmptyState();
  if (els.csvUploadStatus) {
    els.csvUploadStatus.innerHTML = currentSalesFiles.length
      ? `${statusIcon()} ${plural(currentSalesFiles.length, "sales file")} selected`
      : `${statusIcon()} Waiting for Excel/CSV files`;
  }
  setStatus(currentSalesFiles.length ? "Ready to validate and generate preview." : "Upload Amazon Excel/CSV files to begin.");
}

function selectPdfFiles(files) {
  currentPdfFiles = Array.from(files || []).filter((file) => /\.(zip|pdf)$/i.test(file.name));
  currentAddressIndex = null;
  els.pdfFileName.textContent = selectedFilesLabel(currentPdfFiles, "Choose ZIP / PDF files");
  els.pdfDropZone.classList.toggle("has-file", currentPdfFiles.length > 0);
  els.pdfSummary.textContent = currentPdfFiles.length
    ? "Invoice PDFs will be parsed during validation and merged by invoice/order number."
    : "Used for complete Bill To and Ship To addresses";
  if (els.pdfUploadStatus) {
    els.pdfUploadStatus.innerHTML = currentPdfFiles.length
      ? `${statusIcon()} ${plural(currentPdfFiles.length, "invoice file")} selected`
      : `${statusIcon()} Optional, but recommended`;
  }
  currentResult = null;
  els.xmlButton.disabled = true;
  els.reportButton.disabled = true;
}

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsArrayBuffer(file);
  });
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
}

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

async function readSalesFileAsCsv(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    if (!window.XLSX) throw new Error("Excel parser library is not loaded.");
    const workbook = XLSX.read(await readFileAsArrayBuffer(file), { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error(`${file.name} has no worksheet.`);
    return XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
  }
  return readFileAsText(file);
}

async function readSalesFilesAsCsvText(files) {
  const csvTexts = await Promise.all(files.map(readSalesFileAsCsv));
  const parsedFiles = csvTexts.map((text, index) => {
    const rows = parseCsvRows(text);
    if (!rows.length) throw new Error(`${files[index].name} has no rows.`);
    return { headers: rows[0].map((header) => String(header).trim()), rows: rows.slice(1) };
  });

  const headers = [];
  parsedFiles.forEach((fileData) => {
    fileData.headers.forEach((header) => {
      if (header && !headers.includes(header)) headers.push(header);
    });
  });

  const mergedRows = [headers];
  parsedFiles.forEach((fileData) => {
    fileData.rows.forEach((row) => {
      const record = {};
      fileData.headers.forEach((header, columnIndex) => {
        record[header] = row[columnIndex] == null ? "" : row[columnIndex];
      });
      mergedRows.push(headers.map((header) => record[header] || ""));
    });
  });

  return rowsToCsv(mergedRows);
}

function setField(name, value) {
  const field = els.configForm.elements[name];
  if (!field || value == null) return;
  field.value = value;
}

function applyLearnedMapping(config) {
  [
    "voucherType",
    "refundVoucherType",
    "companyName",
    "invoiceSuffix",
    "partyLedgerMode",
    "partyLedgerName",
    "b2bPartyLedgerName",
    "salesLedgerName",
    "cgstLedgerName",
    "sgstLedgerName",
    "igstLedgerName",
    "unitName",
    "stockNameMode",
    "stockMapText",
    "godownPattern",
  ].forEach((name) => setField(name, config[name]));
}

function renderLearningSummary(result) {
  els.learningSummary.innerHTML = `
    <strong>${result.summary.matchedRows}</strong> matched rows,
    <strong>${result.summary.learnedItemMappings}</strong> item mappings,
    <strong>${result.summary.tallySalesVouchers}</strong> Tally Sales vouchers found.
    <br>
    Learned: ${escapeHtml(result.config.voucherType)}, refunds ${escapeHtml(result.config.refundVoucherType)}, B2B ${escapeHtml(result.config.b2bPartyLedgerName)}, B2C ${escapeHtml(result.config.partyLedgerName)}, ${escapeHtml(result.config.salesLedgerName)}.
  `;
}

function renderSummary(summary, errors = [], warnings = []) {
  const salesCount = summary.salesVoucherCount ?? summary.voucherCount;
  const refundCount = summary.refundVoucherCount || 0;
  const pdfCount = summary.pdfAddressVoucherCount || 0;
  const pdfCoverage = summary.voucherCount ? `${pdfCount} / ${summary.voucherCount}` : "0";
  const salesPercent = summary.voucherCount ? `${((salesCount / summary.voucherCount) * 100).toFixed(1)}% of total` : "Ready after validation";
  const refundPercent = summary.voucherCount ? `${((refundCount / summary.voucherCount) * 100).toFixed(1)}% of total` : "Ready after validation";

  const cards = [
    ["Voucher date range", summary.voucherDateRange || "Not available", summary.voucherDateRange ? `${summary.voucherCount} voucher dates` : "No date found", "range-metric"],
    ["Total vouchers", summary.voucherCount || summary.totalRows || 0, "Sales & refund vouchers"],
    ["Sales vouchers", salesCount, salesPercent, "sales-metric"],
    ["Refund / Credit Note", refundCount, refundPercent, "refund-metric"],
    ["PDF address coverage", pdfCoverage, summary.voucherCount ? `${summary.voucherCount ? ((pdfCount / summary.voucherCount) * 100).toFixed(0) : 0}% matched from PDFs` : "Upload ZIP/PDF for full address", "pdf-metric"],
  ];

  els.summary.innerHTML = cards
    .map(([label, value, caption, className]) => `<div class="metric ${className || ""}"><span>${label}</span><strong>${value}</strong><small>${caption}</small></div>`)
    .join("");

  if (els.readyLabel) els.readyLabel.textContent = errors.length ? "(Needs review)" : "(Ready to generate XML)";
  if (els.readiness) {
    const message = errors.length
      ? `${errors.length} error(s) must be fixed before XML download.`
      : pdfCount && summary.voucherCount && pdfCount === summary.voucherCount
        ? "Great! All vouchers will include complete Bill To and Ship To addresses from invoice PDFs."
        : "Preview is ready. Upload invoice PDFs for any missing complete Bill To and Ship To addresses.";
    els.readiness.innerHTML = `${statusIcon()} ${message}`;
    els.readiness.dataset.tone = errors.length ? "bad" : "good";
  }
  renderValidationSummary(summary.voucherCount || 0, warnings.length, errors.length);
}

function renderPreview(rows) {
  els.previewBody.innerHTML = rows.length
    ? rows
    .slice(0, 100)
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.date)}</td>
          <td><span class="pill ${row.type === "Refund" ? "bad" : "good"}">${escapeHtml(row.type)}</span></td>
          <td>${escapeHtml(row.invoiceNo)}</td>
          <td>${escapeHtml(row.orderId || row.reference || "")}</td>
          <td>${escapeHtml(row.partyLedger)}</td>
          <td class="num">${row.items}</td>
          <td class="num">${row.taxable}</td>
          <td class="num">${row.total}</td>
          <td><span class="pill ${row.addressSource === "PDF" ? "good" : "warn"}" title="${escapeHtml(row.addressPdfFile || "CSV fallback address")}">${escapeHtml(row.addressSource || "CSV")}</span></td>
          <td class="item-cell" title="${escapeHtml(row.amazonDescriptions || "No Amazon product description available")}">${escapeHtml(row.tallyItems)}</td>
          <td>${escapeHtml(row.gstin)}</td>
        </tr>
      `
    )
    .join("")
    : '<tr><td colspan="11" class="empty">No vouchers were generated from these files.</td></tr>';
}

function renderValidationSummary(successCount, warningCount, errorCount) {
  if (els.validationSummary) {
    els.validationSummary.innerHTML = `
      <div><span class="dot good"></span>Success <strong>${successCount}</strong></div>
      <div><span class="dot warn"></span>Warnings <strong>${warningCount}</strong></div>
      <div><span class="dot bad"></span>Errors <strong>${errorCount}</strong></div>
    `;
  }
  if (els.validationCard) {
    const hasIssues = warningCount || errorCount;
    els.validationCard.dataset.tone = errorCount ? "bad" : hasIssues ? "warn" : "good";
    els.validationCard.innerHTML = errorCount
      ? `${statusIcon()} <div><strong>Needs correction</strong><span>${errorCount} error(s) must be fixed before XML generation.</span></div>`
      : hasIssues
        ? `${statusIcon()} <div><strong>Ready with warnings</strong><span>XML can be generated, but review ${warningCount} warning(s).</span></div>`
        : `${statusIcon()} <div><strong>${successCount ? "All good!" : "Waiting for validation"}</strong><span>${successCount ? "Your data is clean and ready to generate XML." : "We will show errors and warnings here."}</span></div>`;
  }
}

function renderIssues(errors, warnings) {
  const rows = [...errors, ...warnings].sort((a, b) => (a.row || 0) - (b.row || 0));
  els.issuesBody.innerHTML = rows.length
    ? rows
        .map(
          (issue) => `
          <tr>
            <td>${issue.row || ""}</td>
            <td>${escapeHtml(issue.invoiceNo || "")}</td>
            <td><span class="pill ${issue.severity === "Error" ? "bad" : "warn"}">${issue.severity}</span></td>
            <td>${escapeHtml(issue.message)}</td>
          </tr>
        `
        )
        .join("")
    : '<tr><td colspan="4" class="empty">No validation issues found.</td></tr>';
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function ensureAddressIndex() {
  if (!currentPdfFiles.length) return null;
  if (currentAddressIndex) return currentAddressIndex;
  if (!window.AmazonTallyPdfAddresses) throw new Error("PDF address parser is not available.");

  currentAddressIndex = await AmazonTallyPdfAddresses.extractFromZipFiles(currentPdfFiles, ({ processed, total }) => {
    setStatus(`Reading invoice PDFs ${processed}/${total}...`);
    els.pdfSummary.textContent = `Parsed ${processed} of ${total} PDF invoice files.`;
  });
  const summary = currentAddressIndex.summary;
  const sourceSummary = [
    summary.zipCount ? plural(summary.zipCount, "ZIP") : "",
    summary.directPdfCount ? plural(summary.directPdfCount, "PDF") : "",
  ].filter(Boolean).join(" + ");
  els.pdfSummary.textContent = `${summary.parsedPdfCount} invoice PDF(s) parsed from ${sourceSummary || "selected files"}. ${summary.missingAddressCount} PDF(s) need address review.`;
  if (els.pdfUploadStatus) {
    els.pdfUploadStatus.innerHTML = `${statusIcon()} ${summary.parsedPdfCount} invoice PDF(s) ready`;
  }
  return currentAddressIndex;
}

async function processFile() {
  if (!currentSalesFiles.length) return;
  try {
    setStatus("Reading sales files...");
    els.processButton.disabled = true;
    const [csvText, addressIndex] = await Promise.all([readSalesFilesAsCsvText(currentSalesFiles), ensureAddressIndex()]);
    const config = readConfig();
    if (addressIndex) config.addressIndex = addressIndex;
    currentResult = AmazonTallyConverter.convertCsvText(csvText, config);
    renderSummary(currentResult.summary, currentResult.errors, currentResult.warnings);
    renderPreview(currentResult.preview);
    renderIssues(currentResult.errors, currentResult.warnings);

    const hasErrors = currentResult.errors.length > 0;
    els.xmlButton.disabled = hasErrors || !currentResult.xml;
    els.reportButton.disabled = !currentResult.reportCsv;
    setStatus(
      hasErrors
        ? `Found ${currentResult.errors.length} error(s). Fix them before importing into Tally.`
        : `Generated ${currentResult.summary.voucherCount} voucher(s), including ${currentResult.summary.refundVoucherCount || 0} refund voucher(s), with ${currentResult.summary.pdfAddressVoucherCount || 0} PDF address match(es).`,
      hasErrors ? "bad" : "good"
    );
  } catch (error) {
    setStatus(`Could not process file: ${error.message}`, "bad");
    els.xmlButton.disabled = true;
    els.reportButton.disabled = true;
  } finally {
    els.processButton.disabled = !currentSalesFiles.length;
  }
}

els.fileInput.addEventListener("change", (event) => selectSalesFiles(event.target.files));
els.pdfZipInput.addEventListener("change", (event) => selectPdfFiles(event.target.files));
els.processButton.addEventListener("click", processFile);

els.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropZone.classList.add("dragging");
});

els.dropZone.addEventListener("dragleave", () => {
  els.dropZone.classList.remove("dragging");
});

els.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropZone.classList.remove("dragging");
  if (event.dataTransfer.files.length) selectSalesFiles(event.dataTransfer.files);
});

els.pdfDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.pdfDropZone.classList.add("dragging");
});

els.pdfDropZone.addEventListener("dragleave", () => {
  els.pdfDropZone.classList.remove("dragging");
});

els.pdfDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.pdfDropZone.classList.remove("dragging");
  if (event.dataTransfer.files.length) selectPdfFiles(event.dataTransfer.files);
});

els.xmlButton.addEventListener("click", () => {
  if (!currentResult || !currentResult.xml) return;
  downloadText("amazon-sales-tally.xml", currentResult.xml, "application/xml;charset=utf-8");
});

els.reportButton.addEventListener("click", () => {
  if (!currentResult || !currentResult.reportCsv) return;
  downloadText("amazon-sales-import-report.csv", currentResult.reportCsv, "text/csv;charset=utf-8");
});

els.analyzeHistoryButton.addEventListener("click", async () => {
  const csvFiles = Array.from(els.historyCsvInput.files || []);
  const [daybookFile] = Array.from(els.daybookInput.files || []);

  if (!csvFiles.length || !daybookFile) {
    els.learningSummary.textContent = "Select at least one Amazon CSV and one Tally DayBook XML.";
    return;
  }

  try {
    els.learningSummary.textContent = "Analyzing historical data...";
    const csvTexts = await Promise.all(csvFiles.map(readFileAsText));
    const daybookText = await readFileAsText(daybookFile);
    currentLearnedMapping = AmazonTallyTrainer.analyzeMappings(csvTexts, daybookText);
    renderLearningSummary(currentLearnedMapping);
    els.applyMappingButton.disabled = false;
    els.downloadMappingButton.disabled = false;
  } catch (error) {
    els.learningSummary.textContent = `Could not analyze history: ${error.message}`;
    els.applyMappingButton.disabled = true;
    els.downloadMappingButton.disabled = true;
  }
});

els.applyMappingButton.addEventListener("click", () => {
  if (!currentLearnedMapping) return;
  applyLearnedMapping(currentLearnedMapping.config);
  setStatus("Learned mapping applied to the import setup.", "good");
});

els.downloadMappingButton.addEventListener("click", () => {
  if (!currentLearnedMapping) return;
  downloadText(
    "amazon-tally-learned-mapping.json",
    JSON.stringify(currentLearnedMapping.config, null, 2),
    "application/json;charset=utf-8"
  );
});

if (window.AMAZON_TALLY_LEARNED_MAPPING) {
  currentLearnedMapping = {
    config: window.AMAZON_TALLY_LEARNED_MAPPING,
    summary: { matchedRows: 239, learnedItemMappings: 22, tallySalesVouchers: 322 },
  };
  applyLearnedMapping(window.AMAZON_TALLY_LEARNED_MAPPING);
  els.downloadMappingButton.disabled = false;
}

setStatus("Upload Amazon Excel/CSV files to begin.");
renderEmptyState();
