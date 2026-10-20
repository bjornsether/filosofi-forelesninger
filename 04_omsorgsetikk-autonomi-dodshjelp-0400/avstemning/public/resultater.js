// Tegner avstemningsresultater. Delt av dekkene (avstemning-deck.js) og
// foreleser-siden (foreleser.html), så begge viser nøyaktig det samme.
//
//   AvstemningResultater.render(boks, spørsmål, rader, skjult)
//     boks      element med klassen poll-results
//     spørsmål  { id, type, n, labels, items, ... } (som i sessions/{økt}.current)
//     rader     svardokumentene (eller spørsmålsdokumentene for type 'qa')
//     skjult    true = vis bare antall svar, ikke fordelingen (gjelder ikke Q&A)
(function () {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function millis(ts) { return ts && ts.toMillis ? ts.toMillis() : Date.now(); }

  function newestFirst(rows) {
    return rows.slice().sort(function (a, b) { return millis(b.ts) - millis(a.ts); });
  }

  // Stolper: flervalg og skala. correct = riktig alternativ (1-indeksert), eller null/ukjent
  function bars(s, rows, correct) {
    var counts = [];
    for (var i = 0; i < s.n; i++) counts.push(0);
    rows.forEach(function (r) { if (r.value >= 1 && r.value <= s.n) counts[r.value - 1]++; });
    var max = Math.max.apply(null, counts) || 1;
    var wrap = el('div', 'pr-bars');
    counts.forEach(function (c, i) {
      var right = correct === i + 1;
      var col = el('div', 'pr-col' + (right ? ' pr-correct' : ''));
      if (right) col.appendChild(el('div', 'pr-check', '✓'));
      col.appendChild(el('div', 'pr-count', String(c)));
      var track = el('div', 'pr-track');
      var bar = el('div', 'pr-bar');
      bar.style.height = (c / max * 100) + '%';
      track.appendChild(bar);
      col.appendChild(track);
      col.appendChild(el('div', 'pr-label', String(i + 1)));
      if (s.type === 'scale') {
        var sub = s.labels && (i === 0 ? s.labels[0] : i === s.n - 1 ? s.labels[1] : '');
        col.appendChild(el('div', 'pr-sublabel', sub || ''));
      }
      wrap.appendChild(col);
    });
    return wrap;
  }

  var CLOUD_COLORS = ['var(--ntnu-blue)', 'var(--magenta)', 'var(--purple)', 'var(--teal)', 'var(--brown)'];

  function cloud(s, rows) {
    var freq = {};
    rows.forEach(function (r) {
      var w = String(r.value).trim().toLowerCase();
      if (w) freq[w] = (freq[w] || 0) + 1;
    });
    var words = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 40);
    var max = freq[words[0]] || 1;
    var wrap = el('div', 'pr-cloud');
    words.forEach(function (w, i) {
      var span = el('span', null, w);
      span.style.fontSize = (0.8 + 1.9 * freq[w] / max).toFixed(2) + 'em';
      span.style.color = CLOUD_COLORS[i % CLOUD_COLORS.length];
      wrap.appendChild(span);
    });
    return wrap;
  }

  function cards(texts) {
    var wrap = el('div', 'pr-cards');
    texts.slice(0, 12).forEach(function (t) { wrap.appendChild(el('div', 'pr-card', t)); });
    return wrap;
  }

  function openAnswers(s, rows) {
    return cards(newestFirst(rows).map(function (r) { return String(r.value); }));
  }

  // Q&A: bare ubesvarte spørsmål, nyeste først (besvarte merkes på foreleser-siden)
  function questions(s, rows) {
    return cards(newestFirst(rows).map(function (r) { return String(r.text); }));
  }

  // Rangering: gjennomsnittlig plassering per alternativ (1 = rangert øverst)
  function ranking(s, rows) {
    var sum = s.items.map(function () { return 0; });
    var count = 0;
    rows.forEach(function (r) {
      if (!Array.isArray(r.value) || r.value.length !== s.n) return;
      count++;
      r.value.forEach(function (item, pos) { if (item >= 0 && item < s.n) sum[item] += pos + 1; });
    });
    var avg = sum.map(function (x) { return count ? x / count : 0; });
    var order = s.items.map(function (_, i) { return i; }).sort(function (a, b) { return avg[a] - avg[b]; });
    var wrap = el('div', 'pr-rank');
    order.forEach(function (i, place) {
      var row = el('div', 'pr-rank-row');
      row.appendChild(el('span', 'pr-rank-name', (place + 1) + '. ' + s.items[i]));
      var track = el('div', 'pr-rank-track');
      var bar = el('div', 'pr-rank-bar');
      bar.style.width = Math.round((s.n + 1 - avg[i]) / s.n * 100) + '%';
      track.appendChild(bar);
      row.appendChild(track);
      row.appendChild(el('span', 'pr-rank-avg', 'snitt ' + avg[i].toFixed(1).replace('.', ',')));
      wrap.appendChild(row);
    });
    return wrap;
  }

  var RENDERERS = { mc: bars, tbl: bars, scale: bars, wordcloud: cloud, open: openAnswers, ranking: ranking, qa: questions };

  // Skjult: bare antall svar, stort, til foreleser viser resultatene (R eller foreleser-siden)
  function waiting(rows) {
    var wrap = el('div', 'pr-waiting');
    wrap.appendChild(el('div', 'pr-waiting-n', String(rows.length)));
    wrap.appendChild(el('div', 'pr-waiting-text', 'svar'));
    wrap.appendChild(el('div', 'pr-msg', 'Resultatene vises når avstemningen er ferdig'));
    return wrap;
  }

  // correct: riktig alternativ (1-indeksert), brukes bare av bars() (mc/tbl/skala har ingen fasit)
  function render(box, s, rows, hidden, correct) {
    var body;
    if (hidden && s.type !== 'qa') { box.replaceChildren(waiting(rows)); return; }
    if (!rows.length) body = el('div', 'pr-msg', s.type === 'qa' ? 'Ingen ubesvarte spørsmål' : 'Ingen svar ennå');
    else body = RENDERERS[s.type](s, rows, correct);
    var foot = el('div', 'pr-foot', rows.length + (s.type === 'qa' ? ' ubesvarte spørsmål' : ' svar'));
    box.replaceChildren(body, foot);
  }

  function message(box, text) {
    box.replaceChildren(el('div', 'pr-msg', text));
  }

  // ---- Lagquiz (type 'tbl', team-based learning) ----
  //
  // Hvert lagforsøk er et dokument i teamtries: { qid, uid, team, k, value, correct, ts },
  // der k = 1, 2, 3 ... er forsøksnummeret (som å skrape på et IF-AT-kort).
  // Poeng etter hvilket forsøk laget fant riktig svar på: 4, 3, 2, 1 (ett poeng mindre
  // per feil). Samme tabell står i public/index.html.
  var POINTS = [4, 3, 2, 1];

  function points(k) { return k >= 1 && k <= POINTS.length ? POINTS[k - 1] : 0; }

  // Slår sammen forsøkene per lag. Samme lagnavn fra flere mobiler (to på samme lag som
  // begge svarte) telles én gang: laget som startet først.
  function teams(tries) {
    var byUid = {};
    tries.forEach(function (t) {
      var e = byUid[t.uid] || (byUid[t.uid] = { uid: t.uid, name: String(t.team || '').trim(), tries: [] });
      e.tries.push(t);
    });
    var list = Object.keys(byUid).map(function (uid) {
      var e = byUid[uid];
      e.tries.sort(function (a, b) { return a.k - b.k; });
      var first = e.tries[0];
      var hit = e.tries.filter(function (t) { return t.correct; })[0];
      e.first = first ? first.value : null;
      e.start = first ? millis(first.ts) : 0;
      e.solvedAt = hit ? hit.k : null;
      e.points = hit ? points(hit.k) : null;
      return e;
    });
    list.sort(function (a, b) { return a.start - b.start; });
    var seen = {};
    return list.filter(function (e) {
      var key = e.name.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  // Poengtavle: ferdige lag først (flest poeng, så raskest), deretter lag som holder på.
  // opts.extra: ekstraspørsmål i en lagquiz-blokk (gir ikke poeng): vis forsøk, ikke poeng.
  function leaderboard(box, list, opts) {
    var extra = !!(opts && opts.extra);
    if (!list.length) { message(box, 'Ingen lag ennå'); return; }
    var sorted = list.slice().sort(function (a, b) {
      var pa = a.points == null ? -1 : a.points, pb = b.points == null ? -1 : b.points;
      if (extra) { pa = a.points == null ? -1 : -a.solvedAt; pb = b.points == null ? -1 : -b.solvedAt; }
      return pb - pa || a.start - b.start;
    });
    var MAX = 8;
    var wrap = el('div', 'pr-board');
    sorted.slice(0, MAX).forEach(function (t) {
      var row = el('div', 'pr-board-row' + (t.points == null ? ' pending' : ''));
      row.appendChild(el('span', 'pr-board-name', t.name || '(uten navn)'));
      row.appendChild(el('span', 'pr-board-tries', t.solvedAt ? t.solvedAt + '. forsøk' : 'holder på'));
      row.appendChild(el('span', 'pr-board-pts', t.points == null ? '' : extra ? '–' : t.points + ' p'));
      wrap.appendChild(row);
    });
    var done = list.filter(function (t) { return t.points != null; }).length;
    var foot = done + ' av ' + list.length + ' lag ferdige' + (extra ? ' · ekstraspørsmål' : '') + (sorted.length > MAX ? ' (viser ' + MAX + ')' : '');
    box.replaceChildren(wrap, el('div', 'pr-foot', foot));
  }

  // ---- Samlet poengtavle for hele økten (alle lagquizene) ----
  //
  // Lagene kjennes igjen på navnet (små/store bokstaver og mellomrom spiller ingen rolle),
  // så samme lag kan ha en ny svarer eller en ny mobil i neste quiz. Innen hvert spørsmål
  // telles hvert lagnavn én gang, som i teams(). Quizene står i den rekkefølgen de ble
  // spilt (første lagforsøk). extra = { qid: true } for ekstraspørsmål i lagquiz-blokker:
  // de teller ikke og vises ikke (bare det første spørsmålet i en blokk gir poeng).
  function teamKey(name) { return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  function totals(tries, extra) {
    var byQ = {};
    tries.forEach(function (t) { if (!(extra && extra[t.qid])) (byQ[t.qid] || (byQ[t.qid] = [])).push(t); });
    var qids = Object.keys(byQ).map(function (qid) {
      return { qid: qid, start: Math.min.apply(null, byQ[qid].map(function (t) { return millis(t.ts); })) };
    }).sort(function (a, b) { return a.start - b.start; }).map(function (q) { return q.qid; });
    var byTeam = {};
    qids.forEach(function (qid) {
      teams(byQ[qid]).forEach(function (e) {
        var key = teamKey(e.name);
        var s = byTeam[key] || (byTeam[key] = { name: e.name.trim(), total: 0, perQ: {} });
        s.perQ[qid] = e.points;  // null = ikke ferdig ennå
        s.total += e.points || 0;
      });
    });
    var list = Object.keys(byTeam).map(function (k) { return byTeam[k]; });
    list.sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name, 'nb'); });
    // Delt plass ved likt poengtall
    list.forEach(function (s, i) { s.place = i && s.total === list[i - 1].total ? list[i - 1].place : i + 1; });
    return { qids: qids, teams: list };
  }

  // Tegner totals(): plass, lag, poeng per quiz og sum. Mange lag: to kolonner.
  function standings(box, tot, max) {
    max = max || 30;
    if (!tot.teams.length) { message(box, 'Ingen lagquiz spilt ennå'); return; }
    var shown = tot.teams.slice(0, max);
    var wrap = el('div', 'pr-total' + (shown.length > 12 ? ' two' : ''));
    shown.forEach(function (s) {
      var row = el('div', 'pr-total-row' + (s.place <= 3 ? ' top' : ''));
      row.appendChild(el('span', 'pr-total-place', s.place + '.'));
      row.appendChild(el('span', 'pr-total-name', s.name || '(uten navn)'));
      var cells = el('span', 'pr-total-cells');
      tot.qids.forEach(function (qid) {
        var v = s.perQ[qid];
        cells.appendChild(el('span', 'pr-total-cell' + (v == null ? ' none' : ''), v == null ? '–' : String(v)));
      });
      row.appendChild(cells);
      row.appendChild(el('span', 'pr-total-sum', s.total + ' p'));
      wrap.appendChild(row);
    });
    var n = tot.qids.length;
    var foot = tot.teams.length + ' lag · ' + n + (n === 1 ? ' lagquiz' : ' lagquizer') + ' · maks ' + n * POINTS[0] + ' p · små tall: poeng per quiz (– = ikke ferdig)' +
      (tot.teams.length > max ? ' (viser de ' + max + ' beste)' : '');
    box.replaceChildren(wrap, el('div', 'pr-foot', foot));
  }

  // Skjult: bare et tall og en tekst (brukes i lagquizens resultatpanel før R)
  function count(box, n, text) {
    var wrap = el('div', 'pr-waiting');
    wrap.appendChild(el('div', 'pr-waiting-n', String(n)));
    wrap.appendChild(el('div', 'pr-waiting-text', text));
    box.replaceChildren(wrap);
  }

  window.AvstemningResultater = {
    render: render, message: message, el: el,
    teams: teams, leaderboard: leaderboard, count: count, points: points, POINTS: POINTS,
    totals: totals, standings: standings
  };
})();
