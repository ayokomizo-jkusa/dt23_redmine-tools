/* Redmine helper (no-API)
 * - Subject from PDF filename (optionally "_"->"/")
 * - Issued Date <- "Sent:" date found in the PDF (Outlook-style header)
 * - Location <- PDF "LOCATION:" (supports code-only like "058")
 * - LOT-by-LOT: fill #1 in current tab, then open next tabs on button clicks
 * UI: English
 */
(function () {
  try {
    /* ===== CONFIG ===== */
    const SELECTORS = {
      subject: '#issue_subject',
      issuedDate: '#issue_custom_field_values_15',     // <- Issued Date field
      location:  '#issue_custom_field_values_location' // <- CHANGE THIS to your Location field selector (e.g. '#issue_custom_field_values_16')
    };
    const FILENAME_REPLACE_UNDERSCORE_TO_SLASH = false; // true if "QRT1234_56" -> "QRT1234/56"

    // Code -> Label map for Location (expand as needed)
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

    // Set select/input by trying option text / value matches
    function setSelectByTextOrValue(el, targetText) {
      if (!el) return false;
      const val = String(targetText).trim().toLowerCase();
      // If it's a <select>, try to match options
      if (el.tagName === 'SELECT') {
        const opts = Array.from(el.options || []);
        // 1) exact text
        let hit = opts.find(o => (o.text||'').trim().toLowerCase() === val);
        // 2) contains text
        if (!hit) hit = opts.find(o => (o.text||'').toLowerCase().includes(val));
        // 3) exact value
        if (!hit) hit = opts.find(o => String(o.value||'').toLowerCase() === val);
        // 4) contains value
        if (!hit) hit = opts.find(o => String(o.value||'').toLowerCase().includes(val));
        if (hit) { el.value = hit.value; el.dispatchEvent(new Event('change', {bubbles:true})); return true; }
        return false;
      }
      // Otherwise set as text input
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
      return text;
    }

    /* ===== Parse "Sent:" date -> YYYY-MM-DD ===== */
    function parseSentDate(pdfText) {
      const m = pdfText.match(/^\s*Sent\s*:?\s*(.+)$/im);
      if (!m) return null;
      const raw = m[1].trim();

      const dNative = new Date(raw);
      if (!isNaN(dNative.getTime())) return fmtDate(dNative);

      const re1 = /^(?:[A-Za-z]+,?\s+)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)(?:\s*[A-Z]{2,5})?$/i;
      const m1 = raw.match(re1);
      if (m1) {
        const mon = monthToNum(m1[1]); if (!mon) return null;
        const day = +m1[2], year = +m1[3]; let hh = +m1[4]; const mm = +m1[5]; const ap = m1[6].toUpperCase();
        if (ap === 'PM' && hh < 12) hh += 12; if (ap === 'AM' && hh === 12) hh = 0;
        const d = new Date(year, mon - 1, day, hh, mm, 0); if (!isNaN(d.getTime())) return fmtDate(d);
      }

      const re2 = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:[A-Z]{1,5}|[+\-]\d{2}:?\d{2})?$/i;
      const m2 = raw.match(re2);
      if (m2) {
        const day = +m2[1]; const mon = monthToNum(m2[2]); const year = +m2[3]; const hh = +m2[4]; const mm = +m2[5];
        if (mon) { const d = new Date(year, mon - 1, day, hh, mm, 0); if (!isNaN(d.getTime())) return fmtDate(d); }
      }

      const mdy = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (mdy) {
        const y = mdy[3], m = mdy[1].padStart(2,'0'), d = mdy[2].padStart(2,'0');
        return `${y}-${m}-${d}`;
      }
      const ymd = raw.match(/(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
      if (ymd) {
        const y = ymd[1], m = ymd[2].padStart(2,'0'), d = ymd[3].padStart(2,'0');
        return `${y}-${m}-${d}`;
      }

      return null;
    }

    function monthToNum(m) {
      const k = m.toLowerCase().slice(0,4);
      const map = { jan:1, janu:1, feb:2, mar:3, apr:4, may:5, jun:6, july:7, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
      return map[k] || map[m.toLowerCase().slice(0,3)] || null;
    }

    function fmtDate(d) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    /* ===== Parse "LOCATION:" -> { code, label } ===== */
    function parseLocation(pdfText) {
      const lm = pdfText.match(/^\s*LOCATION\s*:?\s*(.+)$/im);
      if (!lm) return null;
      const raw = lm[1].trim();

      // Try to find a 3-digit code
      const codeMatch = raw.match(/\b(\d{3})\b/);
      if (codeMatch) {
        const code = codeMatch[1];
        const label = LOCATION_MAP[code] || null;
        if (label) return { code, label };
      }

      // Otherwise try to match by label text
      const rawLower = raw.toLowerCase();
      let best = null;
      for (const [code, label] of Object.entries(LOCATION_MAP)) {
        if (rawLower.includes(label.toLowerCase())) {
          best = { code, label };
          break;
        }
      }
      return best; // may be null
    }

    /* ===== Batch panel (open next tabs by clicks) ===== */
    const PANEL_ID = 'p2r_panel_v2';
    const STASH_KEY = 'p2r_stash_v2';

    const getStash = () => {
      try { return JSON.parse(localStorage.getItem(STASH_KEY) || 'null'); } catch { return null; }
    };
    const setStash = (o) => localStorage.setItem(STASH_KEY, JSON.stringify(o));
    const clearStash = () => localStorage.removeItem(STASH_KEY);

    function ensurePanel() {
      let p = document.getElementById(PANEL_ID);
      if (p) return p;
      p = document.createElement('div');
      p.id = PANEL_ID;
      p.style = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#fff;border:1px solid #ccc;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.15);padding:10px 12px;font:12px system-ui;display:flex;gap:8px;align-items:center';
      document.body.appendChild(p);
      return p;
    }

    function renderPanel(stash) {
      const p = ensurePanel();
      p.innerHTML = '';

      const remain = stash.total - stash.done;
      const info = document.createElement('div');
      info.textContent = `${stash.base}   Remaining: ${remain}`;

      const btn = document.createElement('button');
      btn.textContent = remain > 0 ? `Open next tab (#${stash.done + 1}/${stash.total})` : 'Done';
      btn.disabled = remain <= 0;
      btn.style = 'padding:6px 10px;border-radius:8px;border:1px solid #999;background:#f6f6f6;cursor:pointer';

      const close = document.createElement('button');
      close.textContent = '×';
      close.title = 'Close';
      close.style = 'padding:4px 8px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer';
      close.onclick = () => p.remove();

      btn.onclick = () => {
        const i = stash.done + 1;
        const subject = stash.total > 1 ? `${stash.base} (#${i}/${stash.total})` : stash.base;
        openAndFill(stash.url, subject, stash.issuedDate, stash.location, () => {
          stash.done++;
          setStash(stash);
          renderPanel(stash);
        });
      };

      p.appendChild(info);
      p.appendChild(btn);
      p.appendChild(close);
    }

    function openAndFill(url, subject, issuedDate, locationObj, doneCb) {
      const w = window.open(url, '_blank');
      if (!w) { alert('Popup was blocked. Please allow popups for this site.'); return; }
      let tick = 0;
      const iv = setInterval(() => {
        try {
          tick++;
          if (!w || w.closed) { clearInterval(iv); return; }
          const d = w.document; if (!d) return;

          // Subject
          const sub = d.querySelector(SELECTORS.subject);
          if (sub) sub.value = subject;

          // Issued Date
          if (issuedDate) {
            const issued = d.querySelector(SELECTORS.issuedDate);
            if (issued) { try { issued.value = issuedDate; issued.dispatchEvent(new Event('change', {bubbles:true})); } catch {} }
          }

          // Location
          if (locationObj) {
            const locEl = d.querySelector(SELECTORS.location);
            if (locEl) {
              // try label first; fallback to code; finally raw label text
              const tried =
                setSelectByTextOrValue(locEl, locationObj.label) ||
                setSelectByTextOrValue(locEl, locationObj.code)  ||
                setSelectByTextOrValue(locEl, (locationObj.label||''));
              // nothing else to do if not matched
            }
          }

          if (sub) { clearInterval(iv); doneCb && doneCb(); }
        } catch (_) { /* wait same-origin */ }
        if (tick > 600) clearInterval(iv);
      }, 50);
    }

    /* ===== Main ===== */
    assertOnNewIssue();

    // Resume pending batch if any
    const cont = getStash();
    if (cont && cont.total > cont.done) { renderPanel(cont); return; }

    // First run: choose PDF -> parse fields -> ask LOT -> fill #1 -> panel
    const pickFile = () => new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = 'application/pdf';
      i.onchange = () => resolve(i.files && i.files[0]);
      i.click();
    });

    pickFile().then(async (file) => {
      if (!file) return;

      // Subject base from filename
      let base = file.name.replace(/\.pdf$/i, '');
      if (FILENAME_REPLACE_UNDERSCORE_TO_SLASH) base = base.replace('_', '/');

      // Parse from PDF text
      let issuedDate = null;
      let locationObj = null;
      try {
        const text = await readPdfTextFromFile(file);
        issuedDate = parseSentDate(text);
        locationObj = parseLocation(text); // { code, label } or null
      } catch (e) { console.warn('PDF parse skipped:', e.message); }

      // Ask LOT
      let lot = parseInt(prompt('Enter LOT QTY (default=1)', '1') || '1', 10);
      if (!(lot > 0)) lot = 1;

      // Fill current tab (#1)
      const subEl = $(SELECTORS.subject);
      if (!subEl) { alert('Subject field not found.'); return; }
      subEl.value = lot > 1 ? `${base} (#1/${lot})` : base;

      // Issued Date
      if (issuedDate) {
        const issued = $(SELECTORS.issuedDate);
        if (issued) { try { issued.value = issuedDate; issued.dispatchEvent(new Event('change', {bubbles:true})); } catch {} }
      } else {
        const manual = prompt('Could not find "Sent:" date in the PDF. Enter Issued Date (YYYY-MM-DD) or leave blank:', '');
        if (manual) { const issued = $(SELECTORS.issuedDate); if (issued) issued.value = manual; }
      }

      // Location
      if (locationObj) {
        const locEl = $(SELECTORS.location);
        if (locEl) {
          setSelectByTextOrValue(locEl, locationObj.label) ||
          setSelectByTextOrValue(locEl, locationObj.code)  ||
          setSelectByTextOrValue(locEl, (locationObj.label||''));
        }
      } else {
        // Optional: ask user if not parsed
        // const manualLoc = prompt('Could not determine LOCATION. Enter location label or code:', '');
        // if (manualLoc) { const locEl = $(SELECTORS.location); if (locEl) setSelectByTextOrValue(locEl, manualLoc); }
      }

      // Save batch state & show panel
      const stash = { base, total: lot, done: 1, url: location.href, issuedDate, location: locationObj };
      setStash(stash);
      renderPanel(stash);
      toast('Filled Subject in this tab (#1). Use the bottom-right panel to open the next tabs.');
    });
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
