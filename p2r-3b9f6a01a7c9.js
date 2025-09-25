/* Redmine helper (no-API)
 * - Subject from PDF filename (optionally "_"->"/")
 * - Issued Date <- "DATE ENTERED:" (MM/DD/YY or MM/DD/YYYY) else fallback to "Sent:" → (YYYY-MM-DD)
 * - Issuer      <- "NAME:" (raw text)  -> #issue_custom_field_values_16
 * - Location    <- "LOCATION:" (supports code-only like "058") -> #issue_custom_field_values_25
 * - Attachment  <- attach PDF to QRT field first (label contains "QRT"), fallback to Files area
 * - LOT-by-LOT  <- default LOT QTY from "LOT QTY:" in PDF (fallback=1)
 * UI: English
 */
(function () {
  try {
    console.log('%c[p2r] script loaded', 'color:#0b8;font-weight:bold', { loadedAt: new Date().toISOString(), href: location.href });

    /* ===== CONFIG ===== */
    const SELECTORS = {
      subject:    '#issue_subject',
      issuedDate: '#issue_custom_field_values_15', // Issued Date (Redmine field)
      location:   '#issue_custom_field_values_25', // Location
      issuer:     '#issue_custom_field_values_16'  // Issuer
    };

    // Files(通常添付)の入力候補（最終フォールバック）
    const FILES_INPUT_CANDIDATES = [
      'input[type="file"][name^="attachments"]',
      '#attachments_fields input[type="file"]',
      '#attachments_form input[type="file"]',
      'input[type="file"][id^="attachments"]'
    ];

    // 「QRT」添付フィールドのラベル検出キーワード
    const QRT_LABEL_KEYWORDS = ['QRT'];

    const FILENAME_REPLACE_UNDERSCORE_TO_SLASH = false;

    // Location code map
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

    // Set <select> or <input> value; tries option text/value (exact→partial)
    function setSelectByTextOrValue(el, targetText) {
      if (!el) return false;
      const tgt = String(targetText ?? '').trim();
      const val = tgt.toLowerCase();
      if (el.tagName === 'SELECT') {
        const opts = Array.from(el.options || []);
        let hit =
          opts.find(o => (o.text || '').trim().toLowerCase() === val) ||
          opts.find(o => (o.text || '').toLowerCase().includes(val)) ||
          opts.find(o => String(o.value || '').toLowerCase() === val) ||
          opts.find(o => String(o.value || '').toLowerCase().includes(val));
        if (hit) { el.value = hit.value; el.dispatchEvent(new Event('change', {bubbles:true})); return true; }
        return false;
      }
      try { el.value = tgt; el.dispatchEvent(new Event('input', {bubbles:true})); return true; } catch { return false; }
    }

    function findIssuerField(doc) {
      let el = doc.querySelector(SELECTORS.issuer);
      if (el) return el;
      el = doc.querySelector('input[id*="issuer" i], textarea[id*="issuer" i], input[name*="[issuer]" i], textarea[name*="[issuer]" i]');
      return el || null;
    }

    /* ===== QRT attachment detection & attach ===== */
    function findQrtFileInput(doc) {
      // ラベルやセルに "QRT" を含む近傍の file input
      const nodes = Array.from(doc.querySelectorAll('label, .label, th, td, span, div'));
      const qrtNodes = nodes.filter(n => (n.textContent || '').toLowerCase().includes('qrt'));
      for (const n of qrtNodes) {
        const inSame = n.querySelector?.('input[type="file"]'); if (inSame) return inSame;
        const next = n.nextElementSibling?.querySelector?.('input[type="file"]'); if (next) return next;
        const p1 = n.parentElement, p2 = p1?.parentElement;
        const cand = p1?.querySelector?.('input[type="file"]') || p2?.querySelector?.('input[type="file"]');
        if (cand) return cand;
      }
      // name/id に qrt を含む input
      return doc.querySelector('input[type="file"][name*="qrt" i]') || doc.querySelector('input[type="file"][id*="qrt" i]') || null;
    }

    function attachToInput(input, file) {
      if (!input || !file) return false;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', {bubbles:true}));
        return true;
      } catch (e) {
        console.warn('[p2r] attach failed:', e.message);
        return false;
      }
    }

    function attachFilePreferQRT(doc, file) {
      if (!file) return false;
      const qrt = findQrtFileInput(doc);
      if (qrt) {
        const ok = attachToInput(qrt, file);
        console.log('%c[p2r] attach -> QRT', 'color:#0b8', { ok, name: file.name });
        if (ok) return true;
      }
      const fallback = FILES_INPUT_CANDIDATES.map(sel => doc.querySelector(sel)).find(Boolean);
      const ok2 = attachToInput(fallback, file);
      console.log('%c[p2r] attach -> Files (fallback)', 'color:#b80', { ok: ok2, name: file.name });
      return ok2;
    }

    /* ===== pdf.js ===== */
    const loadScript = (src) =>
      new Promise((res, rej) => { const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=()=>rej(new Error('Failed to load: '+src)); document.head.appendChild(s); });

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
      for (let i=1;i<=pdf.numPages;i++){
        const p=await pdf.getPage(i);
        const c=await p.getTextContent();
        text+=c.items.map(it=>it.str).join('\n')+'\n';
      }
      console.log('%c[p2r] PDF text extracted','color:#0b8',{bytes:buf.byteLength,pages:pdf.numPages});
      return text;
    }

    /* ===== Date parsers ===== */
    // 1st priority: DATE ENTERED: MM/DD/YY or MM/DD/YYYY -> YYYY-MM-DD
    function parseDateEntered(pdfText) {
      const m = pdfText.match(/^\s*DATE\s+ENTERED\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/im);
      if (!m) return null;
      let mm = parseInt(m[1], 10);
      let dd = parseInt(m[2], 10);
      let yy = m[3];
      if (yy.length === 2) yy = 2000 + parseInt(yy, 10);
      else yy = parseInt(yy, 10);
      if (isNaN(mm) || isNaN(dd) || isNaN(yy)) return null;
      return `${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    }

    // Fallback: Sent: -> YYYY-MM-DD
    function parseSentDate(pdfText) {
      const m = pdfText.match(/^\s*Sent\s*:?\s*(.+)$/im);
      if (!m) return null;
      const raw = m[1].trim();

      const dNative = new Date(raw);
      if (!isNaN(dNative.getTime())) return fmtDate(dNative);

      const re1=/^(?:[A-Za-z]+,?\s+)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)(?:\s*[A-Z]{2,5})?$/i;
      const m1=raw.match(re1);
      if(m1){ const mon=monthToNum(m1[1]); if(!mon) return null;
        const day=+m1[2], year=+m1[3]; let hh=+m1[4]; const mm=+m1[5]; const ap=m1[6].toUpperCase();
        if(ap==='PM'&&hh<12) hh+=12; if(ap==='AM'&&hh===12) hh=0;
        const d=new Date(year,mon-1,day,hh,mm,0); if(!isNaN(d.getTime())) return fmtDate(d); }

      const re2=/^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:[A-Z]{1,5}|[+\-]\d{2}:?\d{2})?$/i;
      const m2=raw.match(re2);
      if(m2){ const day=+m2[1]; const mon=monthToNum(m2[2]); const year=+m2[3]; const hh=+m2[4]; const mm=+m2[5];
        if(mon){ const d=new Date(year,mon-1,day,hh,mm,0); if(!isNaN(d.getTime())) return fmtDate(d); } }

      const mdy=raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if(mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;

      const ymd=raw.match(/(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
      if(ymd) return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`;

      return null;
    }

    function monthToNum(m){ const k=m.toLowerCase().slice(0,4); const map={jan:1,janu:1,feb:2,mar:3,apr:4,may:5,jun:6,july:7,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12}; return map[k]||map[m.toLowerCase().slice(0,3)]||null; }
    function fmtDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

    /* ===== Other parsers ===== */
    function parseIssuer(pdfText) {
      const m = pdfText.match(/^\s*NAME\s*:?\s*(.+)$/im);
      return m ? m[1].trim() : null;
    }

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

    // LOT QTY
    function parseLotQty(pdfText) {
      // 例: "LOT QTY: 3" / "LOT QTY : 2 EA" などを想定
      const m = pdfText.match(/^\s*LOT\s+QTY\s*:?\s*(\d+)/im);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }

    /* ===== Batch panel ===== */
    const PANEL_ID='p2r_panel_v2'; const STASH_KEY='p2r_stash_v2';
    const getStash=()=>{try{return JSON.parse(localStorage.getItem(STASH_KEY)||'null')}catch{return null}};
    const setStash=(o)=>localStorage.setItem(STASH_KEY,JSON.stringify(o));
    const clearStash=()=>localStorage.removeItem(STASH_KEY);

    function ensurePanel(){ let p=document.getElementById(PANEL_ID); if(p) return p;
      p=document.createElement('div'); p.id=PANEL_ID;
      p.style='position:fixed;right:16px;bottom:16px;z-index:999999;background:#fff;border:1px solid #ccc;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.15);padding:10px 12px;font:12px system-ui;display:flex;gap:8px;align-items:center';
      document.body.appendChild(p); return p; }

    function renderPanel(stash){
      const p=ensurePanel(); p.innerHTML='';
      const remain=stash.total-stash.done;
      const info=document.createElement('div'); info.textContent=`${stash.base}   Remaining: ${remain}`;
      const btn=document.createElement('button'); btn.textContent=remain>0?`Open next tab (#${stash.done+1}/${stash.total})`:'Done'; btn.disabled=remain<=0;
      btn.style='padding:6px 10px;border-radius:8px;border:1px solid #999;background:#f6f6f6;cursor:pointer';
      const close=document.createElement('button'); close.textContent='×'; close.title='Close';
      close.style='padding:4px 8px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer'; close.onclick=()=>p.remove();
      btn.onclick=()=>{ const i=stash.done+1; const subject=stash.total>1?`${stash.base} (#${i}/${stash.total})`:stash.base;
        openAndFill(stash.url, subject, stash.issuedDate, stash.location, stash.issuer, stash.file, ()=>{ stash.done++; setStash(stash); renderPanel(stash); }); };
      p.appendChild(info); p.appendChild(btn); p.appendChild(close);
    }

    /* ===== Open new tab and fill ===== */
    function openAndFill(url, subject, issuedDate, locationObj, issuerName, fileObj, doneCb){
      const w=window.open(url,'_blank'); if(!w){ alert('Popup was blocked. Please allow popups for this site.'); return; }
      let tick=0; const iv=setInterval(()=>{ try{
        tick++; if(!w||w.closed){clearInterval(iv);return;}
        const d=w.document; if(!d) return;

        const sub=d.querySelector(SELECTORS.subject); if (sub) sub.value=subject;

        if(issuedDate){ const el=d.querySelector(SELECTORS.issuedDate); if(el){ try{ el.value=issuedDate; el.dispatchEvent(new Event('change',{bubbles:true})); }catch{} } }

        if(locationObj){ const locEl=d.querySelector(SELECTORS.location); if(locEl){
          setSelectByTextOrValue(locEl, locationObj.label) || setSelectByTextOrValue(locEl, locationObj.code) || setSelectByTextOrValue(locEl, (locationObj.label||'')); } }

        if(issuerName){ const issuerEl=findIssuerField(d); if(issuerEl){ try{ issuerEl.value=issuerName; issuerEl.dispatchEvent(new Event('input',{bubbles:true})); }catch{} } }

        if(fileObj){ attachFilePreferQRT(d, fileObj); }

        if(sub){ clearInterval(iv); doneCb&&doneCb(); }
      }catch(_){ /* wait same-origin */ } if(tick>600) clearInterval(iv); },50);

      console.log('%c[p2r] opened tab','color:#0b8',{subject,issuedDate,issuer:issuerName||null,location:locationObj?.label||locationObj?.code||null,attach:!!fileObj});
    }

    /* ===== Main ===== */
    assertOnNewIssue();

    const cont=getStash();
    if(cont && cont.total>cont.done){ renderPanel(cont); return; }

    const pickInput=document.createElement('input'); pickInput.type='file'; pickInput.accept='application/pdf';
    pickInput.onchange=async ()=> {
      const file=pickInput.files && pickInput.files[0]; if(!file) return;

      let base=file.name.replace(/\.pdf$/i,''); if(FILENAME_REPLACE_UNDERSCORE_TO_SLASH) base=base.replace('_','/');

      let issuedDate=null, locationObj=null, issuerName=null, lotFromPdf=null;
      try{
        const text=await readPdfTextFromFile(file);
        // DATE ENTERED 優先 → Sent フォールバック
        issuedDate = parseDateEntered(text) || parseSentDate(text);
        locationObj = parseLocation(text);
        issuerName  = parseIssuer(text);
        lotFromPdf  = parseLotQty(text);
        console.log('%c[p2r] parsed','color:#0b8',{issuedDate,issuerName,location:locationObj,lotFromPdf});
      }catch(e){ console.warn('[p2r] PDF parse skipped:', e.message); }

      // LOT デフォルト = PDF値 or 1
      let lot = parseInt(prompt('Enter LOT QTY', lotFromPdf ? String(lotFromPdf) : '1') || (lotFromPdf || 1), 10);
      if (!(lot > 0)) lot = 1;

      const subEl=$(SELECTORS.subject); if(!subEl){ alert('Subject field not found.'); return; }
      subEl.value = lot>1?`${base} (#1/${lot})`:base;

      if(issuedDate){ const el=$(SELECTORS.issuedDate); if(el){ try{ el.value=issuedDate; el.dispatchEvent(new Event('change',{bubbles:true})); }catch{} } }
      else{
        const manual=prompt('Could not find date in the PDF. Enter Issued Date (YYYY-MM-DD) or leave blank:','');
        if(manual){ const el=$(SELECTORS.issuedDate); if(el) el.value=manual; }
      }

      if(issuerName){ const issuerEl=findIssuerField(document); if(issuerEl){ try{ issuerEl.value=issuerName; issuerEl.dispatchEvent(new Event('input',{bubbles:true})); }catch{} } }

      if(locationObj){ const locEl=$(SELECTORS.location); if(locEl){
        setSelectByTextOrValue(locEl, locationObj.label) || setSelectByTextOrValue(locEl, locationObj.code) || setSelectByTextOrValue(locEl, (locationObj.label||'')); } }

      // Attach to QRT (preferred), fallback to Files
      attachFilePreferQRT(document, file);

      const stash={ base, total:lot, done:1, url:location.href, issuedDate, issuer:issuerName, location:locationObj, file };
      setStash(stash); renderPanel(stash);
      toast('Filled Subject in this tab (#1). Use the bottom-right panel to open the next tabs.');
      console.log('%c[p2r] ready','color:#0b8',{lot,firstSubject:subEl.value,issuedDate,issuerName,location:locationObj,attached:true});
    };
    pickInput.click();
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
