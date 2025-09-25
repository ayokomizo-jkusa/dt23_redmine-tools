/* Redmine helper (no-API)
 * - Subject from PDF filename (optionally "_"->"/")
 * - Issued Date <- "Sent:" date found in the PDF (Outlook-style header)
 * - LOT-by-LOT: fill #1 in current tab, then open next tabs on button clicks
 * UI: English
 */
(function () {
  try {
    /* ===== CONFIG ===== */
    const SELECTORS = {
      subject: '#issue_subject',
      issuedDate: '#issue_custom_field_values_15' // <- Issued Date field in your Redmine
    };
    const FILENAME_REPLACE_UNDERSCORE_TO_SLASH = false; // true if "QRT1234_56" -> "QRT1234/56"

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

    /* ===== Parse "Sent:" date =====
     * Accepts typical Outlook-like lines:
     *   Sent: Thursday, September 18, 2025 11:15 AM
     *   Sent: Mon, Sep 18, 2025 11:15 AM
     * Returns YYYY-MM-DD
     */
    function parseSentDate(pdfText) {
      // Wide regex capturing everything after "Sent:" to end-of-line
      const m = pdfText.match(/^\s*Sent:\s*(.+)$/im);
      if (!m) return null;
      const raw = m[1].trim();

      // Try native Date first
      const d1 = new Date(raw);
      if (!isNaN(d1.getTime())) return fmtDate(d1);

      // Manual parse: Day, Month DD, YYYY HH:MM AM/PM  (allow short month)
      const re = /^(?:[A-Za-z]+,?\s+)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i;
      const m2 = raw.match(re);
      if (m2) {
        const monthMap = {
          jan:1,feb:2,mar:3,apr:4,may:5,jun:6,
          jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12
        };
        const mon = monthMap[m2[1].toLowerCase().slice(0,4)] || monthMap[m2[1].toLowerCase().slice(0,3)];
        const day = parseInt(m2[2], 10);
        const year = parseInt(m2[3], 10);
        let hh = parseInt(m2[4], 10);
        const mm = parseInt(m2[5], 10);
        const ampm = m2[6].toUpperCase();
        if (ampm === 'PM' && hh < 12) hh += 12;
        if (ampm === 'AM' && hh === 12) hh = 0;
        if (!mon || day < 1 || day > 31) return null;
        const d = new Date(year, mon - 1, day, hh, mm, 0);
        if (isNaN(d.getTime())) return null;
        return fmtDate(d);
      }

      // Last resort: look for simple YYYY-MM-DD / MM/DD/YYYY on the same line
      const ymd = raw.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
      if (ymd) {
        const y = ymd[1], mth = ymd[2].padStart(2,'0'), dy = ymd[3].padStart(2,'0');
        return `${y}-${mth}-${dy}`;
      }
      const mdy = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (mdy) {
        const y = mdy[3], mth = mdy[1].padStart(2,'0'), dy = mdy[2].padStart(2,'0');
        return `${y}-${mth}-${dy}`;
      }
      return null;
    }

    function fmtDate(d) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
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
        openAndFill(stash.url, subject, stash.issuedDate, () => {
          stash.done++;
          setStash(stash);
          renderPanel(stash);
        });
      };

      p.appendChild(info);
      p.appendChild(btn);
      p.appendChild(close);
    }

    function openAndFill(url, subject, issuedDate, doneCb) {
      const w = window.open(url, '_blank');
      if (!w) { alert('Popup was blocked. Please allow popups for this site.'); return; }
      let tick = 0;
      const iv = setInterval(() => {
        try {
          tick++;
          if (!w || w.closed) { clearInterval(iv); return; }
          const d = w.document; if (!d) return;

          const sub = d.querySelector(SELECTORS.subject);
          if (sub) sub.value = subject;

          if (issuedDate) {
            const issued = d.querySelector(SELECTORS.issuedDate);
            if (issued) { try { issued.value = issuedDate; } catch {} }
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

    // First run: choose PDF -> parse Sent date -> ask LOT -> fill #1 -> panel
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

      // Parse "Sent:" date from PDF text -> Issued Date
      let issuedDate = null;
      try {
        const text = await readPdfTextFromFile(file);
        issuedDate = parseSentDate(text);
      } catch (e) { console.warn('PDF parse skipped:', e.message); }

      // Ask LOT
      let lot = parseInt(prompt('Enter LOT QTY (default=1)', '1') || '1', 10);
      if (!(lot > 0)) lot = 1;

      // Fill current tab (#1)
      const subjectInput = $(SELECTORS.subject);
      if (!subjectInput) { alert('Subject field not found.'); return; }
      subjectInput.value = lot > 1 ? `${base} (#1/${lot})` : base;

      if (issuedDate) {
        const issued = $(SELECTORS.issuedDate);
        if (issued) { try { issued.value = issuedDate; } catch {} }
      } else {
        const manual = prompt('Could not find "Sent:" date in the PDF. Enter Issued Date (YYYY-MM-DD) or leave blank:', '');
        if (manual) { const issued = $(SELECTORS.issuedDate); if (issued) issued.value = manual; }
      }

      // Save batch state & show panel
      const stash = { base, total: lot, done: 1, url: location.href, issuedDate };
      setStash(stash);
      renderPanel(stash);
      toast('Filled Subject in this tab (#1). Use the bottom-right panel to open the next tabs.');
    });
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
