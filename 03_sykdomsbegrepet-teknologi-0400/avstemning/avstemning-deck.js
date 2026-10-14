/* Avstemning i reveal.js-dekket, se README.md i samme mappe.

   Når foreleser kommer til en avstemningsslide (data-poll-id), åpnes spørsmålet på
   studentenes mobiler. Når man går videre, stenges det (svarene blir liggende, og det
   åpnes igjen hvis man går tilbake). Fordelingen er skjult på lerretet mens det
   stemmes (bare antall svar vises). Foreleser ser den på foreleser-siden og viser den
   for salen med R i dekket eller «Vis på lerretet» på foreleser-siden (samme bryter,
   current.revealed).

   Tre måter å bygge flervalg på:

   1. Lagquiz (team-based learning), etter kjerneslidene i hver del:
        <section class="question-slide tbl-slide" data-poll-id="q02" data-poll-type="tbl"
                 data-poll-options="4" data-correct="3"> spørsmål og .alt-er </section>
        <section class="tbl-result-slide" data-tbl-for="q02"> paneler og fasit </section>
      Studentene svarer alene, sier om de svarer for gruppa, og den som gjør det prøver
      seg frem mot riktig svar (skrapekort, 4/3/2/1 poeng). Alt går i eget tempo; på
      spørsmålssliden vises bare hvor mange som har kommet hvor langt. R (eller
      foreleser-siden) viser resultatsliden: fordeling alene, lagenes første valg,
      poengtavle og fasit. Vises resultatet fra spørsmålssliden, går dekket selv videre til resultatsliden.
      Fasiten (data-correct) skrives i sessions/{økt}/fasit, som bare foreleser kan lese.

      Lagquiz-blokk: flere lagquizer rett etter hverandre med samme data-tbl-block="k7" åpnes
      samtidig når foreleser kommer til den første. Mobilene tar dem ett og ett (alene, så
      laget) og går videre selv; spørsmålssliden viser hvor mange lag som er ferdige med
      hvert spørsmål. Bare det første spørsmålet i blokken gir poeng (de andre er «ekstra»,
      og står i sessions/{økt}.extra).

   2. Enkelt flervalg på én slide (fordypning):
        <section class="question-slide mc-slide" data-poll-id="q19" data-poll-type="mc"
                 data-poll-options="4" data-correct="4"> spørsmål, .alt-er, .mc-note </section>
      R viser fordelingen som stolper bak alternativene og markerer riktig svar.

   3. Eldre mønster: question-slide rett foran en poll-slide (resultatene på poll-sliden).

   Samlet poengtavle for alle lagquizene i økten (kan stå flere steder i dekket):
        <section class="tbl-total-slide" data-tbl-total>
          <h2 class="tbl-title">Lagquiz: samlet poengtavle</h2>
          <div class="poll-results tbl-total"></div>
        </section>
      Vises med en gang (ikke et spørsmål, ingen R). Poeng per quiz og sum per lag.

   Andre slide-attributter:
     data-poll-type="mc|tbl|scale|wordcloud|open|ranking|qa"
     data-poll-options="4"                 antall alternativer (mc, tbl, scale)
     data-poll-labels="uenig|enig"         endepunkter (scale)
     data-poll-items="A|B|C"               alternativene (ranking)
     data-poll-prompt="..."                kort tekst som vises på mobilen
                                           (mc/tbl: hentes fra spørsmålsteksten)

   Fjernkontroll: foreleser-siden på mobilen har knapper for forrige/neste slide og
   vis/skjul resultat. De skriver sessions/{økt}.remote, som dekket lytter på, og dekket
   skriver hvor det står i sessions/{økt}.deck.

   Krever at window.AVSTEMNING_OKT (øktens navn, f.eks. '0400-uke40') er satt,
   og at config.js, felles.js, resultater.js, Firebase compat og qrcode.js er
   lastet først. Taster: A = logg inn/ut og nullstill, R = vis/skjul fordelingen. */
(function () {
  'use strict';

  var SESSION = window.AVSTEMNING_OKT;
  var R = window.AvstemningResultater;
  var el = R.el;
  var init = window.avstemningInit();
  var auth = init.auth;
  var db = init.db;
  var sessionRef = db.collection('sessions').doc(SESSION);
  var serverTime = firebase.firestore.FieldValue.serverTimestamp;

  var unsubs = [];            // lyttere for sliden som vises nå
  var unsubQuestions = null;  // lytter på Q&A-spørsmålene (hele timen)
  var unsubSession = null;    // lytter på current (for revealed)
  var openQuestions = [];     // ubesvarte Q&A-spørsmål
  var openId = null;          // spørsmålet som er åpent for studentene nå
  var revealedId = null;      // spørsmålet hvis fordeling er vist på lerretet
  var shown = null;           // { kind, spec, slide, box, rows, tries } som vises nå

  function isPresenter() {
    var u = auth.currentUser;
    return !!(u && !u.isAnonymous);
  }

  function report(err) {
    console.warn('Avstemning:', err);
    dot.classList.add('err');
    dot.title = 'Avstemning: feil (' + (err && err.code || err) + '). Trykk A.';
  }

  // Spørsmålsteksten og alternativene fra en slide med .alt-er
  function questionIn(q) {
    if (!q || !q.querySelector('.alt')) return null;
    var p = q.querySelector(':scope > p:not(.pagecite):not(.mc-note)');
    var options = Array.prototype.map.call(q.querySelectorAll('.alt'), function (alt) {
      var copy = alt.cloneNode(true);
      copy.querySelectorAll('.altnum, .mc-share').forEach(function (x) { x.remove(); });
      return copy.textContent.trim();
    });
    return { prompt: p ? p.textContent.trim() : '', options: options };
  }

  // Spørsmålsdefinisjon fra slidens data-poll-*-attributter
  function spec(slide) {
    var d = slide.dataset;
    var s = { id: d.pollId, type: d.pollType, prompt: d.pollPrompt || '' };
    if (d.pollType === 'mc' || d.pollType === 'tbl' || d.pollType === 'scale') {
      s.n = parseInt(d.pollOptions || (d.pollType === 'scale' ? '5' : '4'), 10);
    }
    if (d.pollType === 'mc' || d.pollType === 'tbl') {
      var q = questionIn(slide) || questionIn(slide.previousElementSibling && slide.previousElementSibling.classList.contains('question-slide') ? slide.previousElementSibling : null);
      if (q && q.options.length === s.n) {
        s.options = q.options;
        if (!s.prompt) s.prompt = q.prompt;
      }
    }
    if (d.pollType === 'scale' && d.pollLabels) s.labels = d.pollLabels.split('|');
    if (d.pollType === 'ranking') {
      s.items = (d.pollItems || '').split('|');
      s.n = s.items.length;
    }
    return s;
  }

  function correctOf(slide) {
    var c = parseInt(slide && slide.dataset.correct, 10);
    return c >= 1 ? c : null;
  }

  // Lagquiz-blokk: alle spørsmålsslidene med samme data-tbl-block, i rekkefølge
  function blockOf(qslide) {
    var key = qslide && qslide.dataset.tblBlock;
    if (!key) return null;
    var slides = Array.prototype.slice.call(document.querySelectorAll('section[data-poll-type="tbl"][data-tbl-block="' + key + '"]'));
    if (slides.length < 2) return null;
    return {
      key: key, slides: slides,
      ids: slides.map(function (s) { return s.dataset.pollId; }),
      pos: slides.indexOf(qslide)
    };
  }

  // Ekstraspørsmål (ikke første i en blokk) i hele dekket: gir ikke poeng i samlet poengtavle
  function extraIds() {
    var extra = {};
    document.querySelectorAll('section[data-poll-type="tbl"][data-tbl-block]').forEach(function (s) {
      var b = blockOf(s);
      if (b && b.pos > 0) extra[s.dataset.pollId] = true;
    });
    return extra;
  }

  // Hvilket spørsmål hører til sliden som vises, og hvordan skal det tegnes?
  function pollFor(slide) {
    if (!slide) return null;
    var d = slide.dataset;
    if (d.pollId && d.pollType === 'tbl') return { kind: 'tbl', spec: spec(slide), slide: slide, correct: correctOf(slide), block: blockOf(slide) };
    if (d.pollId && slide.classList.contains('mc-slide')) return { kind: 'mcslide', spec: spec(slide), slide: slide, correct: correctOf(slide) };
    if (d.pollId) return { kind: 'box', spec: spec(slide), slide: slide, box: slide.querySelector('.poll-results') };
    if (d.tblFor) {
      var q = document.querySelector('section[data-poll-id="' + d.tblFor + '"]');
      if (q) return { kind: 'tblres', spec: spec(q), slide: slide, correct: correctOf(q), block: blockOf(q) };
    }
    var next = slide.nextElementSibling;
    if (slide.classList.contains('question-slide') && next && next.dataset.pollId) {
      return { kind: 'none', spec: spec(next), slide: slide };
    }
    return null;
  }

  // ---- Tegning ----

  function draw() {
    if (!shown) return;
    var hidden = shown.spec.id !== revealedId;
    if (shown.kind === 'box' && shown.box) {
      R.render(shown.box, shown.spec, shown.spec.type === 'qa' ? openQuestions : shown.rows, hidden);
    } else if (shown.kind === 'mcslide') {
      drawMcSlide(shown.slide, shown.spec, shown.rows, hidden);
    } else if (shown.kind === 'tbl') {
      drawTblStatus(shown.slide, shown.rows, triesFor(shown.spec.id), shown.block);
      if (shown.liveBox) liveTotal(shown.liveBox, shown.liveBox.dataset.tavle === 'ekstra' ? extraTotals(shown.allTries) : R.totals(shown.allTries, extraIds()));
    } else if (shown.kind === 'tblres') {
      // Ekstraspørsmål med egen tavle (data-ekstra-tavle) viser poeng som vanlig
      var noPoints = !!(shown.block && shown.block.pos > 0 && !shown.block.slides[shown.block.pos].hasAttribute('data-ekstra-tavle'));
      drawTblResult(shown.slide, shown.spec, shown.rows, triesFor(shown.spec.id), hidden, noPoints, shown.correct);
    } else if (shown.kind === 'total' && shown.box) {
      // Egen tavle for ekstraspørsmålene i lagquiz-blokkene: data-tbl-total="ekstra" på sliden,
      // eller data-tavle="ekstra" på boksen (flere tavler side om side på samme slide)
      shown.boxes.forEach(function (b) {
        var ekstra = b.dataset.tavle ? b.dataset.tavle === 'ekstra' : shown.slide.dataset.tblTotal === 'ekstra';
        R.standings(b, ekstra ? extraTotals(shown.tries) : R.totals(shown.tries, extraIds()));
      });
    }
  }

  // Enkelt flervalg: antall svar, og etter R stolper bak alternativene + riktig svar
  function drawMcSlide(slide, s, rows, hidden) {
    var counter = slide.querySelector('.mc-count');
    if (counter) counter.textContent = rows.length + (rows.length === 1 ? ' svar' : ' svar');
    slide.classList.toggle('revealed', !hidden);
    var counts = [];
    for (var i = 0; i < s.n; i++) counts.push(0);
    rows.forEach(function (r) { if (r.value >= 1 && r.value <= s.n) counts[r.value - 1]++; });
    slide.querySelectorAll('.alt').forEach(function (alt, i) {
      var share = rows.length ? Math.round(counts[i] / rows.length * 100) : 0;
      alt.style.setProperty('--share', (hidden ? 0 : share) + '%');
      var tag = alt.querySelector('.mc-share');
      if (!tag) { tag = el('span', 'mc-share'); alt.appendChild(tag); }
      tag.textContent = hidden ? '' : counts[i] + ' (' + share + ' %)';
    });
  }

  // Lagforsøk for ett spørsmål (i en blokk lyttes det på alle spørsmålene i blokken)
  function triesFor(id) {
    return shown.tries.filter(function (t) { return t.qid === id; });
  }

  function teamStats(tries) {
    var teams = R.teams(tries);
    return { teams: teams, done: teams.filter(function (t) { return t.points != null; }).length };
  }

  // Lagquiz, spørsmålssliden: bare fremdrift (eget tempo). I en blokk også hvor mange lag
  // som er ferdige med hvert spørsmål, så foreleser ser når de fleste har klart det første.
  function drawTblStatus(slide, rows, tries, block) {
    var box = slide.querySelector('.tbl-status');
    if (!box) return;
    var st = teamStats(tries);
    var text = rows.length + ' har svart alene  ·  ' + st.teams.length + ' lag i gang  ·  ' + st.done + ' lag ferdige';
    if (block) {
      text += '\nLag ferdige: ' + block.ids.map(function (id, i) {
        return 'spm. ' + (i + 1) + ': ' + teamStats(triesFor(id)).done;
      }).join('  ·  ');
    }
    box.textContent = text;
  }

  // Lagquiz, resultatsliden: skjult = bare tall; vist = fordeling, første valg, poeng, fasit
  function drawTblResult(slide, s, rows, tries, hidden, extra, correct) {
    var st = teamStats(tries);
    slide.classList.toggle('revealed', !hidden);
    var ind = slide.querySelector('.tbl-ind');
    var first = slide.querySelector('.tbl-team');
    var pts = slide.querySelector('.tbl-points');
    var bars = { type: 'mc', n: s.n };
    if (hidden) {
      if (ind) R.count(ind, rows.length, 'har svart alene');
      if (first) R.count(first, st.teams.length, 'lag i gang');
      if (pts) R.count(pts, st.done, 'lag ferdige');
      return;
    }
    if (ind) R.render(ind, bars, rows, false, correct);
    if (first) R.render(first, bars, st.teams.filter(function (t) { return t.first != null; }).map(function (t) { return { value: t.first }; }), false, correct);
    if (pts) R.leaderboard(pts, st.teams, { extra: extra });
  }

  // Poengsum bare for ekstraspørsmålene (ikke første i en lagquiz-blokk), til egen tavle
  function extraTotals(tries) {
    var ex = extraIds();
    return R.totals(tries.filter(function (t) { return ex[t.qid]; }), null);
  }

  // Samlet poengtavle i kortform ved siden av spørsmålet (lagquiz med .tbl-live-total):
  // plass, lag og sum, oppdatert live mens lagene svarer
  function liveTotal(box, tot) {
    if (!tot.teams.length) { R.message(box, 'Ingen poeng ennå'); return; }
    var wrap = el('div', 'live-board');
    tot.teams.slice(0, 14).forEach(function (s) {
      var row = el('div', 'live-row' + (s.place <= 3 ? ' top' : ''));
      row.appendChild(el('span', 'live-place', s.place + '.'));
      row.appendChild(el('span', 'live-name', s.name || '(uten navn)'));
      row.appendChild(el('span', 'live-sum', s.total + ' p'));
      wrap.appendChild(row);
    });
    var foot = tot.teams.length + ' lag · ' + tot.qids.length + ' spørsmål spilt' + (tot.teams.length > 14 ? ' (viser 14)' : '');
    box.replaceChildren(wrap, el('div', 'pr-foot', foot));
  }

  function presenterMessage(poll) {
    var text = 'Trykk A og logg inn for å åpne spørsmålet og vise svarene.';
    if (poll.kind === 'box' && poll.box) R.message(poll.box, text);
    else if (poll.kind === 'mcslide') { var c = poll.slide.querySelector('.mc-count'); if (c) c.textContent = text; }
    else if (poll.kind === 'tbl') {
      var b = poll.slide.querySelector('.tbl-status'); if (b) b.textContent = text;
      var lt = poll.slide.querySelector('.tbl-live-total'); if (lt) R.message(lt, 'Logg inn (A) for poengtavlen');
    }
    else if (poll.kind === 'tblres') poll.slide.querySelectorAll('.tbl-ind, .tbl-team, .tbl-points').forEach(function (x) { R.message(x, text); });
  }

  // ---- Styring: åpne/stenge spørsmål når slidene skifter ----

  function openPoll(poll) {
    if (openId === poll.spec.id) return;  // allerede åpent (f.eks. fra spørsmål til resultat)
    openId = poll.spec.id;
    var batch = db.batch();
    var cur = Object.assign({}, poll.spec, { open: true, revealed: false, ts: serverTime() });
    var fields = ['current'];
    var data = { current: cur };
    if (poll.block) {
      // Hele blokken åpnes: fasit for alle spørsmålene, og listen studentene går gjennom
      var specs = poll.block.slides.map(spec);
      poll.block.slides.forEach(function (s) {
        var c = correctOf(s);
        if (c) batch.set(sessionRef.collection('fasit').doc(s.dataset.pollId), { value: c });
      });
      cur.block = specs.map(function (x) { return { id: x.id, n: x.n, prompt: x.prompt || '', options: x.options || [] }; });
      cur.blockIds = poll.block.ids;
      cur.blockN = {};
      specs.forEach(function (x) { cur.blockN[x.id] = x.n; });
      // Ekstraspørsmålene (alle unntatt det første) gir ikke poeng; flettes inn i sessions/{økt}.extra
      data.extra = {};
      poll.block.ids.slice(1).forEach(function (id) { data.extra[id] = true; fields.push(new firebase.firestore.FieldPath('extra', id)); });
    } else if (poll.correct) {
      batch.set(sessionRef.collection('fasit').doc(poll.spec.id), { value: poll.correct });
    }
    // mergeFields: erstatter hele current, men lar deck og remote (fjernkontrollen) stå
    batch.set(sessionRef, data, { mergeFields: fields });
    batch.commit().catch(report);
  }

  // Hvor dekket står, til foreleser-siden (fjernkontrollen på mobilen)
  function reportPosition() {
    var slide = Reveal.getCurrentSlide();
    var counter = document.getElementById('custom-counter');
    var h = slide && (slide.querySelector('h2') || slide.querySelector(':scope > p:not(.pagecite)'));
    sessionRef.set({ deck: {
      label: counter ? counter.textContent : '',
      title: h ? h.textContent.trim().slice(0, 120) : ''
    } }, { merge: true }).catch(report);
  }

  function onSlideChanged() {
    var poll = pollFor(Reveal.getCurrentSlide());
    unsubs.forEach(function (u) { u(); });
    unsubs = [];
    shown = null;

    if (isPresenter()) {
      reportPosition();
      if (poll) {
        openPoll(poll);
      } else if (openId) {
        openId = null;
        sessionRef.update({ 'current.open': false }).catch(report);
      }
    }
    var slide = Reveal.getCurrentSlide();
    var onTotal = !!(slide && slide.dataset.tblTotal != null);
    // Foreleser-siden viser den samlede poengtavlen og sporsmalskortet bare mens de faktisk star pa lerretet
    var onPoll = poll && poll.kind !== 'none' ? poll.spec.id : null;
    if (isPresenter()) sessionRef.set({ showingTotal: onTotal, showingPoll: onPoll }, { merge: true }).catch(report);
    if (onTotal) { showTotal(slide); return; }
    if (!poll || poll.kind === 'none') return;
    if (!isPresenter()) { presenterMessage(poll); return; }

    shown = { kind: poll.kind, spec: poll.spec, slide: poll.slide, box: poll.box, rows: [], tries: [], block: poll.block || null, correct: poll.correct };
    if (poll.spec.type === 'qa') { draw(); return; }
    if (poll.kind === 'box' && poll.box) R.message(poll.box, 'Venter på svar …');
    draw();
    var id = poll.spec.id;
    unsubs.push(sessionRef.collection('responses').where('qid', '==', id).onSnapshot(function (snap) {
      if (!shown || shown.spec.id !== id) return;
      shown.rows = snap.docs.map(function (d) { return d.data(); });
      draw();
    }, report));
    if (poll.spec.type === 'tbl') {
      var ids = poll.block ? poll.block.ids : [id];
      unsubs.push(sessionRef.collection('teamtries').where('qid', 'in', ids).onSnapshot(function (snap) {
        if (!shown || shown.spec.id !== id) return;
        shown.tries = snap.docs.map(function (d) { return d.data(); });
        draw();
      }, report));
      // Live poengtavle for hele økten ved siden av spørsmålet
      var liveBox = poll.kind === 'tbl' && poll.slide.querySelector('.tbl-live-total');
      if (liveBox) {
        shown.liveBox = liveBox;
        shown.allTries = [];
        R.message(liveBox, 'Henter poeng …');
        unsubs.push(sessionRef.collection('teamtries').onSnapshot(function (snap) {
          if (!shown || shown.spec.id !== id) return;
          shown.allTries = snap.docs.map(function (d) { return d.data(); });
          draw();
        }, report));
      }
    }
  }

  // Samlet poengtavle: alle lagforsøk i økten (bare foreleser kan lese dem)
  function showTotal(slide) {
    var boxes = Array.prototype.slice.call(slide.querySelectorAll('.tbl-total'));
    if (!boxes.length) return;
    if (!isPresenter()) { boxes.forEach(function (b) { R.message(b, 'Trykk A og logg inn for å vise poengtavlen.'); }); return; }
    shown = { kind: 'total', spec: { id: null }, slide: slide, box: boxes[0], boxes: boxes, rows: [], tries: [] };
    boxes.forEach(function (b) { R.message(b, 'Henter poeng …'); });
    unsubs.push(sessionRef.collection('teamtries').onSnapshot(function (snap) {
      if (!shown || shown.kind !== 'total') return;
      shown.tries = snap.docs.map(function (d) { return d.data(); });
      draw();
    }, report));
  }

  // Om fordelingen er vist: styres av current.revealed, så R i dekket og
  // knappen på foreleser-siden alltid er enige
  // Kommandoer fra fjernkontrollen på foreleser-siden: remote = { seq, action }.
  // Den første verdien som leses, er gammel og utføres ikke.
  var lastRemote;
  function listenSession() {
    if (unsubSession) { unsubSession(); unsubSession = null; }
    revealedId = null;
    lastRemote = undefined;
    if (!isPresenter()) return;
    unsubSession = sessionRef.onSnapshot(function (snap) {
      var data = snap.exists ? snap.data() : {};
      var cur = data.current || null;
      var was = revealedId;
      revealedId = cur && cur.revealed ? cur.id : null;
      // Lagquiz: når resultatet vises (R eller mobilen) fra spørsmålssliden, gå til resultatsliden
      var slide = Reveal.getCurrentSlide();
      if (revealedId && revealedId !== was && slide && slide.dataset.pollType === 'tbl' && slide.dataset.pollId === revealedId) {
        var next = slide.nextElementSibling;
        if (next && next.dataset.tblFor === revealedId) Reveal.next();
      }
      draw();
      var r = data.remote;
      if (lastRemote === undefined) { lastRemote = r ? r.seq : null; return; }
      if (!r || r.seq === lastRemote) return;
      lastRemote = r.seq;
      if (r.action === 'next') Reveal.next();
      else if (r.action === 'prev') Reveal.prev();
      // Neste/forrige del: alltid til første slide i delen (reveal.js husker ellers hvor man var i hver del)
      else if (r.action === 'right' || r.action === 'left') {
        var h = Reveal.getIndices().h + (r.action === 'right' ? 1 : -1);
        var parts = document.querySelectorAll('.reveal .slides > section').length;
        if (h >= 0 && h < parts) Reveal.slide(h, 0);
      }
      else if (r.action === 'reopen') { openId = null; onSlideChanged(); }
    }, report);
  }

  // ---- Q&A: antall ubesvarte i bunnlinjen, og listen på Q&A-slider ----

  function listenQuestions() {
    if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
    openQuestions = [];
    updateQaBadge();
    if (!isPresenter()) return;
    unsubQuestions = sessionRef.collection('questions').onSnapshot(function (snap) {
      openQuestions = snap.docs.map(function (d) { return d.data(); })
        .filter(function (q) { return !q.answered; });
      updateQaBadge();
      if (shown && shown.spec.type === 'qa') draw();
    }, report);
  }

  // ---- Bunnlinjen: statusprikk og spørsmålsboble ----

  var dot = el('span', 'poll-dot', '●');
  var qaBadge = el('span', 'poll-qa');
  qaBadge.hidden = true;
  qaBadge.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>' +
    '<span class="poll-qa-count"></span>';
  var bar = document.querySelector('.bottom-bar');
  if (bar) {
    bar.insertBefore(dot, bar.firstChild);
    var counter = bar.querySelector('.custom-counter-inline');
    bar.insertBefore(qaBadge, counter ? counter.nextSibling : null);
  }

  function updateQaBadge() {
    var n = openQuestions.length;
    qaBadge.hidden = n === 0;
    qaBadge.querySelector('.poll-qa-count').textContent = String(n);
    qaBadge.title = n + (n === 1 ? ' ubesvart spørsmål' : ' ubesvarte spørsmål') + ' fra studentene (se foreleser-siden)';
  }

  // ---- Innloggingspanel (tast A) ----

  var panel = el('div', 'avst-panel');
  panel.hidden = true;
  panel.innerHTML =
    '<h3>Avstemning</h3>' +
    '<p class="avst-state"></p>' +
    '<form class="avst-login">' +
    '  <input type="email" placeholder="E-post" autocomplete="username" required>' +
    '  <input type="password" placeholder="Passord" autocomplete="current-password" required>' +
    '  <button type="submit">Logg inn</button>' +
    '</form>' +
    '<div class="avst-actions">' +
    '  <button type="button" class="avst-logout">Logg ut</button>' +
    '  <button type="button" class="avst-reset danger">Slett alle svar i økten</button>' +
    '</div>' +
    '<p class="avst-help">Økt: <b class="avst-session"></b><br>' +
    'Foreleser-siden: <span class="avst-lecturer"></span><br>' +
    'A: vis/skjul panelet · R: vis/skjul fordelingen på lerretet</p>';
  document.body.appendChild(panel);
  panel.querySelector('.avst-session').textContent = SESSION;

  function updateStatus() {
    var on = isPresenter();
    dot.classList.toggle('on', on);
    dot.classList.remove('err');
    dot.title = on ? 'Avstemning: innlogget som foreleser (A)' : 'Avstemning: ikke innlogget (trykk A)';
    panel.querySelector('.avst-state').textContent = on
      ? 'Innlogget som ' + auth.currentUser.email + '.'
      : 'Ikke innlogget. Studentene ser ingen spørsmål før du logger inn.';
    panel.querySelector('.avst-login').hidden = on;
    panel.querySelector('.avst-actions').hidden = !on;
  }

  function togglePanel() {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !isPresenter()) panel.querySelector('input[type=email]').focus();
  }

  dot.addEventListener('click', togglePanel);

  panel.querySelector('.avst-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var inputs = panel.querySelectorAll('.avst-login input');
    auth.signInWithEmailAndPassword(inputs[0].value, inputs[1].value)
      .then(function () { inputs[1].value = ''; panel.hidden = true; })
      .catch(function (err) {
        panel.querySelector('.avst-state').textContent = 'Innlogging feilet (' + err.code + ').';
      });
  });

  panel.querySelector('.avst-logout').addEventListener('click', function () {
    var close = openId ? sessionRef.update({ 'current.open': false }) : Promise.resolve();
    openId = null;
    close.catch(report).then(function () { return auth.signOut(); });
  });

  // Nullstill etter en prøvekjøring, så svarene fra testen ikke blir med i forelesningen
  panel.querySelector('.avst-reset').addEventListener('click', function () {
    if (!confirm('Slette alle svar og spørsmål i økten "' + SESSION + '"?')) return;
    function wipe(name) {
      return sessionRef.collection(name).get().then(function (snap) {
        var batches = [];
        for (var i = 0; i < snap.docs.length; i += 400) {
          var batch = db.batch();
          snap.docs.slice(i, i + 400).forEach(function (d) { batch.delete(d.ref); });
          batches.push(batch.commit());
        }
        return Promise.all(batches);
      });
    }
    openId = null;  // så fasit og spørsmål skrives på nytt neste gang sliden vises
    Promise.all([wipe('responses'), wipe('questions'), wipe('teamtries'), wipe('fasit')])
      .then(function () {
        panel.querySelector('.avst-state').textContent = 'Alle svar i økten er slettet.';
        onSlideChanged();
      })
      .catch(report);
  });

  Reveal.addKeyBinding({ keyCode: 65, key: 'A', description: 'Avstemning: logg inn/ut' }, togglePanel);
  Reveal.addKeyBinding({ keyCode: 82, key: 'R', description: 'Avstemning: vis/skjul fordelingen' }, function () {
    if (!isPresenter() || !openId) return;
    // Fra lagquizens spørsmålsslide går dekket videre til resultatsliden (se listenSession)
    sessionRef.update({ 'current.revealed': revealedId !== openId }).catch(report);
  });

  // ---- QR-kode og adresser ----

  var base = init.studentUrl.replace(/\/$/, '');
  var emu = init.emulator ? '&emulator=1' : '';
  var joinUrl = base + '/?s=' + encodeURIComponent(SESSION) + emu;
  document.querySelectorAll('.join-qr').forEach(function (img) {
    var qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();
    img.src = qr.createDataURL(10, 2);
  });
  document.querySelectorAll('.join-url').forEach(function (e) {
    e.textContent = joinUrl.replace(/^https?:\/\//, '');
  });
  panel.querySelector('.avst-lecturer').textContent =
    (base + '/foreleser.html?s=' + encodeURIComponent(SESSION) + emu).replace(/^https?:\/\//, '');

  // ---- Start ----

  auth.onAuthStateChanged(function () {
    updateStatus();
    listenSession();
    listenQuestions();
    openId = null;
    if (Reveal.isReady()) onSlideChanged();
  });
  Reveal.on('slidechanged', onSlideChanged);
  if (Reveal.isReady()) onSlideChanged(); else Reveal.on('ready', onSlideChanged);
})();
