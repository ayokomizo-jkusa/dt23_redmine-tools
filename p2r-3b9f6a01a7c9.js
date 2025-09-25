/* Redmine helper (no-API): Subject from PDF filename, LOT-by-LOT tab opening,
   and PDF "DATE ENTERED" -> Redmine "Issued Date".
   UI: English
*/
(function () {
  try {
    /* ========== CONFIG ========== */
    const SELECTORS = {
      subject: '#issue_subject',
      issuedDate: '#issue_custom_field_values_15' // <- Issued Date field (your env)
    };
    const FILENAME_REPLACE_UNDERSCORE_TO_SLASH = false; // true if "QRT1234_56" -> "QRT1234/56"

    /* ========== Utilities ========== */
    const $ = (sel, root = document) => root.querySelector(sel);
    const toast = (msg) => {
      const d = document.createElement('div');
      d.style = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:999999;background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:12px system-ui';
      d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2200);
    };
    const assertOnNewIssue = () => {
      if (!$(SELECTORS.subject)) { alert('Subject field not found. Run on "New issue" page.'); throw new Error('Subject field not found'); }
    };

    /* ========== PDF helpers (lazy-load pdf.js) ========== */
    const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Failed to load: ' + src)); document.head.appendChild(s); });
    async function loadPdfJsIfNeeded(){ if(window.pdfjsLib) return; await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'); await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'); }
    async function readPdfTextFromFile(file){ await loadPdfJsIfNeeded(); const buf=await file.arrayBuffer(); const pdf=await pdfjsLib.getDocument({data:buf}).promise; let text=''; for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i); const c=await p.getTextContent(); text+=c.items.map(it=>it.str).join('\n')+'\n';} return text; }

    // Parse "DATE ENTERED" -> normalize to YYYY-MM-DD
    function parseDateEntered(pdfText){
      const line = pdfText.match(/DATE\s*ENTERED\s*[:\-]?\s*([0-9]{1,4}[\-\/\.][0-9]{1,2}[\-\/\.][0-9]{1,4})/i);
      if(!line) return null;
      const raw = line[1].trim();
      const sep = raw.includes('-')?'-':raw.includes('/')?'/':'.';
      const parts = raw.split(sep).map(x=>x.padStart(2,'0'));
      let y,m,d;
      if(parts[0].length===4){ [y,m,d]=parts; }
      else if(parts[2].length===4){
        const mm=parseInt(parts[0],10), dd=parseInt(parts[1],10);
        if(mm>=1&&mm<=12&&dd>=1&&dd<=31){ [m,d,y]=parts; } else { [d,m,y]=parts; }
      } else { return null; }
      return `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }

    /* ========== Batch panel (open one tab per click) ========== */
    const PANEL_ID='p2r_panel_v2', STASH_KEY='p2r_stash_v2';
    const getStash=()=>{try{return JSON.parse(localStorage.getItem(STASH_KEY)||'null')}catch{return null}};
    const setStash=(o)=>localStorage.setItem(STASH_KEY,JSON.stringify(o));
    const clearStash=()=>localStorage.removeItem(STASH_KEY);

    function ensurePanel(){ let p=document.getElementById(PANEL_ID); if(p) return p;
      p=document.createElement('div'); p.id=PANEL_ID;
      p.style='position:fixed;right:16px;bottom:16px;z-index:999999;background:#fff;border:1px solid #ccc;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.15);padding:10px 12px;font:12px system-ui;display:flex;gap:8px;align-items:center';
      document.body.appendChild(p); return p; }

    function renderPanel(stash){
      const p=ensurePanel(); p.innerHTML='';
      const remain = stash.total - stash.done;
      const info=document.createElement('div'); info.textContent=`${stash.base}   Remaining: ${remain}`;
      const btn=document.createElement('button'); btn.textContent=remain>0?`Open next tab (#${stash.done+1}/${stash.total})`:'Done'; btn.disabled=remain<=0;
      btn.style='padding:6px 10px;border-radius:8px;border:1px solid #999;background:#f6f6f6;cursor:pointer';
      const close=document.createElement('button'); close.textContent='×'; close.title='Close';
      close.style='padding:4px 8px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer'; close.onclick=()=>p.remove();
      btn.onclick=()=>{ const i=stash.done+1; const subject=stash.total>1?`${stash.base} (#${i}/${stash.total})`:stash.base;
        openAndFill(stash.url, subject, stash.dateEntered, ()=>{ stash.done++; setStash(stash); renderPanel(stash); }); };
      p.appendChild(info); p.appendChild(btn); p.appendChild(close);
    }

    function openAndFill(url, subject, dateEntered, doneCb){
      const w=window.open(url,'_blank'); if(!w){ alert('Popup was blocked. Please allow popups for this site.'); return; }
      let tick=0; const iv=setInterval(()=>{ try{
        tick++; if(!w||w.closed){clearInterval(iv);return;}
        const d=w.document; if(!d) return;
        const sub=d.querySelector(SELECTORS.subject); if(sub) sub.value=subject;
        if(dateEntered){ const issued=d.querySelector(SELECTORS.issuedDate); if(issued){ try{ issued.value=dateEntered; }catch{} } }
        if(sub){ clearInterval(iv); doneCb&&doneCb(); }
      }catch(_){/* wait same-origin */} if(tick>600) clearInterval(iv); },50);
    }

    /* ========== Main ========== */
    assertOnNewIssue();

    const cont=getStash();
    if(cont && cont.total>cont.done){ renderPanel(cont); return; }

    const pickFile=()=>new Promise(res=>{ const i=document.createElement('input'); i.type='file'; i.accept='application/pdf'; i.onchange=()=>res(i.files&&i.files[0]); i.click(); });

    pickFile().then(async (file)=>{
      if(!file) return;
      let base=file.name.replace(/\.pdf$/i,'');
      if(FILENAME_REPLACE_UNDERSCORE_TO_SLASH) base=base.replace('_','/');

      let dateEntered=null;
      try{ const text=await readPdfTextFromFile(file); dateEntered=parseDateEntered(text); }
      catch(e){ console.warn('PDF parse skipped:', e.message); }

      let lot=parseInt(prompt('Enter LOT QTY (default=1)','1')||'1',10); if(!(lot>0)) lot=1;

      const subjectInput=$(SELECTORS.subject); if(!subjectInput){ alert('Subject field not found.'); return; }
      subjectInput.value = lot>1?`${base} (#1/${lot})`:base;

      if(dateEntered){ const issued=$(SELECTORS.issuedDate); if(issued){ try{ issued.value=dateEntered; }catch{} } }
      else{ const manual=prompt('DATE ENTERED not found. Enter Issued Date (YYYY-MM-DD) or leave blank:',''); if(manual){ const issued=$(SELECTORS.issuedDate); if(issued) issued.value=manual; } }

      const stash={ base, total:lot, done:1, url:location.href, dateEntered };
      setStash(stash); renderPanel(stash);
      toast('Filled Subject in this tab (#1). Use the bottom-right panel to open the next tabs.');
    });
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
