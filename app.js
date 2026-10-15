// Protestant Theology Quiz — engine
(function () {
  'use strict';

  var BANK = null;
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
  fetch('question-bank.json')
    .then(function (r) { if (!r.ok) throw new Error('bank load failed'); return r.json(); })
    .then(function (data) {
      BANK = data;
      $('qcount').textContent = BANK.questions.length;
      wireDepthCards();
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
      var match = Math.round((norm + 100) / 2);     // 0..100
      return { tradition: t, score: norm, match: match };
    }).sort(function (a, b) { return b.match - a.match; });
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
    $('result-match').textContent = top.match;
    $('result-desc').textContent = top.tradition.description;

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
      card.innerHTML = '<h3></h3><div class="theologian-dates"></div><p></p>';
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
      row.querySelector('.trad-score').textContent = entry.match;
      rank.appendChild(row);
    });

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
