/* TDMS UV Output Comparator
   Static browser app for PowerMAP TDMS files.
   Parses TDMS metadata/properties in the browser and exports a single Excel sheet.
*/

const TDMS_TYPE = Object.freeze({
  INT8: 0x01,
  INT16: 0x02,
  INT32: 0x03,
  INT64: 0x04,
  UINT8: 0x05,
  UINT16: 0x06,
  UINT32: 0x07,
  UINT64: 0x08,
  SINGLE: 0x09,
  DOUBLE: 0x0A,
  STRING: 0x20,
  BOOLEAN: 0x21,
  TIMESTAMP: 0x44,
});

const NO_RAW_DATA = 0xFFFFFFFF;
const SAME_RAW_DATA = 0x00000000;
const PREFERRED_UV_CHANNEL_ORDER = ["UVA", "UVB", "UVC", "UVV"];

const BASE_COLUMNS = [
  "File Name",
  "TDMS Name",
  "Serial Number",
  "Calibration Date",
  "Date of Measurement",
  "Notes",
  "Model",
  "Unit Type",
  "Range",
  "UV Sample Rate Hz",
];

const OPTIONAL_METADATA_COLUMNS = [
  "Board Temperature",
  "Battery Voltage",
  "Firmware Version",
  "PM2 Firmware Ver",
  "TC Used",
  "Read Status",
];

class TdmsMetadataParser {
  constructor(arrayBuffer) {
    this.buffer = arrayBuffer;
    this.view = new DataView(arrayBuffer);
    this.decoder = new TextDecoder("utf-8");
    this.objects = new Map();
    this.warnings = [];
  }

  parse() {
    let segmentStart = 0;
    let segmentNumber = 0;

    while (segmentStart + 28 <= this.buffer.byteLength) {
      const tag = this.readAscii(segmentStart, 4);
      if (tag !== "TDSm") {
        if (segmentNumber === 0) throw new Error("This does not look like a TDMS file; missing TDSm header.");
        break;
      }

      const tocMask = this.u32(segmentStart + 4);
      const version = this.u32(segmentStart + 8);
      const nextSegmentOffset = this.u64Number(segmentStart + 12);
      const rawDataOffset = this.u64Number(segmentStart + 20);
      const metadataStart = segmentStart + 28;
      const nextSegmentStart = Number.isFinite(nextSegmentOffset)
        ? segmentStart + 28 + nextSegmentOffset
        : this.buffer.byteLength;
      const metadataEnd = Number.isFinite(rawDataOffset)
        ? Math.min(metadataStart + rawDataOffset, this.buffer.byteLength)
        : Math.min(nextSegmentStart, this.buffer.byteLength);

      if (metadataEnd > metadataStart) {
        try {
          this.parseMetadata(metadataStart, metadataEnd);
        } catch (err) {
          this.warnings.push(`Segment ${segmentNumber + 1}: ${err.message}`);
        }
      }

      // Avoid infinite loops on unusual/corrupt files.
      if (!Number.isFinite(nextSegmentOffset) || nextSegmentStart <= segmentStart) break;
      segmentStart = Math.min(nextSegmentStart, this.buffer.byteLength);
      segmentNumber += 1;
    }

    return this;
  }

  parseMetadata(pos, metadataEnd) {
    if (pos + 4 > metadataEnd) return;
    const objectCount = this.u32(pos); pos += 4;

    for (let objectIndex = 0; objectIndex < objectCount; objectIndex += 1) {
      const pathResult = this.readString(pos, metadataEnd);
      const objectPath = pathResult.value;
      pos = pathResult.next;
      if (pos + 4 > metadataEnd) throw new Error(`Unexpected end while reading raw data index for ${objectPath}`);
      const rawDataIndex = this.u32(pos); pos += 4;

      if (rawDataIndex !== NO_RAW_DATA && rawDataIndex !== SAME_RAW_DATA) {
        // TDMS stores the total raw-data-index byte length including the 4-byte length value itself.
        // We already consumed the length value, so skip the remaining bytes.
        const bytesToSkip = rawDataIndex - 4;
        if (bytesToSkip < 0 || pos + bytesToSkip > metadataEnd) {
          throw new Error(`Unsupported or corrupt raw data index for ${objectPath}`);
        }
        pos += bytesToSkip;
      }

      if (pos + 4 > metadataEnd) throw new Error(`Unexpected end while reading property count for ${objectPath}`);
      const propertyCount = this.u32(pos); pos += 4;
      const properties = this.ensureObject(objectPath);

      for (let propertyIndex = 0; propertyIndex < propertyCount; propertyIndex += 1) {
        const nameResult = this.readString(pos, metadataEnd);
        const propertyName = nameResult.value;
        pos = nameResult.next;
        if (pos + 4 > metadataEnd) throw new Error(`Unexpected end while reading type for ${propertyName}`);
        const dataType = this.u32(pos); pos += 4;
        const valueResult = this.readValue(pos, dataType, metadataEnd);
        properties[propertyName] = valueResult.value;
        pos = valueResult.next;
      }
    }
  }

  ensureObject(path) {
    if (!this.objects.has(path)) this.objects.set(path, {});
    return this.objects.get(path);
  }

  readAscii(pos, len) {
    let out = "";
    for (let i = 0; i < len; i += 1) out += String.fromCharCode(this.view.getUint8(pos + i));
    return out;
  }

  readString(pos, end) {
    if (pos + 4 > end) throw new Error("Unexpected end while reading string length.");
    const len = this.u32(pos); pos += 4;
    if (pos + len > end) throw new Error("Unexpected end while reading string value.");
    const bytes = new Uint8Array(this.buffer, pos, len);
    return { value: this.decoder.decode(bytes), next: pos + len };
  }

  readValue(pos, type, end) {
    switch (type) {
      case TDMS_TYPE.INT8: return { value: this.view.getInt8(pos), next: pos + 1 };
      case TDMS_TYPE.INT16: return { value: this.view.getInt16(pos, true), next: pos + 2 };
      case TDMS_TYPE.INT32: return { value: this.view.getInt32(pos, true), next: pos + 4 };
      case TDMS_TYPE.INT64: return { value: this.i64Value(pos), next: pos + 8 };
      case TDMS_TYPE.UINT8: return { value: this.view.getUint8(pos), next: pos + 1 };
      case TDMS_TYPE.UINT16: return { value: this.view.getUint16(pos, true), next: pos + 2 };
      case TDMS_TYPE.UINT32: return { value: this.view.getUint32(pos, true), next: pos + 4 };
      case TDMS_TYPE.UINT64: return { value: this.u64Value(pos), next: pos + 8 };
      case TDMS_TYPE.SINGLE: return { value: this.view.getFloat32(pos, true), next: pos + 4 };
      case TDMS_TYPE.DOUBLE: return { value: this.view.getFloat64(pos, true), next: pos + 8 };
      case TDMS_TYPE.STRING: return this.readString(pos, end);
      case TDMS_TYPE.BOOLEAN: return { value: Boolean(this.view.getUint8(pos)), next: pos + 1 };
      case TDMS_TYPE.TIMESTAMP: return { value: this.readTimestamp(pos), next: pos + 16 };
      default:
        throw new Error(`Unsupported TDMS property type 0x${type.toString(16)}`);
    }
  }

  readTimestamp(pos) {
    const fraction = this.view.getBigUint64(pos, true);
    const seconds = this.view.getBigInt64(pos + 8, true);
    const fractionMs = Number(fraction * 1000n / (1n << 64n));
    const epoch1904 = Date.UTC(1904, 0, 1);
    const date = new Date(epoch1904 + Number(seconds) * 1000 + fractionMs);
    return date.toISOString().replace(".000Z", "Z");
  }

  u32(pos) { return this.view.getUint32(pos, true); }

  u64Number(pos) {
    const value = this.view.getBigUint64(pos, true);
    if (value === 0xFFFFFFFFFFFFFFFFn) return Infinity;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Infinity;
    return Number(value);
  }

  u64Value(pos) {
    const value = this.view.getBigUint64(pos, true);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }

  i64Value(pos) {
    const value = this.view.getBigInt64(pos, true);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
}

function parseObjectPath(path) {
  if (path === "/") return [];
  const parts = [];
  const regex = /'((?:[^']|'')*)'/g;
  let match;
  while ((match = regex.exec(path)) !== null) {
    parts.push(match[1].replace(/''/g, "'"));
  }
  return parts;
}

function getPropCaseInsensitive(properties, ...names) {
  if (!properties) return undefined;
  const normalized = new Map();
  for (const key of Object.keys(properties)) normalized.set(key.trim().toLowerCase(), key);
  for (const name of names) {
    const key = normalized.get(String(name).trim().toLowerCase());
    if (key !== undefined) return properties[key];
  }
  return undefined;
}

function normalizeChannelName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function isUVChannel(path, properties) {
  const parts = parseObjectPath(path);
  const group = (parts[0] || "").toLowerCase();
  const channel = normalizeChannelName(getPropCaseInsensitive(properties, "NI_ChannelName") || parts[1] || "");
  return (
    parts.length >= 2 &&
    (
      group.includes("uv signal") ||
      PREFERRED_UV_CHANNEL_ORDER.includes(channel) ||
      getPropCaseInsensitive(properties, "Energy Density", "Energy density") !== undefined ||
      getPropCaseInsensitive(properties, "Peak Irradiance", "Peak irradiance") !== undefined
    )
  );
}

function displayValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return Math.abs(value) >= 10000 ? String(value) : Number(value.toFixed(6));
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function extractSummaryFromArrayBuffer(arrayBuffer, fileName) {
  const parser = new TdmsMetadataParser(arrayBuffer).parse();
  const root = parser.objects.get("/") || {};

  const row = {
    "File Name": fileName,
    "TDMS Name": displayValue(getPropCaseInsensitive(root, "name")) || fileName.replace(/\.tdms$/i, ""),
    "Serial Number": displayValue(getPropCaseInsensitive(root, "Serial Number")),
    "Calibration Date": displayValue(getPropCaseInsensitive(root, "Calibration Date")),
    "Date of Measurement": displayValue(getPropCaseInsensitive(root, "Date & Time", "Date and Time", "Measurement Date")),
    "Notes": displayValue(getPropCaseInsensitive(root, "Notes")),
    "Model": displayValue(getPropCaseInsensitive(root, "Model")),
    "Unit Type": displayValue(getPropCaseInsensitive(root, "Unit Type")),
    "Range": displayValue(getPropCaseInsensitive(root, "Range")),
    "UV Sample Rate Hz": displayValue(getPropCaseInsensitive(root, "sample_rate", "Sample Rate")),
    "Board Temperature": displayValue(getPropCaseInsensitive(root, "Board Temperature")),
    "Battery Voltage": displayValue(getPropCaseInsensitive(root, "Battery Voltage")),
    "Firmware Version": displayValue(getPropCaseInsensitive(root, "Firmware Version")),
    "PM2 Firmware Ver": displayValue(getPropCaseInsensitive(root, "PM2 Firmware Ver")),
    "TC Used": displayValue(getPropCaseInsensitive(root, "TC_used", "TC Used")),
  };

  const channelRows = [];
  let uvChannelCount = 0;

  for (const [path, properties] of parser.objects.entries()) {
    if (!isUVChannel(path, properties)) continue;
    uvChannelCount += 1;
    const parts = parseObjectPath(path);
    const channelName = normalizeChannelName(getPropCaseInsensitive(properties, "NI_ChannelName") || parts[1] || `UV ${uvChannelCount}`);
    const energyDensity = displayValue(getPropCaseInsensitive(properties, "Energy Density", "Energy density"));
    const peakIrradiance = displayValue(getPropCaseInsensitive(properties, "Peak Irradiance", "Peak irradiance"));
    const wfStartTime = displayValue(getPropCaseInsensitive(properties, "wf_start_time"));
    const wfIncrement = displayValue(getPropCaseInsensitive(properties, "wf_increment"));
    const wfSamples = displayValue(getPropCaseInsensitive(properties, "wf_samples"));

    row[`${channelName} Energy Density (mJ/cm^2)`] = energyDensity;
    row[`${channelName} Peak Irradiance (mW/cm^2)`] = peakIrradiance;

    if (!row["Date of Measurement"] && wfStartTime) row["Date of Measurement"] = wfStartTime;

    channelRows.push({
      "File Name": fileName,
      "TDMS Name": row["TDMS Name"],
      "Channel": channelName,
      "Energy Density (mJ/cm^2)": energyDensity,
      "Peak Irradiance (mW/cm^2)": peakIrradiance,
      "Waveform Start Time": wfStartTime,
      "Samples": wfSamples,
      "Waveform Increment (s)": wfIncrement,
    });
  }

  row["Read Status"] = uvChannelCount > 0 ? "OK" : "No UV channels found";
  if (parser.warnings.length) row["Read Status"] += `; warnings: ${parser.warnings.join(" | ")}`;
  return { row, channelRows };
}

function getOrderedColumns(rows) {
  const all = new Set();
  rows.forEach(row => Object.keys(row).forEach(col => all.add(col)));
  const ordered = [];
  for (const col of BASE_COLUMNS) if (all.has(col)) ordered.push(col);

  for (const channel of PREFERRED_UV_CHANNEL_ORDER) {
    for (const metric of ["Energy Density (mJ/cm^2)", "Peak Irradiance (mW/cm^2)"]) {
      const col = `${channel} ${metric}`;
      if (all.has(col)) ordered.push(col);
    }
  }

  const metricCols = [...all]
    .filter(col => !ordered.includes(col) && (col.includes("Energy Density") || col.includes("Peak Irradiance")))
    .sort();
  ordered.push(...metricCols);

  for (const col of OPTIONAL_METADATA_COLUMNS) if (all.has(col) && !ordered.includes(col)) ordered.push(col);
  ordered.push(...[...all].filter(col => !ordered.includes(col)));
  return ordered;
}

function rowsToCsv(rows, columns) {
  const quote = value => {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map(quote).join(","), ...rows.map(row => columns.map(col => quote(row[col])).join(","))].join("\n");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function timestampForFilename() {
  return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
}

if (typeof document !== "undefined") {
  const state = { rows: [], channelRows: [], filter: "" };

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const clearBtn = document.getElementById("clearBtn");
  const downloadCsvBtn = document.getElementById("downloadCsvBtn");
  const downloadExcelBtn = document.getElementById("downloadExcelBtn");
  const filterInput = document.getElementById("filterInput");
  const statusBox = document.getElementById("statusBox");
  const tableWrap = document.getElementById("tableWrap");
  const detailTableWrap = document.getElementById("detailTableWrap");
  const filesRead = document.getElementById("filesRead");
  const filesParsed = document.getElementById("filesParsed");
  const filesWithErrors = document.getElementById("filesWithErrors");

  function setBusy(isBusy) {
    statusBox.textContent = isBusy ? "Reading TDMS files..." : statusBox.textContent;
    [clearBtn, downloadCsvBtn, downloadExcelBtn, filterInput].forEach(el => { el.disabled = isBusy || state.rows.length === 0; });
  }

  function filteredRows() {
    const q = state.filter.trim().toLowerCase();
    if (!q) return state.rows;
    return state.rows.filter(row => Object.values(row).some(value => String(value || "").toLowerCase().includes(q)));
  }

  function renderTable(rows, wrap, columns = null) {
    if (!rows.length) {
      wrap.innerHTML = "";
      return;
    }
    const cols = columns || getOrderedColumns(rows);
    const html = ["<table><thead><tr>"];
    cols.forEach(col => html.push(`<th>${escapeHtml(col)}</th>`));
    html.push("</tr></thead><tbody>");
    rows.forEach(row => {
      html.push("<tr>");
      cols.forEach(col => {
        const val = row[col] ?? "";
        const classes = [];
        if (col === "Notes") classes.push("notes-cell");
        if (col === "Read Status" && String(val).startsWith("OK")) classes.push("status-ok");
        if (col === "Read Status" && !String(val).startsWith("OK")) classes.push("status-error");
        html.push(`<td class="${classes.join(" ")}">${escapeHtml(String(val))}</td>`);
      });
      html.push("</tr>");
    });
    html.push("</tbody></table>");
    wrap.innerHTML = html.join("");
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function render() {
    const rows = filteredRows();
    const okCount = state.rows.filter(row => String(row["Read Status"] || "").startsWith("OK")).length;
    const errorCount = state.rows.length - okCount;
    filesRead.textContent = String(state.rows.length);
    filesParsed.textContent = String(okCount);
    filesWithErrors.textContent = String(errorCount);

    clearBtn.disabled = state.rows.length === 0;
    downloadCsvBtn.disabled = state.rows.length === 0;
    downloadExcelBtn.disabled = state.rows.length === 0;
    filterInput.disabled = state.rows.length === 0;

    if (!state.rows.length) {
      statusBox.className = "status-box";
      statusBox.textContent = "Upload TDMS files to begin.";
    } else if (errorCount > 0) {
      statusBox.className = "status-box error";
      statusBox.textContent = `${okCount} file(s) parsed successfully; ${errorCount} file(s) had warnings/errors. See Read Status column.`;
    } else {
      statusBox.className = "status-box ok";
      statusBox.textContent = `${okCount} file(s) parsed successfully.`;
    }

    renderTable(rows, tableWrap);
    renderTable(state.channelRows, detailTableWrap, [
      "File Name", "TDMS Name", "Channel", "Energy Density (mJ/cm^2)", "Peak Irradiance (mW/cm^2)",
      "Waveform Start Time", "Samples", "Waveform Increment (s)"
    ]);
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter(file => file.name.toLowerCase().endsWith(".tdms"));
    if (!files.length) return;
    setBusy(true);

    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const { row, channelRows } = extractSummaryFromArrayBuffer(buffer, file.name);
        state.rows.push(row);
        state.channelRows.push(...channelRows);
      } catch (err) {
        state.rows.push({
          "File Name": file.name,
          "TDMS Name": file.name.replace(/\.tdms$/i, ""),
          "Read Status": `ERROR: ${err.message || err}`,
        });
      }
    }

    fileInput.value = "";
    setBusy(false);
    render();
  }

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") fileInput.click();
  });
  fileInput.addEventListener("change", event => handleFiles(event.target.files));

  ["dragenter", "dragover"].forEach(type => {
    dropZone.addEventListener(type, event => {
      event.preventDefault();
      dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(type => {
    dropZone.addEventListener(type, event => {
      event.preventDefault();
      dropZone.classList.remove("dragover");
    });
  });
  dropZone.addEventListener("drop", event => handleFiles(event.dataTransfer.files));

  clearBtn.addEventListener("click", () => {
    state.rows = [];
    state.channelRows = [];
    state.filter = "";
    filterInput.value = "";
    render();
  });

  filterInput.addEventListener("input", event => {
    state.filter = event.target.value;
    render();
  });

  downloadCsvBtn.addEventListener("click", () => {
    if (!state.rows.length) return;
    const columns = getOrderedColumns(state.rows);
    const csv = rowsToCsv(state.rows, columns);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `tdms_uv_comparison_${timestampForFilename()}.csv`);
  });

  downloadExcelBtn.addEventListener("click", () => {
    if (!state.rows.length) return;
    if (typeof XLSX === "undefined") {
      alert("Excel library did not load. Use Download CSV, or check the internet connection and refresh the page.");
      return;
    }
    const columns = getOrderedColumns(state.rows);
    const rows = state.rows.map(row => Object.fromEntries(columns.map(col => [col, row[col] ?? ""])));
    const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
    ws["!cols"] = columns.map(col => ({ wch: col === "Notes" ? 55 : Math.min(Math.max(col.length + 4, 14), 32) }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: state.rows.length, c: columns.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TDMS Comparison");
    XLSX.writeFile(wb, `tdms_uv_comparison_${timestampForFilename()}.xlsx`);
  });

  render();
}

if (typeof module !== "undefined") {
  module.exports = {
    TdmsMetadataParser,
    extractSummaryFromArrayBuffer,
    getOrderedColumns,
    rowsToCsv,
  };
}
