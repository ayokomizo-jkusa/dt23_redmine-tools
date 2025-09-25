/* Redmine helper (no-API)
 * - Subject from PDF filename (optionally "_"->"/")
 * - Issued Date <- "Sent:" date found in the PDF (Outlook-style header)
 * - Location <- PDF "LOCATION:" (supports code-only like "058")
 * - LOT-by-LOT: fill #1 in current tab, then open next tabs on button clicks
 * UI: English
 */
(function () {
  try {
    /* ======= META ======= */
    const NOW_ISO = new Date().toISOString();
    console.log('%c[p2r] script loaded','color:#0b8;font-weight:bold',
      { loadedAt: NOW_ISO, href: location.href });

    /* ===== CONFIG ===== */
    const SELECTORS = {
      subject: '#issue_subject',
      issuedDate: '#issue_custom_field_values_15', // <- Issued Date field
      location:  '#issue_custom_field_values_25'   // <- Location field
    };
    const FILENAME_REPLACE_UNDERSCORE_TO_SLASH = false;

    // Code -> Label map for Location
    const LOCATION_MAP = {
      '004': 'Cleveland Truck Plant, Cleveland, NC',
      '013': 'Saltillo Truck Plant, Saltillo, MX',
      '017': 'Mt. Holly Truck Plant, Mt. Holly, NC',
      '058': 'Toluca, MX'
    };

    /* ===== Utilities ===== */
    const $ = (sel, root = document) => root.querySelector(sel);
    const toast = (msg) => {
      const d = document.createElement('div');
      d.style = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:999999;background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:12px system-ui';
      d.textContent = msg;
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 2200);
    };
    const assertOnNewIssue = () => {
      if (!$(SELECTORS.subject)) {
        alert('Subject field not found. Run this on Redmine "New issue" page.');
        throw new Error('Subject field not found');
      }
    };

    function setSelectByTextOrValue(el, targetText) {
      if (!el) return false;
      const val = String(targetText ?? '').trim().toLowerCase();
      if (el.tagName === 'SELECT') {
        const opts = Array.from(el.options || []);
        let hit = opts.find(o => (o.text||'').trim().toLowerCase() === val);
        if (!hit) hit = opts.find(o => (o.text||'').toLowerCase().includes(val));
        if (!hit) hit = opts.find(o => String(o.value||'').toLowerCase() === val);
        if (!hit) hit = opts.find(o => String(o.value||'').toLowerCase().includes(val));
        if (hit) { el.value = hit.value; el.dispatchEvent(new Event('change', {bubbles:true})); return true; }
        return false;
      }
      try { el.value = targetText; el.dispatchEvent(new Event('input', {bubbles:true})); return true; } catch { return false; }
    }

    /* ===== Lazy-load pdf.js and read text ===== */
    const loadScript = (src) =>
      new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = () => rej(new Error('Failed to load: ' + src));
        document.head.appendChild(s);
      });

    async function loadPdfJsIfNeeded() {
      if (window.pdfjsLib) return;
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');
      console.log('%c[p2r] pdf.js loaded','color:#0b8');
    }

    async function readPdfTextFromFile(file) {
      await loadPdfJsIfNeeded();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i);
        const c = await p.getTextContent();
        text += c.items.map((it) => it.str).join('\n') + '\n';
      }
      console.log('%c[p2r] PDF text extracted','color:#0b8', { bytes: buf.byteLength, pages: pdf.numPages });
      return text;
    }

    /* ===== Parse "Sent:" date -> YYYY-MM-DD ===== */
    function parseSentDate(pdfText) {
      const m = pdfText.match(/^\s*Sent\s*:?\s*(.+)$/im);
      if (!m) return null;
      const raw = m[1].trim();

      const dNative = new Date(raw);
      if (!isNaN(dNative.getTime())) return fmtDate(dNative);

      const re1 = /^(?:[A-Za-z]+,?\s+)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)/i;
      const m1 = raw.match(re1);
      if (m1) {
        const mon = monthToNum(m1[1]); if (!mon) return null;
        const day = +m1[2], year = +m1[3]; let hh = +m1[4]; const mm = +m1[5]; const ap = m1[6].toUpperCase();
        if (ap === 'PM' && hh < 12) hh += 12; if (ap === 'AM' && hh === 12) hh = 0;
        const d = new Date(year, mon - 1, day, hh, mm, 0); if (!isNaN(d.getTime())) return fmtDate(d);
      }

      const mdy = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (mdy) { return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`; }
      const ymd = raw.match(/(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
      if (ymd) { return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`; }

      return null;
    }

    function monthToNum(m) {
      const k = m.toLowerCase().slice(0,4);
      const map = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,july:7,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
      return map[k] || map[m.toLowerCase().slice(0,3)] || null;
    }

    function fmtDate(d) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    /* ===== Parse "LOCATION:" ===== */
    function parseLocation(pdfText) {
      const lm = pdfText.match(/^\s*LOCATION\s*:?\s*(.+)$/im);
      if (!lm) return null;
      const raw = lm[1].trim();

      const codeMatch = raw.match(/\b(\d{3})\b/);
      if (codeMatch) {
        const code = codeMatch[1];
        const label = LOCATION_MAP[code] || null;
        if (label) return { code, label };
      }
      const rawLower = raw.toLowerCase();
      for (const [code, label] of Object.entries(LOCATION_MAP)) {
        if (rawLower.includes(label.toLowerCase())) return { code, label };
      }
      return null;
    }

    /* ===== Batch panel / openAndFill (省略: 前と同じ) ===== */
    // ... ここは前回コードと同じ処理（省略）
    // openAndFill() 内でも console.log に {subject, issuedDate, location} を出しています

    // （省略部分はあなたの手元の最新コードに置き換えてOK）
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
