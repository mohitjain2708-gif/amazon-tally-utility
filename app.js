const els = {
  dropZone: document.querySelector("[data-drop-zone]"),
  pdfDropZone: document.querySelector("[data-pdf-drop-zone]"),
  fileInput: document.querySelector("#fileInput"),
  pdfZipInput: document.querySelector("#pdfZipInput"),
  fileName: document.querySelector("[data-file-name]"),
  pdfFileName: document.querySelector("[data-pdf-file-name]"),
  pdfSummary: document.querySelector("[data-pdf-summary]"),
  processButton: document.querySelector("#processButton"),
  status: document.querySelector("[data-status]"),
  summary: document.querySelector("[data-summary]"),
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

let currentFile = null;
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
    <div class="metric"><span>Total transactions</span><strong>0</strong></div>
    <div class="metric"><span>Sales vouchers</span><strong>0</strong></div>
    <div class="metric"><span>Refund vouchers</span><strong>0</strong></div>
    <div class="metric"><span>PDF addresses</span><strong>0</strong></div>
    <div class="metric"><span>Issues found</span><strong>0</strong></div>
    <div class="metric"><span>Net total</span><strong>0.00</strong></div>
  `;
  els.previewBody.innerHTML = '<tr><td colspan="14" class="empty">Upload a CSV and validate it to see voucher details here.</td></tr>';
  els.issuesBody.innerHTML = '<tr><td colspan="4" class="empty">Validation messages will appear here after preview.</td></tr>';
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

function selectFile(file) {
  currentFile = file;
  currentResult = null;
  els.fileName.textContent = file ? file.name : "No file selected";
  els.dropZone.classList.toggle("has-file", Boolean(file));
  els.processButton.disabled = !file;
  els.xmlButton.disabled = true;
  els.reportButton.disabled = true;
  renderEmptyState();
  setStatus(file ? "Ready to validate and generate preview." : "Upload an Amazon GST MTR CSV to begin.");
}

function selectPdfFiles(files) {
  currentPdfFiles = Array.from(files || []).filter((file) => /\.zip$/i.test(file.name));
  currentAddressIndex = null;
  els.pdfFileName.textContent = currentPdfFiles.length
    ? `${currentPdfFiles.length} ZIP file${currentPdfFiles.length === 1 ? "" : "s"} selected`
    : "No ZIP selected";
  els.pdfDropZone.classList.toggle("has-file", currentPdfFiles.length > 0);
  els.pdfSummary.textContent = currentPdfFiles.length
    ? "Invoice PDFs will be parsed during validation and merged by invoice/order number."
    : "PDF extraction runs locally in this browser before XML generation.";
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
  const cards = [
    ["Total transactions", summary.totalRows],
    ["Sales vouchers", summary.salesVoucherCount ?? summary.voucherCount],
    ["Refund vouchers", summary.refundVoucherCount || 0],
    ["PDF addresses", summary.pdfAddressVoucherCount || 0],
    ["Issues found", errors.length + warnings.length],
    ["Net total", AmazonTallyConverter.formatAmount(summary.invoiceTotal)],
  ];

  els.summary.innerHTML = cards
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderPreview(rows) {
  els.previewBody.innerHTML = rows.length
    ? rows
    .slice(0, 100)
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.invoiceNo)}</td>
          <td>${escapeHtml(row.type)}</td>
          <td>${escapeHtml(row.voucherNo)}</td>
          <td>${escapeHtml(row.date)}</td>
          <td>${escapeHtml(row.partyLedger)}</td>
          <td>${escapeHtml(row.gstin)}</td>
          <td class="item-cell" title="${escapeHtml(row.amazonDescriptions || "No Amazon product description available")}">${escapeHtml(row.tallyItems)}</td>
          <td><span class="pill ${row.addressSource === "PDF" ? "good" : "warn"}" title="${escapeHtml(row.addressPdfFile || "CSV fallback address")}">${escapeHtml(row.addressSource || "CSV")}</span></td>
          <td class="num">${row.items}</td>
          <td class="num">${row.taxable}</td>
          <td class="num">${row.cgst}</td>
          <td class="num">${row.sgst}</td>
          <td class="num">${row.igst}</td>
          <td class="num">${row.total}</td>
        </tr>
      `
    )
    .join("")
    : '<tr><td colspan="14" class="empty">No vouchers were generated from this file.</td></tr>';
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
  els.pdfSummary.textContent = `${summary.parsedPdfCount} PDF invoice(s) parsed from ${summary.zipCount} ZIP file(s). ${summary.missingAddressCount} PDF(s) need address review.`;
  return currentAddressIndex;
}

async function processFile() {
  if (!currentFile) return;
  try {
    setStatus("Reading CSV file...");
    els.processButton.disabled = true;
    const [csvText, addressIndex] = await Promise.all([readFileAsText(currentFile), ensureAddressIndex()]);
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
    els.processButton.disabled = !currentFile;
  }
}

els.fileInput.addEventListener("change", (event) => selectFile(event.target.files[0]));
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
  const [file] = event.dataTransfer.files;
  if (file) selectFile(file);
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

setStatus("Upload an Amazon GST MTR CSV to begin.");
renderEmptyState();
