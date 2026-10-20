// tax-summary.js: the Portfolio page's "Tax year summary" (db/047).
// Shows, per property and in total, rent received, expenses by category,
// mortgage interest (finance costs) kept separate, and profit before
// finance costs, for one UK tax year (6 April to 5 April). Exports a
// branded PDF (jsPDF, Sora embedded, same as the Property Pack) and a CSV.
//
// Every figure comes from GET /api/portfolio/tax-summary. Nothing is
// worked out here except adding up what the server already returned for
// display, and nothing is sent anywhere: it's a summary of the user's own
// records to hand to their accountant, not a tax return.

var TaxSummary = (function () {
  var DISCLAIMER = 'Summary of your records to share with your accountant. Not a tax return.';
  var DETAIL = 'Rent is counted in the tax year of the date it was due. Expenses are counted on their own date. Mortgage interest is shown separately as finance costs and is not deducted from profit. No tax is worked out here and nothing is sent to HMRC.';
  var current = null;

  function esc(s) { return PF.esc(s); }
  function propCount(n) { return n === 1 ? '1 property' : n + ' properties'; }
  function money(v) { return PF.gbp2(v); }
  function catKeys(data) { return Object.keys(data.categories).filter(function (k) { return k !== 'mortgage_interest'; }); }

  // ---------- on screen ----------
  function cardHtml(title, p, data, isTotal) {
    var lines = '<div class="tx-line"><span>Rent received</span><span>' + money(p.rent_received) + '</span></div>';
    var cats = catKeys(data).filter(function (k) { return p.expenses_by_category[k]; });
    lines += '<div class="tx-line"><span>Expenses</span><span></span></div>';
    lines += cats.length
      ? cats.map(function (k) { return '<div class="tx-line sub"><span>' + esc(data.categories[k]) + '</span><span>' + money(p.expenses_by_category[k]) + '</span></div>'; }).join('')
      : '<div class="tx-line sub"><span>None logged</span><span></span></div>';
    lines += '<div class="tx-line"><span>Total expenses</span><span>' + money(p.total_expenses) + '</span></div>';
    lines += '<div class="tx-line strong"><span>Profit before finance costs</span><span>' + money(p.profit_before_finance_costs) + '</span></div>';
    lines += '<div class="tx-line finance"><span>Finance costs (mortgage interest)</span><span>' + money(p.finance_costs) + '</span></div>';
    var note = isTotal
      ? 'Across ' + propCount(data.properties.length) + '.'
      : PF.plural(p.rent_months_logged, 'rent month') + ' and ' + PF.plural(p.expense_items.length, 'expense') + ' in this tax year.';
    return '<div class="tx-card' + (isTotal ? ' total' : '') + '"><h3>' + esc(title) + '</h3>' + lines + '<p class="tx-note">' + esc(note) + '</p></div>';
  }

  function render(el, data) {
    if (!data.properties.length) { el.innerHTML = '<p class="hint">No properties yet.</p>'; return; }
    var empty = data.properties.every(function (p) { return !p.rent_months_logged && !p.expense_items.length; });
    el.innerHTML =
      (empty ? '<p class="hint" style="margin-bottom:1rem">Nothing logged for this tax year yet. Mark rent and add expenses on each property page.</p>' : '') +
      cardHtml('All properties', data.totals, data, true) +
      data.properties.map(function (p) { return cardHtml(p.address + (p.postcode ? ', ' + p.postcode : ''), p, data, false); }).join('') +
      '<p class="tx-note">' + esc(DETAIL) + '</p>';
  }

  function load(opts) {
    current = null;
    opts.pdfBtn.disabled = opts.csvBtn.disabled = true;
    opts.body.innerHTML = '<p class="hint">Loading…</p>';
    return fetch(opts.apiBase + '/api/portfolio/tax-summary?year=' + encodeURIComponent(opts.year), { headers: { 'Authorization': 'Bearer ' + opts.token } })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          if (res.status === 409 && d.needs_migration) throw new Error('The tax year summary needs a quick database update before it can be used.');
          if (!res.ok) throw new Error(d.error || 'Could not load the summary.');
          return d;
        });
      })
      .then(function (d) {
        current = d;
        render(opts.body, d);
        opts.pdfBtn.disabled = opts.csvBtn.disabled = !d.properties.length;
      })
      .catch(function (e) { opts.body.innerHTML = '<p class="hint">' + esc(e.message) + '</p>'; });
  }

  function slug() { return 'tax-year-summary-' + current.year + '-' + String(current.year + 1).slice(2); }
  function longDate(d) { return PF.date(d); }

  // ---------- CSV ----------
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function num(v) { return (Math.round(Number(v) * 100) / 100).toFixed(2); }
  var RENT_STATUS = { received: 'Received', part: 'Part paid', late: 'Late', missed: 'Missed' };

  function buildCsv(d) {
    var keys = catKeys(d);
    var rows = [];
    rows.push(['Tax year summary', longDate(d.start) + ' to ' + longDate(d.end)]);
    rows.push([DISCLAIMER]);
    rows.push([DETAIL]);
    rows.push([]);
    rows.push(['Property', 'Postcode', 'Rent received'].concat(keys.map(function (k) { return d.categories[k]; }))
      .concat(['Total expenses', 'Profit before finance costs', 'Finance costs (mortgage interest)']));
    var line = function (name, postcode, p) {
      return [name, postcode || '', num(p.rent_received)].concat(keys.map(function (k) { return num(p.expenses_by_category[k]); }))
        .concat([num(p.total_expenses), num(p.profit_before_finance_costs), num(p.finance_costs)]);
    };
    d.properties.forEach(function (p) { rows.push(line(p.address, p.postcode, p)); });
    rows.push(line('Total', '', d.totals));
    rows.push([]);
    rows.push(['Transactions']);
    rows.push(['Property', 'Date', 'Type', 'Category or status', 'Description', 'Amount']);
    d.properties.forEach(function (p) {
      p.rent_items.forEach(function (r) {
        rows.push([p.address, r.due_date, 'Rent', RENT_STATUS[r.status], 'Rent for ' + PF.monthLabel(r.month, true) + ' (expected ' + num(r.expected) + ')', num(r.received)]);
      });
      p.expense_items.forEach(function (e) {
        rows.push([p.address, e.date, e.category === 'mortgage_interest' ? 'Finance cost' : 'Expense', e.category_label, e.description, num(e.amount)]);
      });
    });
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function downloadCsv() {
    if (!current) return;
    downloadBlob(new Blob([buildCsv(current)], { type: 'text/csv;charset=utf-8' }), slug() + '.csv');
  }

  // ---------- PDF ----------
  // Sora, fetched once and cached as base64 (same pattern as the Property
  // Pack in saved-deals.html). Self-clearing on failure so one dropped
  // request doesn't block every later attempt.
  var fontsPromise = null;
  function bufToBase64(buf) {
    var bytes = new Uint8Array(buf), bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function loadFonts() {
    if (!fontsPromise) {
      fontsPromise = Promise.all([
        fetch('/fonts/Sora-Regular.ttf').then(function (r) { if (!r.ok) throw new Error('font'); return r.arrayBuffer(); }),
        fetch('/fonts/Sora-Bold.ttf').then(function (r) { if (!r.ok) throw new Error('font'); return r.arrayBuffer(); })
      ]).then(function (b) { return { regular: bufToBase64(b[0]), bold: bufToBase64(b[1]) }; })
        .catch(function (e) { fontsPromise = null; throw e; });
    }
    return fontsPromise;
  }

  var INDIGO = [75, 69, 178], INK = [28, 27, 34], MUTED = [110, 108, 120], RULE = [225, 223, 216], TINT = [243, 242, 251];

  function buildPdf(d, fonts) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'a4' });
    var F = 'helvetica';
    if (fonts) {
      doc.addFileToVFS('Sora-Regular.ttf', fonts.regular); doc.addFont('Sora-Regular.ttf', 'Sora', 'normal');
      doc.addFileToVFS('Sora-Bold.ttf', fonts.bold); doc.addFont('Sora-Bold.ttf', 'Sora', 'bold');
      F = 'Sora';
    }
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var M = 44, CW = W - M * 2, BOTTOM = H - 60;
    var y = 0;
    var font = function (weight, size, color) { doc.setFont(F, weight); doc.setFontSize(size); doc.setTextColor.apply(doc, color || INK); };
    var newPage = function () { doc.addPage(); y = M; };
    var ensure = function (h) { if (y + h > BOTTOM) newPage(); };
    var right = function (text, x, yy) { doc.text(text, x, yy, { align: 'right' }); };

    // Header band
    doc.setFillColor.apply(doc, INDIGO); doc.rect(0, 0, W, 104, 'F');
    font('bold', 22, [255, 255, 255]); doc.text('Tax year summary', M, 50);
    font('normal', 11, [255, 255, 255]); doc.text(longDate(d.start) + ' to ' + longDate(d.end), M, 72);
    font('bold', 11, [255, 255, 255]); right('PROPulsion', W - M, 46);
    font('normal', 9, [255, 255, 255]); right('Generated ' + longDate(PF.todayStr()), W - M, 64);
    y = 132;

    // Disclaimer, up front where an accountant will see it first
    font('normal', 9.5, INK);
    var dl = doc.splitTextToSize(DISCLAIMER + ' ' + DETAIL, CW - 24);
    var dh = dl.length * 13 + 18;
    doc.setFillColor.apply(doc, TINT); doc.roundedRect(M, y, CW, dh, 6, 6, 'F');
    doc.text(dl, M + 12, y + 18, { lineHeightFactor: 1.35 });
    y += dh + 26;

    var keys = catKeys(d);
    var sectionTitle = function (title, sub) {
      ensure(60);
      font('bold', 13, INK);
      var tl = doc.splitTextToSize(title, CW);
      doc.text(tl, M, y); y += (tl.length - 1) * 16;
      if (sub) { font('normal', 9, MUTED); doc.text(sub, M, y + 14); y += 14; }
      y += 10;
      doc.setDrawColor.apply(doc, RULE); doc.setLineWidth(0.8); doc.line(M, y, W - M, y);
      y += 16;
    };
    var row = function (label, value, opts) {
      opts = opts || {};
      ensure(18);
      var x = M + (opts.indent ? 14 : 0);
      font(opts.bold ? 'bold' : 'normal', opts.small ? 9.5 : 10.5, opts.muted ? MUTED : INK);
      var ll = doc.splitTextToSize(label, CW - 130 - (opts.indent ? 14 : 0));
      doc.text(ll, x, y);
      if (value != null) right(value, W - M, y);
      y += Math.max(1, ll.length) * 14 + (opts.gapAfter || 2);
    };
    var rule = function () { doc.setDrawColor.apply(doc, RULE); doc.setLineWidth(0.6); doc.line(M, y - 9, W - M, y - 9); y += 4; };

    var figures = function (p) {
      row('Rent received', money(p.rent_received), { bold: true, gapAfter: 6 });
      row('Expenses', null, { bold: true });
      keys.forEach(function (k) { row(d.categories[k], money(p.expenses_by_category[k]), { indent: true, small: true, muted: !p.expenses_by_category[k] }); });
      y += 4; rule();
      row('Total expenses', money(p.total_expenses), { bold: true, gapAfter: 6 });
      rule();
      row('Profit before finance costs', money(p.profit_before_finance_costs), { bold: true, gapAfter: 10 });
      row('Finance costs (mortgage interest)', money(p.finance_costs), { bold: true });
      row('Shown separately. Not deducted from the profit above.', null, { small: true, muted: true, gapAfter: 8 });
    };

    // Totals first
    sectionTitle('All properties', propCount(d.properties.length));
    figures(d.totals);
    y += 14;

    // Each property: figures, then the itemised records behind them
    d.properties.forEach(function (p) {
      // Heading plus the full figure block (about 330pt) start on one page.
      ensure(340);
      sectionTitle(p.address + (p.postcode ? ', ' + p.postcode : ''), p.property_type);
      figures(p);
      if (p.rent_items.length) {
        y += 4; ensure(40);
        font('bold', 10, INK); doc.text('Rent by month', M, y); y += 16;
        p.rent_items.forEach(function (r) {
          row(PF.monthLabel(r.month, true) + ' · due ' + longDate(r.due_date) + ' · ' + RENT_STATUS[r.status] + (r.status === 'received' ? '' : ' (expected ' + money(r.expected) + ')'), money(r.received), { small: true });
        });
      }
      if (p.expense_items.length) {
        y += 6; ensure(40);
        font('bold', 10, INK); doc.text('Expenses and finance costs', M, y); y += 16;
        p.expense_items.forEach(function (e) {
          row(longDate(e.date) + ' · ' + e.category_label + (e.description ? ' · ' + e.description : ''), money(e.amount), { small: true });
        });
      }
      if (!p.rent_items.length && !p.expense_items.length) row('Nothing logged for this property in this tax year.', null, { small: true, muted: true });
      y += 18;
    });

    // Footer on every page
    var pages = doc.getNumberOfPages();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor.apply(doc, RULE); doc.setLineWidth(0.6); doc.line(M, H - 40, W - M, H - 40);
      font('normal', 8, MUTED);
      doc.text(DISCLAIMER, M, H - 26);
      right('Page ' + i + ' of ' + pages, W - M, H - 26);
    }
    return doc;
  }

  function downloadPdf() {
    if (!current) return;
    var data = current;
    var btn = document.getElementById('pf-tax-pdf');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    // If the font can't be fetched the PDF still downloads, in Helvetica.
    return loadFonts().catch(function () { return null; }).then(function (fonts) {
      buildPdf(data, fonts).save(slug() + '.pdf');
    }).finally(function () { if (btn) { btn.disabled = false; btn.textContent = 'Download PDF'; } });
  }

  return { DISCLAIMER: DISCLAIMER, load: load, downloadPdf: downloadPdf, downloadCsv: downloadCsv, buildCsv: buildCsv, buildPdf: buildPdf, current: function () { return current; } };
})();
