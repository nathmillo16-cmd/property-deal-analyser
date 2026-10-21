// refurb-scope-pdf.js: the "Scope of works" PDF from the Refurbishment
// Estimator. Client-side with jsPDF (same CDN script and Sora fonts as the
// Property Pack on saved-deals.html). Built only from what is on the
// estimate: no figure is worked out here that the estimator doesn't show.
//
// Prices can be hidden, for sending to builders to quote against.
// Needs refurb-totals.js and refurb-templates.js loaded first.
(function () {
  const INDIGO = [75, 69, 178];
  const INK = [28, 28, 26];
  const MUTED = [107, 107, 102];
  const RULE = [225, 223, 218];
  const SOFT = [245, 245, 244];

  let fontsPromise = null;
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function loadFonts() {
    if (!fontsPromise) {
      fontsPromise = Promise.all([
        fetch('/fonts/Sora-Regular.ttf').then(r => { if (!r.ok) throw new Error('font'); return r.arrayBuffer(); }),
        fetch('/fonts/Sora-Bold.ttf').then(r => { if (!r.ok) throw new Error('font'); return r.arrayBuffer(); }),
      ]).then(([a, b]) => ({ regular: bufToB64(a), bold: bufToB64(b) }))
        .catch(e => { fontsPromise = null; throw e; });
    }
    return fontsPromise;
  }
  async function registerFonts(doc) {
    try {
      const f = await loadFonts();
      doc.addFileToVFS('Sora-Regular.ttf', f.regular); doc.addFont('Sora-Regular.ttf', 'Sora', 'normal');
      doc.addFileToVFS('Sora-Bold.ttf', f.bold); doc.addFont('Sora-Bold.ttf', 'Sora', 'bold');
      return 'Sora';
    } catch (e) { return 'helvetica'; }
  }

  // Image URL -> { data, w, h, fmt } or null. Never throws.
  async function loadImage(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
      const dims = await new Promise(resolve => { const i = new Image(); i.onload = () => resolve({ w: i.width, h: i.height }); i.onerror = () => resolve(null); i.src = data; });
      if (!dims) return null;
      return { data, w: dims.w, h: dims.h, fmt: /png/i.test(blob.type) ? 'PNG' : 'JPEG' };
    } catch (e) { return null; }
  }

  function money(v) { return '£' + Math.round(v || 0).toLocaleString('en-GB'); }
  function rateText(v) { const n = Number(v); return '£' + n.toLocaleString('en-GB', n % 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}); }
  function qtyText(q, unit) { const n = Math.round(Number(q) * 100) / 100; return n.toLocaleString('en-GB') + ' ' + (unit || ''); }
  function slug(s) { return String(s || 'scope-of-works').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'scope-of-works'; }

  async function generate(o) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const FONT = await registerFonts(doc);
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const M = 40, CW = W - M * 2, FOOT = 46;
    let y = M;

    const set = (size, bold, color) => { doc.setFont(FONT, bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(color || INK)); };
    const space = need => { if (y + need > H - FOOT) { doc.addPage(); y = M; return true; } return false; };

    // ---- header ----
    const logo = await loadImage('/assets/propulsion-logo.png');
    if (logo) { const lh = 26, lw = lh * logo.w / logo.h; doc.addImage(logo.data, 'PNG', M, y, lw, lh); }
    set(9, false, MUTED);
    doc.text('Generated ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), W - M, y + 16, { align: 'right' });
    y += 50;
    set(24, true, INK); doc.text('Scope of works', M, y); y += 22;
    const where = o.address || o.name;
    set(13, false, INK);
    doc.splitTextToSize(where, CW).slice(0, 2).forEach(line => { doc.text(line, M, y); y += 17; });
    if (o.address && o.name && o.name !== o.address) { set(10, false, MUTED); doc.text(doc.splitTextToSize(o.name, CW)[0], M, y); y += 14; }
    const meta = [o.scopeLabel, o.durationWeeks ? 'Expected duration ' + o.durationWeeks + (o.durationWeeks === 1 ? ' week' : ' weeks') : null,
      o.epc && (o.epc.current || o.epc.target) ? 'EPC ' + (o.epc.current || '?') + (o.epc.target ? ' to ' + o.epc.target : '') : null].filter(Boolean);
    if (meta.length) { set(10, false, MUTED); doc.text(meta.join('   ·   '), M, y + 2); y += 14; }
    y += 6;
    doc.setFillColor(...INDIGO); doc.rect(M, y, CW, 3, 'F'); y += 22;

    const prices = !!o.includePrices;
    // Columns: with prices  Item | Qty | Rate | Total ; without  Item | Qty
    const COL = prices ? { label: 255, qty: M + 345, rate: M + 430, total: W - M } : { label: 380, qty: W - M };

    function tableHead() {
      set(8, true, MUTED);
      doc.text('ITEM', M, y);
      doc.text('QTY', COL.qty, y, { align: 'right' });
      if (prices) { doc.text('RATE', COL.rate, y, { align: 'right' }); doc.text('TOTAL', COL.total, y, { align: 'right' }); }
      y += 6; doc.setDrawColor(...RULE); doc.setLineWidth(.6); doc.line(M, y, W - M, y); y += 13;
    }
    function heading(text, right) {
      space(50);
      set(12.5, true, INDIGO); doc.text(text, M, y);
      if (right) { set(10.5, true, INK); doc.text(right, W - M, y, { align: 'right' }); }
      y += 16; tableHead();
    }
    function row(r) {
      set(10, false, INK);
      const lines = doc.splitTextToSize(r.label, COL.label);
      const noteLines = r.note ? (set(8.5, false, MUTED), doc.splitTextToSize(r.note, COL.label)) : [];
      const h = lines.length * 13 + noteLines.length * 11 + 6;
      if (space(h)) tableHead();
      set(10, false, INK);
      lines.forEach((l, i) => doc.text(l, M, y + i * 13));
      if (r.qty != null) doc.text(qtyText(r.qty, r.unit), COL.qty, y, { align: 'right' });
      if (prices) {
        doc.text(r.rate != null ? rateText(r.rate) : (r.amount != null ? '' : 'No rate'), COL.rate, y, { align: 'right' });
        set(10, true, INK); doc.text(r.rate != null && r.qty != null ? money(r.rate * r.qty) : (r.amount != null ? money(r.amount) : '-'), COL.total, y, { align: 'right' });
      }
      let yy = y + lines.length * 13;
      if (noteLines.length) { set(8.5, false, MUTED); noteLines.forEach((l, i) => doc.text(l, M + 8, yy - 2 + i * 11)); yy += noteLines.length * 11; }
      y = yy + 4;
      doc.setDrawColor(...SOFT); doc.setLineWidth(.5); doc.line(M, y - 6, W - M, y - 6);
    }
    async function photos(paths) {
      if (!o.includePhotos || !paths || !paths.length) return;
      const box = 112, gap = 10, perRow = Math.floor((CW + gap) / (box + gap));
      const imgs = [];
      for (const p of paths.slice(0, 8)) { const url = o.photoUrls && o.photoUrls[p]; if (url) { const im = await loadImage(url); if (im) imgs.push(im); } }
      for (let i = 0; i < imgs.length; i += perRow) {
        space(box + 12);
        imgs.slice(i, i + perRow).forEach((im, j) => {
          const s = Math.min(box / im.w, box / im.h); const w = im.w * s, h = im.h * s;
          const x = M + j * (box + gap) + (box - w) / 2;
          doc.setFillColor(...SOFT); doc.rect(M + j * (box + gap), y, box, box, 'F');
          doc.addImage(im.data, im.fmt, x, y + (box - h) / 2, w, h);
        });
        y += box + 12;
      }
    }
    function sectionTotalText(items) { if (!prices) return null; const t = items.reduce((s, r) => s + (r.rate != null && r.qty != null ? r.rate * r.qty : (r.amount || 0)), 0); return money(t); }

    const li = o.lineItems || {};
    const extras = o.lineExtras || {};
    const unitOf = key => (extras[key] && extras[key].unit) || (li[key] && li[key].unit) || ((refurbItemByKey(key) || {}).item || {}).unit || '';
    let anything = false;

    if (o.mode === 'quick') {
      const items = QUICK_TRADES.filter(t => Number(li[t.id]) > 0).map(t => ({ label: t.label, qty: null, amount: Number(li[t.id]), rate: null }));
      if (items.length) {
        anything = true;
        heading('Work by trade', sectionTotalText(items));
        items.forEach(r => row({ ...r, rate: null }));
      }
    } else if (o.groupBy === 'room' && o.roomState && o.roomState.type) {
      const rs = o.roomState;
      const m = refurbMeasures(rs.type, rs.beds);
      const covered = {};
      for (const card of refurbRoomCards(rs.type, rs.beds)) {
        const ch = (rs.choices || {})[card.cardId] || {};
        if (ch.condition !== 'refresh' && ch.condition !== 'replace') continue;
        const items = [];
        (card.room[ch.condition] || []).forEach(rule => {
          if (!refurbRuleApplies(rule, rs.type)) return;
          const q = refurbResolveQty(rule, m); if (!(q > 0)) return;
          const x = refurbItemByKey(rule.key); if (!x) return;
          covered[rule.key] = (covered[rule.key] || 0) + q;
          const l = li[rule.key] || {};
          items.push({ label: x.item.label, qty: q, unit: unitOf(rule.key), rate: l.rate != null ? l.rate : null });
        });
        anything = true;
        heading(card.label + '  ·  ' + (ch.condition === 'replace' ? 'Replace' : 'Refresh'), sectionTotalText(items));
        items.forEach(row);
        if (ch.note) { set(9.5, false, MUTED); const nl = doc.splitTextToSize('Note: ' + ch.note, CW); space(nl.length * 12 + 4); nl.forEach(l => { doc.text(l, M, y); y += 12; }); y += 4; }
        await photos(ch.photos);
        y += 8;
      }
      // Anything on the estimate beyond what the rooms account for.
      const other = [];
      refurbItemList().forEach(({ key, item }) => {
        const l = li[key]; if (!l || !(Number(l.qty) > 0)) return;
        const extra = Math.round((Number(l.qty) - (covered[key] || 0)) * 100) / 100;
        if (extra > 0) other.push({ key, label: item.label, qty: extra, unit: unitOf(key), rate: l.rate != null ? l.rate : null, note: (extras[key] || {}).note || l.note });
      });
      if (other.length) {
        anything = true;
        heading('Other work', sectionTotalText(other));
        for (const r of other) { row(r); await photos((extras[r.key] || {}).photos || (li[r.key] || {}).photos); }
      }
    } else {
      for (const s of REFURB_SECTIONS) {
        const items = s.items.map(it => {
          const key = s.id + '.' + it.id, l = li[key];
          if (!l || !(Number(l.qty) > 0)) return null;
          return { key, label: it.label, qty: Number(l.qty), unit: unitOf(key), rate: l.rate != null ? l.rate : null, note: (extras[key] || {}).note || l.note };
        }).filter(Boolean);
        if (!items.length) continue;
        anything = true;
        heading(s.name, sectionTotalText(items));
        for (const r of items) { row(r); await photos((extras[r.key] || {}).photos || (li[r.key] || {}).photos); }
        y += 8;
      }
    }

    // By category (or quick): room photos still go in, under their room.
    if (o.includePhotos && o.groupBy !== 'room' && o.roomState && o.roomState.type) {
      const withPhotos = refurbRoomCards(o.roomState.type, o.roomState.beds).filter(c => { const ch = (o.roomState.choices || {})[c.cardId]; return ch && ch.photos && ch.photos.length; });
      if (withPhotos.length) {
        space(50); set(12.5, true, INDIGO); doc.text('Photos', M, y); y += 18;
        for (const c of withPhotos) {
          const ch = o.roomState.choices[c.cardId];
          space(130); set(10, true, INK); doc.text(c.label, M, y); y += 12;
          if (ch.note) { set(9, false, MUTED); doc.splitTextToSize(ch.note, CW).forEach(l => { doc.text(l, M, y); y += 11; }); }
          y += 4; await photos(ch.photos);
        }
      }
    }

    if (!anything) { set(11, false, MUTED); doc.text('No work has been added to this estimate yet.', M, y); y += 20; }

    // ---- totals or a note for builders ----
    if (prices && anything) {
      space(120);
      y += 6;
      const t = o.totals;
      const lines = [['Subtotal', money(t.subtotal)]];
      if (t.contingencyAmt > 0) lines.push(['Contingency (' + o.contingencyPct + '%)', money(t.contingencyAmt)]);
      if (t.vatAmt > 0) lines.push(['VAT (' + o.vatRate + '%)', money(t.vatAmt)]);
      const bx = M + CW / 2, bw = CW / 2;
      lines.forEach(([k, v]) => { set(10, false, MUTED); doc.text(k, bx, y); set(10, true, INK); doc.text(v, W - M, y, { align: 'right' }); y += 16; });
      doc.setFillColor(...INDIGO); doc.roundedRect(bx - 10, y - 4, bw + 10, 34, 6, 6, 'F');
      set(11, true, [255, 255, 255]); doc.text('Grand total', bx, y + 17); doc.text(money(t.grandTotal), W - M - 10, y + 17, { align: 'right' });
      y += 46;
    } else if (anything) {
      space(60);
      y += 6;
      doc.setFillColor(...SOFT); doc.roundedRect(M, y, CW, 44, 6, 6, 'F');
      set(10, true, INK); doc.text('Please price the work listed above.', M + 14, y + 18);
      set(9, false, MUTED); doc.text('Quantities are estimates. Please check them on site and say what your price includes.', M + 14, y + 32);
      y += 56;
    }

    // ---- footer on every page ----
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor(...RULE); doc.setLineWidth(.6); doc.line(M, H - 32, W - M, H - 32);
      set(8, false, MUTED);
      doc.text('Prepared with PROPulsion. Quantities are estimates and should be checked on site.', M, H - 19);
      doc.text('Page ' + i + ' of ' + pages, W - M, H - 19, { align: 'right' });
    }

    doc.save(slug(o.address || o.name) + '-scope-of-works' + (prices ? '' : '-no-prices') + '.pdf');
    return doc;
  }

  window.RefurbScopePdf = { generate };
})();
