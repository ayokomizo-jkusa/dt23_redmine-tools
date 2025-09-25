// p2r-xxxxxxxxxxxx.js  — Redmine: 新規チケット件名をPDF名＆LOTで入力、#2以降はボタンで1タブずつ開く
(function () {
  try {
    const SUB = '#issue_subject';
    const el = document.querySelector(SUB);
    if (!el) {
      alert('件名欄(#issue_subject)が見つかりません。「新しいチケット」画面で実行してください。');
      return;
    }

    const pickFile = () =>
      new Promise((resolve) => {
        const i = document.createElement('input');
        i.type = 'file';
        i.accept = 'application/pdf';
        i.onchange = () => resolve(i.files && i.files[0]);
        i.click();
      });

    const panelId = 'p2r_panel_v2';
    const stashKey = 'p2r_stash_v2';
    const getStash = () => {
      try { return JSON.parse(localStorage.getItem(stashKey) || 'null'); } catch { return null; }
    };
    const setStash = (o) => localStorage.setItem(stashKey, JSON.stringify(o));
    const clearStash = () => localStorage.removeItem(stashKey);

    const toast = (m) => {
      const d = document.createElement('div');
      d.style = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:999999;background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:12px system-ui';
      d.textContent = m;
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 2000);
    };

    const openAndFill = (url, subject, doneCb) => {
      const w = window.open(url, '_blank');
      if (!w) {
        alert('ポップアップがブロックされました。右上のアイコンから「このサイトのポップアップを常に許可」にしてください。');
        return;
      }
      let tick = 0;
      const iv = setInterval(() => {
        try {
          tick++;
          if (!w || w.closed) { clearInterval(iv); return; }
          const d = w.document;
          if (!d) return;
          const inp = d.querySelector(SUB);
          if (inp) {
            inp.value = subject;
            clearInterval(iv);
            doneCb && doneCb();
          }
        } catch (_) { /* 同一オリジン読み込み待ち */ }
        if (tick > 600) { clearInterval(iv); }
      }, 50);
    };

    const ensurePanel = () => {
      let p = document.getElementById(panelId);
      if (p) return p;
      p = document.createElement('div');
      p.id = panelId;
      p.style = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#fff;border:1px solid #ccc;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.15);padding:10px 12px;font:12px system-ui;display:flex;gap:8px;align-items:center';
      document.body.appendChild(p);
      return p;
    };

    const renderPanel = (stash) => {
      const p = ensurePanel();
      p.innerHTML = '';
      const remain = stash.total - stash.done;
      const info = document.createElement('div');
      info.textContent = `${stash.base}  残り:${remain}`;

      const btn = document.createElement('button');
      btn.textContent = remain > 0 ? `次のタブを開く（#${stash.done + 1}/${stash.total}）` : '完了';
      btn.disabled = remain <= 0;
      btn.style = 'padding:6px 10px;border-radius:8px;border:1px solid #999;background:#f6f6f6;cursor:pointer';

      const close = document.createElement('button');
      close.textContent = '×';
      close.title = '閉じる';
      close.style = 'padding:4px 8px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer';
      close.onclick = () => { p.remove(); };

      btn.onclick = () => {
        const i = stash.done + 1;
        const subject = stash.total > 1 ? `${stash.base} (#${i}/${stash.total})` : stash.base;
        openAndFill(stash.url, subject, () => {
          stash.done++;
          setStash(stash);
          renderPanel(stash);
        });
      };

      p.appendChild(info);
      p.appendChild(btn);
      p.appendChild(close);
    };

    // 途中からの継続対応
    const cont = getStash();
    if (cont && cont.total > cont.done) {
      renderPanel(cont);
      return;
    }

    // 初回：PDF選択→LOT入力→今のタブに#1を反映、残りは右下パネルから
    pickFile().then((f) => {
      if (!f) return;
      let base = f.name.replace(/\.pdf$/i, '');
      // 例： "_" を "/" にしたい場合は次行のコメントを外す
      // base = base.replace('_','/');

      let lot = parseInt(prompt('LOT QTY を入力（未入力=1）', '1') || '1', 10);
      if (!(lot > 0)) lot = 1;

      el.value = lot > 1 ? `${base} (#1/${lot})` : base;

      const stash = { base, total: lot, done: 1, url: location.href };
      setStash(stash);
      renderPanel(stash);
      toast('件名を入力しました。このタブが #1 です。右下ボタンで次を開けます。');
    });
  } catch (e) {
    alert('エラー: ' + e.message);
  }
})();
