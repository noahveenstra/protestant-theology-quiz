// Protestant Theology Quiz — engine
(function () {
  'use strict';

  var BANK = null;
  var GLOSSARY = {};
  var READING = {};
  var COMPARE_WITH = null;   // decoded ?compare= payload from a friend
  var LAST = null;           // { axes, trads, theos } of the latest results
  var queue = [];        // questions for this run
  var idx = 0;
  var answers = {};      // questionId -> -2..2
  var depthName = '';

  var $ = function (id) { return document.getElementById(id); };

  var TIERS = {
    essential: ['essential'],
    standard: ['essential', 'standard'],
    advanced: ['essential', 'standard', 'advanced'],
    complete: ['essential', 'standard', 'advanced', 'complete']
  };
  var DEPTH_LABELS = { essential: 'Essential', standard: 'Standard', advanced: 'Advanced', complete: 'Complete' };

  // ---------- boot ----------
  Promise.all([
    fetch('question-bank.json').then(function (r) { if (!r.ok) throw new Error('bank'); return r.json(); }),
    fetch('glossary.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    fetch('reading.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
  ])
    .then(function (results) {
      BANK = results[0];
      GLOSSARY = results[1] || {};
      READING = results[2] || {};
      COMPARE_WITH = readCompareParam();
      if (COMPARE_WITH) {
        var cb = $('compare-banner');
        if (cb) cb.classList.remove('hidden');
      }
      wireDepthCards();
      wireTooltips();
      wireTheologianPage();
      wireResultsActions();
      wireResultsTabs();
      initCarousel();
    })
    .catch(function () {
      document.querySelector('.hero .lede').textContent =
        'Could not load the question bank. Check your connection and reload.';
    });

  function wireDepthCards() {
    var cards = document.querySelectorAll('.depth-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function () { startQuiz(card.dataset.depth); });
    });
  }

  // ---------- quiz flow ----------
  function startQuiz(depth) {
    depthName = DEPTH_LABELS[depth] || depth;
    var allowed = TIERS[depth] || TIERS.complete;
    queue = BANK.questions.filter(function (q) { return allowed.indexOf(q.tier) !== -1; });
    idx = 0;
    answers = {};
    showScreen('screen-quiz');
    renderQuestion();
    window.scrollTo(0, 0);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    $(id).classList.add('active');
  }

  function renderQuestion() {
    var q = queue[idx];
    var card = document.querySelector('.question-card');
    card.classList.remove('q-swap');
    void card.offsetWidth;
    card.classList.add('q-swap');
    $('q-number').textContent = 'Question ' + (idx + 1) + ' of ' + queue.length;
    $('q-text').textContent = q.text;
    $('category-tag').textContent = q.category;
    $('progress-fill').style.width = ((idx) / queue.length * 100) + '%';
    $('progress-label').textContent = (idx + 1) + ' / ' + queue.length;
    $('btn-back').style.visibility = idx === 0 ? 'hidden' : 'visible';

    var likert = $('likert');
    likert.querySelectorAll('button').forEach(function (btn) {
      btn.classList.toggle('selected', answers[q.id] === parseInt(btn.dataset.val, 10));
      btn.onclick = function () { answer(idx, parseInt(btn.dataset.val, 10)); };
    });
    window.scrollTo(0, 0);
  }

  function answer(i, val) {
    answers[queue[i].id] = val;
    // brief beat so the selection registers visually
    setTimeout(function () {
      if (idx < queue.length - 1) { idx++; renderQuestion(); }
      else { finishQuiz(); }
    }, 160);
  }

  $('btn-back').addEventListener('click', function () {
    if (idx > 0) { idx--; renderQuestion(); }
  });

  // ---------- scoring ----------
  function scoreAxes() {
    return BANK.axes.map(function (axis) {
      var raw = 0, max = 0;
      queue.forEach(function (q) {
        var resp = answers[q.id];
        if (resp === undefined) return;
        (q.axes || []).forEach(function (a) {
          if (a.axis !== axis.id) return;
          raw += a.direction * a.weight * resp;
          max += a.weight * 2;
        });
      });
      var score = max > 0 ? Math.round(raw / max * 100) : 0;
      return { axis: axis, score: score };
    });
  }

  function scoreTraditions() {
    return BANK.traditions.map(function (t) {
      var raw = 0, max = 0;
      queue.forEach(function (q) {
        var resp = answers[q.id];
        if (resp === undefined) return;
        var w = (q.traditions || {})[t.id] || 0;
        raw += w * resp;
        max += Math.abs(w) * 2;
      });
      var norm = max > 0 ? raw / max * 100 : 0;   // -100..100
      var exact = (norm + 100) / 2;                // 0..100, unrounded
      var match = Math.round(exact * 10) / 10;    // one decimal
      return { tradition: t, score: norm, match: match, exact: exact };
    }).sort(function (a, b) { return b.exact - a.exact; });
  }

  // ---------- close-call analysis ----------
  // When the top traditions are nearly tied, find the questions whose answers
  // separated the winner from each close runner-up.
  function closeCallEntries(trads) {
    var top = trads[0];
    var close = trads.slice(1).filter(function (t) { return top.exact - t.exact < 2; });
    if (!close.length) return [];
    return close.map(function (runner) {
      var decisive = [];
      queue.forEach(function (q) {
        var resp = answers[q.id];
        if (resp === undefined || resp === 0) return;
        var w1 = (q.traditions || {})[top.tradition.id] || 0;
        var w2 = (q.traditions || {})[runner.tradition.id] || 0;
        var gap = (w1 - w2) * resp;
        if (gap > 0) decisive.push({ q: q, resp: resp, w2: w2, gap: gap });
      });
      decisive.sort(function (a, b) { return b.gap - a.gap; });
      return { runner: runner, decisive: decisive.slice(0, 2) };
    });
  }

  function renderCloseCall(trads) {
    var entries = closeCallEntries(trads);
    var box = $('close-call');
    if (!entries.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    var top = trads[0];
    var html = '<h3>Why ' + esc(top.tradition.name) + ' came out on top</h3>';
    html += '<p class="close-intro">Separated by less than two points — here is what tipped it.</p>';
    entries.forEach(function (entry) {
      html += '<div class="close-row"><div class="close-head"><strong>' + esc(top.tradition.name) +
        '</strong> ' + top.match.toFixed(1) + ' vs <strong>' + esc(entry.runner.tradition.name) +
        '</strong> ' + entry.runner.match.toFixed(1) + '</div>';
      if (!entry.decisive.length) {
        html += '<p class="close-note">No single answer separated them — the gap comes from small leans across many questions.</p>';
      } else {
        html += '<ul>';
        entry.decisive.forEach(function (d) {
          var verb = d.resp > 0 ? 'agreed' : 'disagreed';
          var opp = (d.w2 * d.resp < 0) ? 'leans the other way' : 'is neutral here';
          html += '<li>You ' + verb + ' that &ldquo;' + esc(d.q.text) + '&rdquo; — ' +
            esc(top.tradition.name) + ' affirms this; ' + esc(entry.runner.tradition.name) + ' ' + opp + '.</li>';
        });
        html += '</ul>';
      }
      html += '</div>';
    });
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  // ---------- theologian marquee + spotlight ----------
  var spotIdx = 0;
  var spotTheologianId = null;

  function traditionName(id) {
    var found = BANK.traditions.filter(function (t) { return t.id === id; })[0];
    return found ? found.name : id;
  }

  function initials(name) {
    // strip quotes/nicknames, take first letters of first two words
    var clean = name.replace(/"[^"]*"/g, '').trim().split(/\s+/);
    return (clean[0][0] + (clean[1] ? clean[1][0] : '')).toUpperCase();
  }

  function renderSpotlight(i) {
    var list = BANK.theologians;
    spotIdx = ((i % list.length) + list.length) % list.length;
    var th = list[spotIdx];
    spotTheologianId = th.id;
    var portraits = (typeof window !== 'undefined' && window.THEOLOGIAN_PORTRAITS) || {};
    var img = $('spot-portrait');
    if (portraits[th.id]) {
      img.src = portraits[th.id];
      img.style.display = '';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
    img.alt = 'Portrait of ' + th.name;
    $('spot-name').textContent = th.name;
    $('spot-tradition').textContent = traditionName(th.tradition);
    $('spot-blurb').textContent = th.blurb;
    var spot = $('spotlight');
    spot.classList.remove('spot-fade');
    void spot.offsetWidth;
    spot.classList.add('spot-fade');
    // mark active in marquee (both copies)
    var items = document.querySelectorAll('.mq-item');
    items.forEach(function (el) {
      el.classList.toggle('active', parseInt(el.dataset.idx, 10) === spotIdx);
    });
  }

  function buildMarquee() {
    var track = $('marquee-track');
    var portraits = (typeof window !== 'undefined' && window.THEOLOGIAN_PORTRAITS) || {};
    track.innerHTML = '';
    // duplicate the list so the scroll loops seamlessly
    [0, 1].forEach(function () {
      var half = document.createElement('div');
      half.className = 'mq-half';
      BANK.theologians.forEach(function (th, i) {
        var b = document.createElement('button');
        b.className = 'mq-item';
        b.dataset.idx = i;
        b.setAttribute('aria-label', th.name);
        if (portraits[th.id]) {
          var img = document.createElement('img');
          img.src = portraits[th.id];
          img.alt = '';
          img.loading = 'lazy';
          b.appendChild(img);
        } else {
          var fb = document.createElement('span');
          fb.className = 'mq-initials';
          fb.textContent = initials(th.name);
          b.appendChild(fb);
        }
        b.addEventListener('click', function () { openTheologian(th.id); });
        half.appendChild(b);
      });
      track.appendChild(half);
    });
  }

  function startSpotFollow() {
    var marquee = $('marquee');
    var track = $('marquee-track');
    if (!marquee || !track) return;
    setInterval(function () {
      if (document.hidden) return;
      var mRect = marquee.getBoundingClientRect();
      var spotX = mRect.left + mRect.width * 0.4; // spotlight zone
      var best = -1, bestDist = Infinity;
      var items = track.querySelectorAll('.mq-item');
      for (var k = 0; k < items.length; k++) {
        var r = items[k].getBoundingClientRect();
        if (r.right < mRect.left || r.left > mRect.right) continue; // offscreen
        var d = Math.abs((r.left + r.right) / 2 - spotX);
        if (d < bestDist) { bestDist = d; best = parseInt(items[k].dataset.idx, 10); }
      }
      if (best >= 0 && best !== spotIdx) renderSpotlight(best);
    }, 150);
  }

  function initCarousel() {
    buildMarquee();
    renderSpotlight(0);
    startSpotFollow();
    startMarqueeDrive();
    var spot = $('spotlight');
    if (spot) spot.addEventListener('click', function () {
      if (spotTheologianId) openTheologian(spotTheologianId);
    });
  }

  // JS-driven marquee: guaranteed auto-scroll, pauses while the user interacts
  var mqX = 0, mqLast = 0, mqHold = false;
  var MQ_SPEED = 30; // px per second
  var mqRing = { x: 0, y: 0, w: 0, h: 0, init: false };
  function marqueeStep(ts) {
    if (!mqLast) mqLast = ts;
    var dt = (ts - mqLast) / 1000;
    mqLast = ts;
    var track = $('marquee-track');
    var marquee = $('marquee');
    if (track && marquee && !mqHold && !document.hidden && dt > 0 && dt < 0.25) {
      mqX -= MQ_SPEED * dt;
      var half = track.scrollWidth / 2;
      if (half > 0 && -mqX >= half) mqX += half;
      track.style.transform = 'translateX(' + mqX + 'px)';
    }
    // glide the shared indicator ring onto the active portrait (wedding-nav principle)
    var ring = $('mq-ring');
    if (ring && marquee && track) {
      var mRect = marquee.getBoundingClientRect();
      var target = null;
      var items = track.querySelectorAll('.mq-item');
      for (var k = 0; k < items.length; k++) {
        if (parseInt(items[k].dataset.idx, 10) === spotIdx) {
          var r = items[k].getBoundingClientRect();
          if (r.right > mRect.left && r.left < mRect.right) {
            target = { x: r.left - mRect.left, y: r.top - mRect.top, w: r.width, h: r.height };
          }
          break;
        }
      }
      if (target) {
        var kk = 1 - Math.exp(-dt / 0.09); // ~400ms expo ease-out settle
        if (!mqRing.init) {
          mqRing.x = target.x; mqRing.y = target.y; mqRing.w = target.w; mqRing.h = target.h;
          mqRing.init = true;
        } else {
          mqRing.x += (target.x - mqRing.x) * kk;
          mqRing.y += (target.y - mqRing.y) * kk;
          mqRing.w += (target.w - mqRing.w) * kk;
          mqRing.h += (target.h - mqRing.h) * kk;
        }
        ring.style.opacity = '1';
        ring.style.transform = 'translate(' + mqRing.x + 'px,' + mqRing.y + 'px)';
        ring.style.width = mqRing.w + 'px';
        ring.style.height = mqRing.h + 'px';
      } else {
        ring.style.opacity = '0';
      }
    }
    requestAnimationFrame(marqueeStep);
  }
  function startMarqueeDrive() {
    var marquee = $('marquee');
    if (marquee) {
      marquee.addEventListener('mouseenter', function () { mqHold = true; });
      marquee.addEventListener('mouseleave', function () { mqHold = false; });
      marquee.addEventListener('touchstart', function () { mqHold = true; }, { passive: true });
      marquee.addEventListener('touchend', function () { mqHold = false; }, { passive: true });
      marquee.addEventListener('touchcancel', function () { mqHold = false; }, { passive: true });
    }
    requestAnimationFrame(marqueeStep);
  }

  // ---------- theologian detail page ----------
  var theoReturn = 'screen-start';

  function lifespanLine(th) {
    if (th.born && th.died) return 'Lived ' + (th.died - th.born) + ' years \u2022 ' + th.born + '\u2013' + th.died;
    if (th.born && !th.died) return 'Born ' + th.born + ' \u2022 Living';
    return 'Contemporary';
  }

  function renderTheoStrip(activeId) {
    var strip = $('theo-strip');
    var portraits = (typeof window !== 'undefined' && window.THEOLOGIAN_PORTRAITS) || {};
    if (!strip.dataset.built) {
      BANK.theologians.forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'theo-strip-item';
        b.dataset.tid = t.id;
        b.setAttribute('aria-label', t.name);
        if (portraits[t.id]) {
          var im = document.createElement('img');
          im.src = portraits[t.id];
          im.alt = '';
          im.loading = 'lazy';
          b.appendChild(im);
        } else {
          var sp = document.createElement('span');
          sp.className = 'theo-strip-initials';
          sp.textContent = initials(t.name);
          b.appendChild(sp);
        }
        b.addEventListener('click', function () { openTheologian(t.id); });
        strip.appendChild(b);
      });
      strip.dataset.built = '1';
      strip.addEventListener('scroll', function () { positionStripRing(); }, { passive: true });
    }
    var items = strip.querySelectorAll('.theo-strip-item');
    items.forEach(function (el) {
      el.classList.toggle('active', el.dataset.tid === activeId);
    });
  }

  function positionStripRing() {
    var strip = $('theo-strip'), ring = $('theo-strip-ring');
    if (!strip || !ring) return;
    var active = strip.querySelector('.theo-strip-item.active');
    if (!active) { ring.style.opacity = '0'; return; }
    ring.style.opacity = '1';
    ring.style.transform = 'translate(' + active.offsetLeft + 'px,' + active.offsetTop + 'px)';
    ring.style.width = active.offsetWidth + 'px';
    ring.style.height = active.offsetHeight + 'px';
  }

  function openTheologian(id) {
    var th = null;
    for (var k = 0; k < BANK.theologians.length; k++) {
      if (BANK.theologians[k].id === id) { th = BANK.theologians[k]; break; }
    }
    if (!th) return;
    var cur = document.querySelector('.screen.active');
    theoReturn = (cur && cur.id === 'screen-results') ? 'screen-results' : 'screen-start';
    var portraits = (typeof window !== 'undefined' && window.THEOLOGIAN_PORTRAITS) || {};
    var img = $('theo-portrait');
    if (portraits[th.id]) {
      img.src = portraits[th.id];
      img.style.display = '';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
    img.alt = 'Portrait of ' + th.name;
    renderTheoStrip(th.id);
    $('theo-tradition').textContent = traditionName(th.tradition);
    $('theo-name').textContent = th.name;
    $('theo-lifespan').textContent = lifespanLine(th);
    var sig = $('theo-signature');
    sig.textContent = th.blurb || '';
    sig.style.display = th.blurb ? '' : 'none';
    function fillParas(id, text) {
      var box = $(id);
      box.innerHTML = '';
      (text || '').split(/\n\n+/).forEach(function (para) {
        if (!para.trim()) return;
        var p = document.createElement('p');
        p.textContent = para.trim();
        box.appendChild(p);
      });
      var h = box.previousElementSibling;
      var has = box.children.length > 0;
      box.style.display = has ? '' : 'none';
      if (h && h.classList && h.classList.contains('section-title')) h.style.display = has ? '' : 'none';
    }
    fillParas('theo-impact', th.impact || th.bio || '');
    fillParas('theo-theology', th.theology || '');
    var ev = $('theo-events');
    ev.innerHTML = '';
    (th.events || []).forEach(function (e) {
      var item = document.createElement('div');
      item.className = 'theo-event';
      var yr = document.createElement('span');
      yr.className = 'theo-event-year';
      yr.textContent = e.year;
      var body = document.createElement('div');
      body.className = 'theo-event-body';
      var title = document.createElement('strong');
      title.textContent = e.title;
      var text = document.createElement('p');
      text.textContent = e.text;
      body.appendChild(title);
      body.appendChild(text);
      item.appendChild(yr);
      item.appendChild(body);
      ev.appendChild(item);
    });
    showScreen('screen-theologian');
    var tscr = $('screen-theologian');
    tscr.classList.remove('theo-swap');
    void tscr.offsetWidth;
    tscr.classList.add('theo-swap');
    // strip needs the screen visible before measuring
    var stripActive = $('theo-strip').querySelector('.theo-strip-item.active');
    if (stripActive) stripActive.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    positionStripRing();
    window.scrollTo(0, 0);
  }

  function wireTheologianPage() {
    $('btn-theo-back').addEventListener('click', function () {
      showScreen(theoReturn);
      window.scrollTo(0, 0);
    });
    $('btn-theo-quiz').addEventListener('click', function () {
      showScreen('screen-start');
      setTimeout(function () {
        var dg = $('depth-grid');
        if (dg) dg.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    });
  }

  // ---------- tooltips ----------
  function glossaryKey(label) {
    return label.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
  }

  function wireTooltips() {
    var tip = null;
    function hideTip() { if (tip) { tip.remove(); tip = null; } }
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.term') : null;
      if (!el) { hideTip(); return; }
      e.stopPropagation();
      var key = glossaryKey(el.dataset.term || el.textContent);
      var def = GLOSSARY[key];
      if (!def) return;
      if (tip && tip.dataset.for === key) { hideTip(); return; }
      hideTip();
      tip = document.createElement('div');
      tip.className = 'tooltip';
      tip.dataset.for = key;
      var title = document.createElement('strong');
      title.textContent = el.dataset.term || el.textContent;
      var body = document.createElement('span');
      body.textContent = def;
      tip.appendChild(title);
      tip.appendChild(body);
      document.body.appendChild(tip);
      var r = el.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(8, r.left - 40), window.innerWidth - 296) + 'px';
      tip.style.top = (r.bottom + window.scrollY + 8) + 'px';
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  }

  // ---------- summary ----------
  // Plain-language belief statements, keyed by axis id + pole (-1 left, 1 right).
  var BELIEF_LINES = {
    'soteriology|-1': "salvation is God's work from start to finish — he chooses and keeps his people",
    'soteriology|1': "salvation involves your genuine response — God invites, and you choose",
    'baptism|-1': "baptism is for people who've decided to follow Jesus themselves",
    'baptism|1': "you're at home with infants being welcomed into the faith through baptism",
    'spirit-gifts|-1': "you don't expect miraculous gifts like tongues and prophecy today",
    'spirit-gifts|1': "you expect God to still move through gifts like tongues and prophecy",
    'eschatology|-1': "you expect Jesus to return and set up a real kingdom on earth",
    'eschatology|1': "you see Jesus as reigning now, with history heading toward his final victory",
    'covenant|-1': "you read the Bible as God working in distinct eras, with Israel and the church on separate tracks",
    'covenant|1': "you read the whole Bible as one continuous story about Jesus",
    'scripture|-1': "you trust the Bible completely, even where it clashes with modern thinking",
    'scripture|1': "you trust the Bible's message while giving its human authors their historical context",
    'worship|-1': "you're cautious about adding things to worship that the Bible doesn't command",
    'worship|1': "you're glad when churches get creative in worship",
    'polity|-1': "you believe each local church should answer to no one but God",
    'polity|1': "you value churches being accountable to wider leadership",
    'gender-roles|-1': "you're convinced church leadership is reserved for men",
    'gender-roles|1': "you're comfortable with women leading at every level of the church",
    'assurance|-1': "you see a changed life as the proof of real faith",
    'assurance|1': "you're confident salvation rests on faith, even when life looks messy",
    'ordinances|-1': "you see baptism and communion mainly as symbols and remembrances",
    'ordinances|1': "you sense God truly meeting you in baptism and communion",
    'sanctification|-1': "you believe real freedom from sin's grip is possible in this life",
    'sanctification|1': "you expect the fight against sin to last a lifetime"
  };

  function buildSummary(axes, trads) {
    var top = trads[0];
    var html = '';
    html += '<p>Your answers point most strongly toward the <strong>' + esc(top.tradition.name) +
      '</strong> tradition (' + top.match.toFixed(1) + '/100 match).</p>';

    var strong = axes
      .filter(function (e) { return Math.abs(e.score) >= 20 && BELIEF_LINES[e.axis.id + '|' + (e.score < 0 ? -1 : 1)]; })
      .sort(function (a, b) { return Math.abs(b.score) - Math.abs(a.score); })
      .slice(0, 4);

    if (strong.length) {
      var lines = strong.map(function (e) {
        return BELIEF_LINES[e.axis.id + '|' + (e.score < 0 ? -1 : 1)];
      });
      var sentence;
      if (lines.length === 1) sentence = 'In particular, ' + lines[0] + '.';
      else {
        var last = lines.pop();
        sentence = 'In particular, ' + lines.join(', ') + ', and ' + last + '.';
      }
      html += '<p>' + esc(sentence) + '</p>';
    }

    var theos = BANK.theologians.filter(function (t) { return t.tradition === top.tradition.id; });
    if (theos.length) {
      html += '<p>You think most like <strong>' + esc(theos[0].name) + '</strong> — ' + esc(theos[0].blurb) + '</p>';
    }
    return html;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------- results ----------
  // ---------- low-signal detection ----------
  // Uniform responding (e.g. "disagree with everything") is adversarial input:
  // no honest weighting can turn it into a real profile, so refuse instead of
  // crowning a fake winner.
  function isLowSignal() {
    var vals = Object.keys(answers).map(function (k) { return answers[k]; });
    if (vals.length < 10) return false;
    var counts = {};
    vals.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    var top = Math.max.apply(null, Object.keys(counts).map(function (k) { return counts[k]; }));
    return top / vals.length >= 0.9;
  }

  function finishQuiz() {
    if (isLowSignal()) {
      showScreen('screen-lowsignal');
      window.scrollTo(0, 0);
      return;
    }
    $('progress-fill').style.width = '100%';
    var axes = scoreAxes();
    var trads = scoreTraditions();
    renderResults(axes, trads);
    showScreen('screen-results');
    window.scrollTo(0, 0);
  }

  function leanLabel(score) {
    var a = Math.abs(score);
    if (a < 12) return 'Balanced';
    if (a < 35) return score < 0 ? 'Leans left' : 'Leans right';
    if (a < 65) return score < 0 ? 'Firmly left' : 'Firmly right';
    return score < 0 ? 'Strongly left' : 'Strongly right';
  }

  function renderResults(axes, trads) {
    var top = trads[0];
    resetResultsTabs();
    $('result-tradition').textContent = top.tradition.name;
    $('result-match').textContent = top.match.toFixed(1);
    $('result-desc').textContent = top.tradition.description;

    // written summary
    $('summary-card').innerHTML = buildSummary(axes, trads);

    // theologians of the top tradition (up to 3)
    var theoGrid = $('theologian-grid');
    theoGrid.innerHTML = '';
    var theos = BANK.theologians.filter(function (t) { return t.tradition === top.tradition.id; }).slice(0, 3);
    if (!theos.length) {
      // fall back to theologians of the runner-up tradition
      theos = BANK.theologians.filter(function (t) { return t.tradition === trads[1].tradition.id; }).slice(0, 3);
    }
    theos.forEach(function (t) {
      var card = document.createElement('div');
      card.className = 'theologian-card';
      card.innerHTML = '<img class="theologian-portrait" alt=""><h3></h3><div class="theologian-dates"></div><p></p>';
      var img = card.querySelector('img');
      var portraits = (typeof window !== 'undefined' && window.THEOLOGIAN_PORTRAITS) || {};
      img.src = portraits[t.id] || '';
      img.alt = 'Portrait of ' + t.name;
      if (!img.src) img.style.display = 'none';
      img.onerror = function () { img.style.display = 'none'; };
      card.querySelector('h3').textContent = t.name;
      card.querySelector('.theologian-dates').textContent = t.dates || '';
      card.querySelector('p').textContent = t.blurb;
      card.classList.add('clickable');
      card.addEventListener('click', function () { openTheologian(t.id); });
      theoGrid.appendChild(card);
    });

    // cache for share / compare actions
    LAST = { axes: axes, trads: trads, theos: theos };

    // friend comparison (when opened from a ?compare= link)
    renderCompare(axes, trads);

    // why these matches?
    renderWhy(theos);

    // axes
    var axesList = $('axes-list');
    axesList.innerHTML = '';
    axes.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'axis-row';
      var pos = (entry.score + 100) / 2; // 0..100 for marker
      row.innerHTML =
        '<div class="axis-head"><span class="axis-name"></span><span class="axis-lean"></span></div>' +
        '<div class="axis-desc"></div>' +
        '<div class="axis-bar"><div class="axis-marker"></div></div>' +
        '<div class="axis-poles"><span></span><span></span></div>';
      row.querySelector('.axis-name').textContent = entry.axis.label;
      row.querySelector('.axis-lean').textContent = leanLabel(entry.score) + ' (' + (entry.score > 0 ? '+' : '') + entry.score + ')';
      row.querySelector('.axis-desc').textContent = entry.axis.description;
      row.querySelector('.axis-marker').style.left = pos + '%';
      var poles = row.querySelectorAll('.axis-poles span');
      poles[0].textContent = entry.axis.left;
      poles[1].textContent = entry.axis.right;
      poles[0].className = 'term';
      poles[1].className = 'term';
      poles[0].dataset.term = entry.axis.left;
      poles[1].dataset.term = entry.axis.right;
      axesList.appendChild(row);
    });

    // ranked traditions
    var rank = $('tradition-rank');
    rank.innerHTML = '';
    trads.forEach(function (entry, i) {
      var row = document.createElement('div');
      row.className = 'trad-row' + (i === 0 ? ' top' : '');
      row.innerHTML = '<span class="trad-name"></span>' +
        '<span class="trad-bar-wrap"><span class="trad-bar"></span></span>' +
        '<span class="trad-score"></span>';
      row.querySelector('.trad-name').textContent = entry.tradition.name;
      var bar = row.querySelector('.trad-bar');
      bar.style.width = '0%';
      row.querySelector('.trad-score').textContent = entry.match.toFixed(1);
      rank.appendChild(row);
      (function (b, m) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { b.style.width = m + '%'; });
        });
      })(bar, entry.match);
    });

    // close-call explainer (only when the top is nearly tied)
    renderCloseCall(trads);

    // reading list + unsure-answer exploration
    renderReadingList(LAST.theos);
    renderUnsure();

    // answer review (built lazily on toggle)
    var review = $('answer-review');
    review.classList.add('hidden');
    review.innerHTML = '';
    $('btn-review').textContent = 'Review my answers';
  }

  var RESP_LABELS = { '-2': 'Strongly disagree', '-1': 'Disagree', '0': 'Neutral / unsure', '1': 'Agree', '2': 'Strongly agree' };

  $('btn-review').addEventListener('click', function () {
    var review = $('answer-review');
    if (!review.classList.contains('hidden')) {
      review.classList.add('hidden');
      review.innerHTML = '';
      this.textContent = 'Review my answers';
      return;
    }
    queue.forEach(function (q) {
      var item = document.createElement('div');
      item.className = 'review-item';
      item.innerHTML = '<div class="rq"></div><div class="ra"></div>';
      item.querySelector('.rq').textContent = q.text;
      var v = answers[q.id];
      item.querySelector('.ra').textContent = v === undefined ? 'Skipped' : RESP_LABELS[String(v)];
      review.appendChild(item);
    });
    review.classList.remove('hidden');
    this.textContent = 'Hide answer review';
  });

  $('btn-retake').addEventListener('click', function () {
    showScreen('screen-start');
    window.scrollTo(0, 0);
  });

  var lowBtn = $('btn-lowsignal-retake');
  if (lowBtn) lowBtn.addEventListener('click', function () {
    showScreen('screen-start');
    window.scrollTo(0, 0);
  });

  // ---------- "why these matches?" ----------
  // For each matched theologian, surface the 3 answers that contributed most
  // to their tradition's score (weight x response, positive contributions only).
  function renderWhy(theos) {
    var wrap = $('why-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    theos.forEach(function (t) {
      var tid = t.tradition;
      var scored = [];
      queue.forEach(function (q) {
        var resp = answers[q.id];
        if (resp === undefined) return;
        var w = (q.traditions || {})[tid] || 0;
        var contrib = w * resp;
        if (contrib > 0) scored.push({ q: q, contrib: contrib, resp: resp });
      });
      scored.sort(function (a, b) { return b.contrib - a.contrib; });
      var top3 = scored.slice(0, 3);
      var card = document.createElement('div');
      card.className = 'why-card';
      var html = '<h4>' + esc(t.name) + '</h4>';
      if (!top3.length) {
        html += '<p class="why-empty">No single answer drove this match — it came from your overall pattern.</p>';
      } else {
        html += '<ol>' + top3.map(function (s) {
          return '<li><span class="why-q">' + esc(s.q.text) + '</span>' +
            '<span class="why-a">You answered: <strong>' + esc(RESP_LABELS[String(s.resp)]) + '</strong></span></li>';
        }).join('') + '</ol>';
      }
      card.innerHTML = html;
      wrap.appendChild(card);
    });
  }

  // ---------- reading list ----------
  function renderReadingList(theos) {
    var wrap = $('reading-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    var books = (READING && READING.books) || {};
    theos.forEach(function (t) {
      var b = books[t.id];
      if (!b) return;
      var card = document.createElement('div');
      card.className = 'book-card';
      var titleHtml = b.url
        ? '<a class="book-link" href="' + esc(b.url) + '" target="_blank" rel="noopener">Read / find it <span aria-hidden="true">&rarr;</span></a>'
        : '';
      card.innerHTML = '<div class="book-title"></div><div class="book-author"></div><p class="book-note"></p>' + titleHtml;
      card.querySelector('.book-title').textContent = b.title;
      card.querySelector('.book-author').textContent = 'by ' + b.author;
      card.querySelector('.book-note').textContent = b.note;
      wrap.appendChild(card);
    });
  }

  // ---------- unsure-answer exploration ----------
  // Questions answered "Neutral / unsure", grouped by topic. Each topic shows
  // the questions the user was unsure about plus hand-picked resources —
  // articles, booklets, and books — to help them explore the idea.
  function renderUnsure() {
    var wrap = $('unsure-wrap'), list = $('unsure-list');
    if (!wrap || !list) return;
    list.innerHTML = '';
    var res = (READING && READING.axisResources) || {};
    var byAxis = {};
    queue.forEach(function (q) {
      if (answers[q.id] !== 0) return;
      var axisId = (q.axes && q.axes[0] && q.axes[0].axis) || null;
      if (!axisId || !res[axisId]) return;
      (byAxis[axisId] = byAxis[axisId] || []).push(q);
    });
    var ids = Object.keys(byAxis);
    if (!ids.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    ids.forEach(function (axisId) {
      var r = res[axisId];
      var qs = byAxis[axisId];
      var card = document.createElement('div');
      card.className = 'unsure-card';
      var html = '<div class="unsure-topic">Unsure on: ' + esc(r.label) + '</div>' +
        '<ul class="unsure-qs">' +
        qs.map(function (q) { return '<li>' + esc(q.text) + '</li>'; }).join('') +
        '</ul>' +
        '<div class="unsure-resources">' +
        r.resources.map(function (rc) {
          var link = rc.url
            ? '<a class="book-link" href="' + esc(rc.url) + '" target="_blank" rel="noopener">Read / find it <span aria-hidden="true">&rarr;</span></a>'
            : '';
          return '<div class="unsure-res"><span class="res-kind">' + esc(rc.kind) + '</span>' +
            '<div class="book-title">' + esc(rc.title) + '</div>' +
            '<div class="book-author">by ' + esc(rc.author) + '</div>' +
            '<p class="book-note">' + esc(rc.note) + '</p>' + link + '</div>';
        }).join('') +
        '</div>';
      card.innerHTML = html;
      list.appendChild(card);
    });
  }

  // ---------- take-it-together compare mode ----------
  function readCompareParam() {
    try {
      var m = /[?&]compare=([^&]+)/.exec(window.location.search);
      if (!m) return null;
      var s = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      var obj = JSON.parse(atob(s));
      if (!obj || obj.v !== 1 || !Array.isArray(obj.a) || !obj.t) return null;
      return obj;
    } catch (e) { return null; }
  }

  function encodeCompare(axes, trads) {
    var payload = { v: 1, a: axes.map(function (e) { return e.score; }), t: {} };
    trads.forEach(function (e) { payload.t[e.tradition.id] = e.match; });
    return btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  }

  function tradById(id) {
    var found = null;
    BANK.traditions.forEach(function (t) { if (t.id === id) found = t; });
    return found;
  }

  function renderCompare(axes, trads) {
    var wrap = $('compare-result');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!COMPARE_WITH) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    var other = COMPARE_WITH;

    // axis agreement
    var diffs = axes.map(function (e, i) {
      var o = (other.a && typeof other.a[i] === 'number') ? other.a[i] : 0;
      return { label: e.axis.label, mine: e.score, theirs: o, diff: Math.abs(e.score - o) };
    });
    var agree = diffs.slice().sort(function (a, b) { return a.diff - b.diff; })[0];
    var differ = diffs.slice().sort(function (a, b) { return b.diff - a.diff; })[0];

    // shared top-3 traditions
    var mine = trads.slice(0, 3).map(function (e) { return e.tradition.id; });
    var theirIds = Object.keys(other.t || {}).sort(function (a, b) { return other.t[b] - other.t[a]; }).slice(0, 3);
    var shared = mine.filter(function (id) { return theirIds.indexOf(id) !== -1; });

    var html = '<h3 class="cmp-title">Theology compare</h3>' +
      '<div class="cmp-headlines">' +
      '<div class="cmp-line"><span class="cmp-emoji">🤝</span><span>You agree most on <strong>' + esc(agree.label) + '</strong></span></div>' +
      '<div class="cmp-line"><span class="cmp-emoji">⚡</span><span>You differ most on <strong>' + esc(differ.label) + '</strong></span></div>' +
      '</div>';
    if (shared.length) {
      html += '<p class="cmp-shared">Shared top traditions: ' +
        shared.map(function (id) { var t = tradById(id); return '<strong>' + esc(t ? t.name : id) + '</strong>'; }).join(', ') +
        '</p>';
    }
    html += '<div class="cmp-rows">' + BANK.traditions.map(function (t) {
      var me = null, them = (other.t || {})[t.id];
      trads.forEach(function (e) { if (e.tradition.id === t.id) me = e.match; });
      me = me === null ? 0 : me;
      them = typeof them === 'number' ? them : 0;
      return '<div class="cmp-row"><span class="cmp-name">' + esc(t.name) + '</span>' +
        '<span class="cmp-bars"><span class="cmp-bar cmp-me" style="width:' + me.toFixed(1) + '%"></span>' +
        '<span class="cmp-bar cmp-them" style="width:' + them.toFixed(1) + '%"></span></span>' +
        '<span class="cmp-scores"><b>' + me.toFixed(0) + '</b> vs ' + them.toFixed(0) + '</span></div>';
    }).join('') + '</div>' +
      '<p class="cmp-legend"><span class="cmp-key cmp-me"></span> You <span class="cmp-key cmp-them"></span> Them</p>';
    wrap.innerHTML = html;
  }

  function wireResultsTabs() {
    var nav = $('results-tabs');
    if (!nav) return;
    var tabs = Array.prototype.slice.call(nav.querySelectorAll('.rtab'));
    var indicator = $('tabs-indicator');
    function moveIndicator(btn) {
      if (!indicator || !btn) return;
      indicator.style.width = btn.offsetWidth + 'px';
      indicator.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
    }
    function selectTab(btn) {
      tabs.forEach(function (t) { t.classList.toggle('active', t === btn); });
      document.querySelectorAll('.tab-panel').forEach(function (p) {
        p.classList.toggle('active', p.id === 'panel-' + btn.dataset.tab);
      });
      moveIndicator(btn);
    }
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () { selectTab(btn); });
    });
    window.addEventListener('resize', function () {
      moveIndicator(nav.querySelector('.rtab.active'));
    });
    // called on every renderResults so a retake starts on Summary
    resetResultsTabs = function () {
      tabs.forEach(function (t) { t.classList.toggle('active', t === tabs[0]); });
      document.querySelectorAll('.tab-panel').forEach(function (p) {
        p.classList.toggle('active', p.id === 'panel-summary');
      });
      // layout may not be settled yet; wait a frame
      requestAnimationFrame(function () { moveIndicator(tabs[0]); });
    };
  }
  var resetResultsTabs = function () {};

  function wireResultsActions() {
    var shareBtn = $('btn-share'), cmpBtn = $('btn-compare');
    if (shareBtn) shareBtn.addEventListener('click', shareResults);
    if (cmpBtn) cmpBtn.addEventListener('click', function () {
      if (!LAST) return;
      var code = encodeCompare(LAST.axes, LAST.trads);
      var url = window.location.origin + window.location.pathname + '?compare=' + code;
      var btn = this;
      var orig = btn.textContent;
      copyText(url, function (ok) {
        btn.textContent = ok ? 'Link copied — send it!' : 'Copy this link:';
        if (!ok) { try { window.prompt('Copy your compare link:', url); } catch (e) {} }
        setTimeout(function () { btn.textContent = orig; }, 2500);
      });
    });
  }

  // ---------- shareable results (text) ----------
  // Builds a compact, textable summary of the results — copy/paste into
  // Messages, social posts, etc. Uses the OS share sheet when available.
  function buildShareText() {
    var top = LAST.trads[0];
    var theos = LAST.theos || [];
    var lines = [];
    lines.push('My Protestant Theology Profile');
    lines.push('');
    lines.push(top.tradition.name + ' — ' + top.match.toFixed(1) + '/100 match');
    if (theos.length) {
      lines.push('Closest theologians: ' + theos.map(function (t) { return t.name; }).join(', '));
    }
    lines.push('');
    lines.push('Strongest convictions:');
    LAST.axes.slice()
      .sort(function (a, b) { return Math.abs(b.score) - Math.abs(a.score); })
      .slice(0, 3)
      .forEach(function (e) {
        var pole = e.score >= 0 ? e.axis.right : e.axis.left;
        lines.push('\u2022 ' + e.axis.label + ': ' + (e.score > 0 ? '+' : '') + e.score + ' (' + pole + ')');
      });
    lines.push('');
    lines.push('Take the quiz: noahveenstra.com/protestant-theology-quiz');
    return lines.join('\n');
  }

  function shareResults() {
    if (!LAST) return;
    var text = buildShareText();
    var btn = $('btn-share');
    var orig = btn ? btn.textContent : '';
    function done(msg) {
      if (!btn) return;
      btn.textContent = msg;
      setTimeout(function () { btn.textContent = orig; }, 2500);
    }
    if (navigator.share) {
      navigator.share({ title: 'My Protestant theology profile', text: text })
        .then(function () { done('Shared!'); })
        .catch(function () { /* user dismissed — copy instead */ copyText(text, function (ok) { done(ok ? 'Copied — paste it anywhere!' : 'Copy failed'); }); });
    } else {
      copyText(text, function (ok) { done(ok ? 'Copied — paste it anywhere!' : 'Copy failed'); });
    }
  }
})();
