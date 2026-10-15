// Protestant Theology Quiz — engine
(function () {
  'use strict';

  var BANK = null;
  var GLOSSARY = {};
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
    fetch('glossary.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
  ])
    .then(function (results) {
      BANK = results[0];
      GLOSSARY = results[1] || {};
      wireDepthCards();
      wireTooltips();
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
    var html = '<h3>Why ' + esc(top.tradition.name) + ' edged it</h3>';
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
  var manualUntil = 0; // timestamp: tap overrides auto-follow until this time

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
        b.addEventListener('click', function () {
          renderSpotlight(i);
          manualUntil = Date.now() + 8000; // hold the tap for 8s, then auto-follow resumes
        });
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
      if (Date.now() < manualUntil) return; // user tapped; hold their pick
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
  function finishQuiz() {
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
      theoGrid.appendChild(card);
    });

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
      row.querySelector('.trad-bar').style.width = entry.match + '%';
      row.querySelector('.trad-score').textContent = entry.match.toFixed(1);
      rank.appendChild(row);
    });

    // close-call explainer (only when the top is nearly tied)
    renderCloseCall(trads);

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
})();
