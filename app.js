'use strict';

const STORAGE_KEY = 'realkana-clone:v2';

// Word cards show a real picture, not a rendered emoji glyph — each emoji maps to its
// Twemoji artwork (open licensed, CC-BY 4.0: https://github.com/twitter/twemoji) served
// as an actual image file instead of relying on the OS/browser's emoji font.
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/';
function emojiImageUrl(emoji) {
  const code = [...emoji]
    .map(ch => ch.codePointAt(0))
    .filter(cp => cp !== 0xfe0f) // strip the text/emoji variation selector, per Twemoji's file naming
    .map(cp => cp.toString(16))
    .join('-');
  return `${TWEMOJI_BASE}${code}.svg`;
}

// Self-quiz cover, Study screen only: click the character (or the English
// meaning, on a kanji/counting round) to blur it behind a closed-eye icon —
// an easy self-test. Each one's on/off state carries forward to the next
// card too, for the rest of this study session, rather than resetting every
// card. Original hand-drawn icon (arc + lashes), not any icon library's.
const EYE_CLOSED_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 12c3-4.5 6.5-7 10-7s7 2.5 10 7"/>
  <path d="M4.5 15.5l1.5-2M19.5 15.5l-1.5-2M9 17.5l.7-2.4M15 17.5l-.7-2.4"/>
</svg>`;

function peekWrap(innerHtml, key, big) {
  const cls = big ? 'peek-wrap peek-wrap-lg' : 'peek-wrap';
  return `<span class="${cls}" data-cover-key="${key}">${innerHtml}<span class="peek-icon" aria-hidden="true">${EYE_CLOSED_ICON}</span></span>`;
}

// Applies the persisted covered/uncovered state to each .peek-wrap on the
// current card, and wires clicks to toggle both the DOM and that state.
function wireStudyCovers() {
  els.charDisplay.querySelectorAll('.peek-wrap').forEach(wrap => {
    const key = wrap.dataset.coverKey;
    wrap.title = 'Click to hide/reveal';
    if (quiz.covered[key]) wrap.classList.add('covered');
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      quiz.covered[key] = wrap.classList.toggle('covered');
    });
  });
}

const els = {
  mainTabs: document.querySelectorAll('.tabs-left button'),
  subTabs: document.querySelectorAll('#sub-tabs button'),
  charView: document.getElementById('char-view'),
  kanjiView: document.getElementById('kanji-view'),
  kanjiGrid: document.getElementById('kanji-grid'),
  kanjiQuickSelect: document.getElementById('kanji-quick-select'),
  kanjiSelectAll: document.getElementById('kanji-select-all'),
  kanjiSelectNone: document.getElementById('kanji-select-none'),
  countingView: document.getElementById('counting-view'),
  countingSubTabs: document.querySelectorAll('#counting-sub-tabs button'),
  countingGrid: document.getElementById('counting-grid'),
  countingSelectAll: document.getElementById('counting-select-all'),
  countingSelectNone: document.getElementById('counting-select-none'),
  randomControls: document.getElementById('random-controls'),
  randomDigitSelect: document.getElementById('random-digit-select'),
  randomRegenerate: document.getElementById('random-regenerate'),
  vocabView: document.getElementById('vocab-view'),
  vocabSubTabs: document.querySelectorAll('#vocab-sub-tabs button'),
  vocabGrid: document.getElementById('vocab-grid'),
  vocabSelectAll: document.getElementById('vocab-select-all'),
  vocabSelectNone: document.getElementById('vocab-select-none'),
  grammarView: document.getElementById('grammar-view'),
  grammarSubTabs: document.querySelectorAll('#grammar-sub-tabs button'),
  grammarList: document.getElementById('grammar-list'),
  studyView: document.getElementById('study-view'),
  panelTitle: document.getElementById('panel-title'),
  panelBadge: document.getElementById('panel-badge'),
  gridHint: document.getElementById('grid-hint'),
  charGrid: document.getElementById('char-grid'),
  selectAll: document.getElementById('select-all'),
  selectNone: document.getElementById('select-none'),
  universalActions: document.querySelector('.universal-actions'),
  selectAllUniversal: document.getElementById('select-all-universal'),
  clearAllUniversal: document.getElementById('clear-all-universal'),

  studyIntro: document.getElementById('study-intro'),
  studyCount: document.getElementById('study-count'),
  startBtn: document.getElementById('start-btn'),
  answerModeToggle: document.querySelectorAll('#answer-mode-toggle button'),

  quiz: document.getElementById('quiz'),
  charDisplay: document.getElementById('char-display'),
  answerInput: document.getElementById('answer-input'),
  mcqOptions: document.getElementById('mcq-options'),
  playAudioBtn: document.getElementById('play-audio-btn'),
  statProgress: document.getElementById('stat-progress'),
  stopBtn: document.getElementById('stop-btn'),

  summary: document.getElementById('summary'),
  summaryText: document.getElementById('summary-text'),
  backBtn: document.getElementById('back-btn'),
};

const SETS = ['hiragana', 'katakana'];
const MODES = ['single', 'double', 'words']; // "double" = combination/yōon (data.js calls it "combo")
const MODE_DATA_KEY = { single: 'single', double: 'combo' };
const COUNTING_MODES = ['basic', 'tens', 'hundreds', 'thousands', 'tenthousands', 'random', 'objects', 'people', 'age'];
const VOCAB_UNITS = ['unit1', 'unit2', 'unit3', 'unit4', 'unit5', 'unit6'];

// ---- persisted state ----
let ui = { tab: 'hiragana', sub: 'single', countingSub: 'basic', vocabSub: 'unit3', grammarSub: 'unit1' };
let store = loadStore();

// Tracks which items have been answered correctly at least once this session
// (resets on page reload — a "session" is however long this tab stays open).
// Used purely to show a small dot on not-yet-answered tiles in the pickers.
const answeredThisSession = new Set();
function itemId(set, mode, kana) { return `${set}::${mode}::${kana}`; }

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt storage */ }
  return { selections: {} };
}

function saveStore() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
}

function selectionKey(set, mode) {
  return `${set}_${mode}`;
}

function allCharsFor(set, mode) {
  if (set === 'kanji') {
    return KANJI_DATA.n5.map(k => ({
      kana: k.kanji, romaji: k.reading, alts: k.alts || [], group: 'kanji', meaning: k.meaning,
      id: itemId('kanji', 'n5', k.kanji),
    }));
  }
  if (set === 'counting') {
    if (mode === 'random') {
      return randomNumbersCache.map(c => ({
        kana: c.jp, romaji: c.romaji, alts: [], group: 'counting_random', meaning: c.meaning,
        id: itemId('counting', 'random', c.jp),
      }));
    }
    return COUNTING_DATA[mode].map(c => ({
      kana: c.jp, romaji: c.romaji, alts: c.alts || [], group: 'counting', meaning: c.meaning,
      id: itemId('counting', mode, c.jp),
    }));
  }
  if (set === 'vocab') {
    return (VOCAB_DATA[mode] || []).map(w => ({
      kana: w.jp, romaji: w.romaji, alts: w.alts || [], group: `vocab_${mode}`,
      emoji: w.emoji, meaning: w.meaning, id: itemId('vocab', mode, w.jp),
    }));
  }
  if (mode === 'words') {
    return WORD_DATA[set].map(w => ({
      kana: w.jp, romaji: w.romaji, alts: w.alts || [], group: 'words', emoji: w.emoji,
      id: itemId(set, 'words', w.jp),
    }));
  }
  const groups = KANA_DATA[set][MODE_DATA_KEY[mode]];
  const out = [];
  groups.forEach(g => g.chars.forEach(entry => {
    const [kana, romaji, ...alts] = entry;
    out.push({ kana, romaji, alts, group: g.key, id: itemId(set, mode, kana) });
  }));
  return out;
}

function getSelectedSet(set, mode) {
  const key = selectionKey(set, mode);
  if (!store.selections[key]) {
    // default: everything selected except groups literally named "extra"
    const defaults = allCharsFor(set, mode)
      .filter(c => c.group !== 'extra')
      .map(c => c.kana);
    store.selections[key] = defaults;
  }
  return new Set(store.selections[key]);
}

function setSelectedSet(set, mode, kanaSet) {
  store.selections[selectionKey(set, mode)] = [...kanaSet];
  saveStore();
}

// ---- tab / nav ----
function renderTabs() {
  els.mainTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === ui.tab));
  els.subTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.sub === ui.sub));
  els.countingSubTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.csub === ui.countingSub));
  els.vocabSubTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.vsub === ui.vocabSub));
  els.grammarSubTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.gsub === ui.grammarSub));

  const isStudy = ui.tab === 'study';
  const isKanji = ui.tab === 'kanji';
  const isCounting = ui.tab === 'counting';
  const isVocab = ui.tab === 'vocab';
  const isGrammar = ui.tab === 'grammar';
  els.universalActions.hidden = isStudy || isGrammar; // not relevant once studying, or for the grammar reference
  els.charView.hidden = isStudy || isKanji || isCounting || isVocab || isGrammar;
  els.kanjiView.hidden = !isKanji;
  els.countingView.hidden = !isCounting;
  els.vocabView.hidden = !isVocab;
  els.grammarView.hidden = !isGrammar;
  els.studyView.hidden = !isStudy;

  if (ui.tab === 'hiragana' || ui.tab === 'katakana') {
    els.panelTitle.textContent = ui.tab === 'hiragana' ? 'Hiragana' : 'Katakana';
    els.panelBadge.textContent = ui.tab === 'hiragana' ? 'あ' : 'ア';
    els.panelBadge.className = 'badge ' + ui.tab;
    els.gridHint.innerHTML = ui.sub === 'words'
      ? 'Choose some words, then switch to the <b>STUDY</b> tab.'
      : 'Choose some characters, then switch to the <b>STUDY</b> tab.';
  }
}

els.mainTabs.forEach(btn => btn.addEventListener('click', () => {
  ui.tab = btn.dataset.tab;
  renderTabs();
  if (ui.tab === 'hiragana' || ui.tab === 'katakana') {
    renderCharGrid();
    return;
  }
  if (ui.tab === 'kanji') {
    renderKanjiGrid();
    return;
  }
  if (ui.tab === 'counting') {
    renderCountingGrid();
    return;
  }
  if (ui.tab === 'vocab') {
    renderVocabGrid();
    return;
  }
  if (ui.tab === 'grammar') {
    renderGrammarList();
    return;
  }
  // Coming back to Study should resume exactly where things were — an
  // in-progress quiz or a just-finished summary — rather than resetting to
  // the intro screen. Only the untouched intro state gets refreshed, since
  // character selections may have changed on the other tabs meanwhile.
  if (quiz) {
    els.answerInput.focus();
    return;
  }
  if (!els.summary.hidden) return;
  refreshStudyIntro();
}));

els.subTabs.forEach(btn => btn.addEventListener('click', () => {
  ui.sub = btn.dataset.sub;
  renderTabs();
  renderCharGrid();
}));

els.countingSubTabs.forEach(btn => btn.addEventListener('click', () => {
  ui.countingSub = btn.dataset.csub;
  renderTabs();
  renderCountingGrid();
}));

// ---- character grid (click a tile to toggle one character, click a column's
// label to toggle every character in that whole group at once) ----
function renderCharGrid() {
  const set = ui.tab === 'katakana' ? 'katakana' : 'hiragana';
  const mode = ui.sub;
  els.charGrid.innerHTML = '';

  if (mode === 'words') {
    renderWordGrid(set);
    return;
  }

  const groups = KANA_DATA[set][MODE_DATA_KEY[mode]];
  const selected = getSelectedSet(set, mode);
  const COLUMN_CHUNK = 5; // matches the tallest normal row (single-mode groups top out at 5)

  groups.forEach(g => {
    const groupChars = g.chars.map(c => c[0]);
    const allSelected = groupChars.every(k => selected.has(k));

    // Long groups (e.g. katakana's loanword "extra" list) get split into several
    // label-aligned columns instead of one very tall strip, keeping the grid's rhythm.
    for (let start = 0; start < g.chars.length; start += COLUMN_CHUNK) {
      const chunk = g.chars.slice(start, start + COLUMN_CHUNK);
      const col = document.createElement('div');
      col.className = 'char-col';

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'col-label' + (allSelected ? ' all-selected' : '');
      label.textContent = start === 0 ? g.label : ' ';
      label.title = `Select/deselect all "${g.label}" characters`;
      label.addEventListener('click', () => {
        const cur = getSelectedSet(set, mode);
        if (allSelected) groupChars.forEach(k => cur.delete(k));
        else groupChars.forEach(k => cur.add(k));
        setSelectedSet(set, mode, cur);
        renderCharGrid();
      });
      col.appendChild(label);

      chunk.forEach(entry => {
        const [kana, romaji] = entry;
        const tile = document.createElement('button');
        tile.type = 'button';
        const unanswered = !answeredThisSession.has(itemId(set, mode, kana));
        tile.className = 'char-tile' + (selected.has(kana) ? ' selected' : '') + (unanswered ? ' unanswered' : '');
        tile.innerHTML = `<span class="kana">${kana}</span><span class="romaji">${romaji}</span>`;
        tile.addEventListener('click', () => {
          const cur = getSelectedSet(set, mode);
          if (cur.has(kana)) cur.delete(kana); else cur.add(kana);
          setSelectedSet(set, mode, cur);
          renderCharGrid();
        });
        col.appendChild(tile);
      });
      els.charGrid.appendChild(col);
    }
  });
}

// Words have no consonant-row grouping — just a flat wrapping grid of picture cards.
function renderWordGrid(set) {
  const words = allCharsFor(set, 'words');
  const selected = getSelectedSet(set, 'words');

  words.forEach(w => {
    const tile = document.createElement('button');
    tile.type = 'button';
    const unanswered = !answeredThisSession.has(w.id);
    tile.className = 'word-tile' + (selected.has(w.kana) ? ' selected' : '') + (unanswered ? ' unanswered' : '');
    tile.innerHTML = `
      <img class="word-emoji" src="${emojiImageUrl(w.emoji)}" alt="" loading="lazy" />
      <span class="kana word-jp">${w.kana}</span>
      <span class="romaji word-romaji">${w.romaji}</span>
    `;
    tile.addEventListener('click', () => {
      const cur = getSelectedSet(set, 'words');
      if (cur.has(w.kana)) cur.delete(w.kana); else cur.add(w.kana);
      setSelectedSet(set, 'words', cur);
      renderCharGrid();
    });
    els.charGrid.appendChild(tile);
  });
}

// Kanji has no consonant-row/set structure either — one flat picker grid, like Words.
function renderKanjiGrid() {
  const items = allCharsFor('kanji', 'n5');
  const selected = getSelectedSet('kanji', 'n5');
  els.kanjiGrid.innerHTML = '';

  items.forEach(k => {
    const tile = document.createElement('button');
    tile.type = 'button';
    const unanswered = !answeredThisSession.has(k.id);
    tile.className = 'kanji-tile' + (selected.has(k.kana) ? ' selected' : '') + (unanswered ? ' unanswered' : '');
    tile.innerHTML = `
      <span class="kana kanji-char">${k.kana}</span>
      <span class="kanji-meaning">${k.meaning}</span>
      <span class="romaji kanji-reading">${k.romaji}</span>
    `;
    tile.addEventListener('click', () => {
      const cur = getSelectedSet('kanji', 'n5');
      if (cur.has(k.kana)) cur.delete(k.kana); else cur.add(k.kana);
      setSelectedSet('kanji', 'n5', cur);
      renderKanjiGrid();
    });
    els.kanjiGrid.appendChild(tile);
  });
}

// ---- Random numbers: freshly generated on demand, not a fixed list ----
// Composes the standard Japanese reading for any integer up to 99,999,999
// (one "man" grouping) — the same rendaku rules used throughout this app's
// hand-written counting data (300=sanbyaku, 600/800 double, etc), just
// applied algorithmically instead of listed one by one.
function composeFourDigitReading(n) {
  if (n === 0) return { jp: '', romaji: '' };
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  const THOUSAND_JP = ['', '千', '二千', '三千', '四千', '五千', '六千', '七千', '八千', '九千'];
  const THOUSAND_RO = ['', 'sen', 'nisen', 'sanzen', 'yonsen', 'gosen', 'rokusen', 'nanasen', 'hassen', 'kyuusen'];
  const HUNDRED_JP = ['', '百', '二百', '三百', '四百', '五百', '六百', '七百', '八百', '九百'];
  const HUNDRED_RO = ['', 'hyaku', 'nihyaku', 'sanbyaku', 'yonhyaku', 'gohyaku', 'roppyaku', 'nanahyaku', 'happyaku', 'kyuuhyaku'];
  const TEN_JP = ['', '十', '二十', '三十', '四十', '五十', '六十', '七十', '八十', '九十'];
  const TEN_RO = ['', 'juu', 'nijuu', 'sanjuu', 'yonjuu', 'gojuu', 'rokujuu', 'nanajuu', 'hachijuu', 'kyuujuu'];
  const ONE_JP = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const ONE_RO = ['', 'ichi', 'ni', 'san', 'yon', 'go', 'roku', 'nana', 'hachi', 'kyuu'];
  return {
    jp: THOUSAND_JP[thousands] + HUNDRED_JP[hundreds] + TEN_JP[tens] + ONE_JP[ones],
    romaji: THOUSAND_RO[thousands] + HUNDRED_RO[hundreds] + TEN_RO[tens] + ONE_RO[ones],
  };
}

function numberToJapanese(n) {
  if (n === 0) return { jp: 'ゼロ', romaji: 'zero' };
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  let jp = '', romaji = '';
  if (man > 0) {
    const manPart = composeFourDigitReading(man);
    jp += manPart.jp + '万';
    romaji += manPart.romaji + 'man';
  }
  if (rest > 0) {
    const restPart = composeFourDigitReading(rest);
    jp += restPart.jp;
    romaji += restPart.romaji;
  }
  return { jp, romaji };
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const RANDOM_BATCH_SIZE = 20;
const RANDOM_MAX_DIGITS = 8; // caps at 99,999,999 — one level of 万, no 億 needed
let randomDigitOption = 'any'; // '2'..'8' or 'any'
let randomNumbersCache = [];

function generateRandomNumbers(digitOption, count) {
  const seen = new Set();
  const out = [];
  let guard = 0;
  while (out.length < count && guard < count * 50) {
    guard++;
    const digits = digitOption === 'any' ? randomInt(2, RANDOM_MAX_DIGITS) : Number(digitOption);
    const min = Math.pow(10, digits - 1);
    const max = Math.pow(10, digits) - 1;
    const n = randomInt(min, max);
    if (seen.has(n)) continue;
    seen.add(n);
    const { jp, romaji } = numberToJapanese(n);
    out.push({ jp, romaji, meaning: n.toLocaleString('en-US') });
  }
  return out;
}

function renderRandomDigitSelect() {
  els.randomDigitSelect.innerHTML = '';
  ['2', '3', '4', '5', '6', '7', '8', 'any'].forEach(d => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn muted' + (d === randomDigitOption ? ' active-pill' : '');
    btn.textContent = d === 'any' ? 'Any' : `${d}-digit`;
    btn.addEventListener('click', () => {
      randomDigitOption = d;
      randomNumbersCache = generateRandomNumbers(randomDigitOption, RANDOM_BATCH_SIZE);
      setSelectedSet('counting', 'random', new Set()); // old picks no longer refer to anything real
      renderRandomDigitSelect();
      renderCountingGrid();
    });
    els.randomDigitSelect.appendChild(btn);
  });
}

els.randomRegenerate.addEventListener('click', () => {
  randomNumbersCache = generateRandomNumbers(randomDigitOption, RANDOM_BATCH_SIZE);
  setSelectedSet('counting', 'random', new Set());
  renderCountingGrid();
});

// Counting has several 1-10-ish sequences plus the Random generator — each
// its own flat picker grid, like Words/Kanji.
function renderCountingGrid() {
  const isRandom = ui.countingSub === 'random';
  els.randomControls.hidden = !isRandom;
  if (isRandom && randomNumbersCache.length === 0) {
    randomNumbersCache = generateRandomNumbers(randomDigitOption, RANDOM_BATCH_SIZE);
  }

  const items = allCharsFor('counting', ui.countingSub);
  const selected = getSelectedSet('counting', ui.countingSub);
  els.countingGrid.innerHTML = '';

  items.forEach(c => {
    const tile = document.createElement('button');
    tile.type = 'button';
    const unanswered = !answeredThisSession.has(c.id);
    const wide = isRandom ? ' wide' : '';
    tile.className = 'counting-tile' + wide + (selected.has(c.kana) ? ' selected' : '') + (unanswered ? ' unanswered' : '');
    tile.innerHTML = `
      <span class="kana kanji-char">${c.kana}</span>
      <span class="kanji-meaning">${c.meaning}</span>
      <span class="romaji kanji-reading">${c.romaji}</span>
    `;
    tile.addEventListener('click', () => {
      const cur = getSelectedSet('counting', ui.countingSub);
      if (cur.has(c.kana)) cur.delete(c.kana); else cur.add(c.kana);
      setSelectedSet('counting', ui.countingSub, cur);
      renderCountingGrid();
    });
    els.countingGrid.appendChild(tile);
  });
}

els.countingSelectAll.addEventListener('click', () => {
  setSelectedSet('counting', ui.countingSub, new Set(allCharsFor('counting', ui.countingSub).map(c => c.kana)));
  renderCountingGrid();
});

els.countingSelectNone.addEventListener('click', () => {
  setSelectedSet('counting', ui.countingSub, new Set());
  renderCountingGrid();
});

// Vocab: units of words, like Words but organized into Unit 1/2/3 — reuses
// the word-tile look (a picture where one makes sense, otherwise a plain
// meaning caption, same as Kanji/Counting).
function renderVocabGrid() {
  const items = allCharsFor('vocab', ui.vocabSub);
  const selected = getSelectedSet('vocab', ui.vocabSub);
  els.vocabGrid.innerHTML = '';

  items.forEach(w => {
    const tile = document.createElement('button');
    tile.type = 'button';
    const unanswered = !answeredThisSession.has(w.id);
    tile.className = 'word-tile' + (selected.has(w.kana) ? ' selected' : '') + (unanswered ? ' unanswered' : '');
    const picture = w.emoji
      ? `<img class="word-emoji" src="${emojiImageUrl(w.emoji)}" alt="" loading="lazy" />`
      : `<span class="vocab-meaning">${w.meaning}</span>`;
    tile.innerHTML = `
      ${picture}
      <span class="kana word-jp">${w.kana}</span>
      <span class="romaji word-romaji">${w.romaji}</span>
    `;
    tile.addEventListener('click', () => {
      const cur = getSelectedSet('vocab', ui.vocabSub);
      if (cur.has(w.kana)) cur.delete(w.kana); else cur.add(w.kana);
      setSelectedSet('vocab', ui.vocabSub, cur);
      renderVocabGrid();
    });
    els.vocabGrid.appendChild(tile);
  });

  if (items.length === 0) {
    els.vocabGrid.innerHTML = '<p class="hint">No words in this unit yet.</p>';
  }
}

els.vocabSubTabs.forEach(btn => btn.addEventListener('click', () => {
  ui.vocabSub = btn.dataset.vsub;
  renderTabs();
  renderVocabGrid();
}));

els.vocabSelectAll.addEventListener('click', () => {
  setSelectedSet('vocab', ui.vocabSub, new Set(allCharsFor('vocab', ui.vocabSub).map(c => c.kana)));
  renderVocabGrid();
});

els.vocabSelectNone.addEventListener('click', () => {
  setSelectedSet('vocab', ui.vocabSub, new Set());
  renderVocabGrid();
});

// ---- grammar (reference only — not part of the Study quiz pool) ----
function renderGrammarList() {
  const points = GRAMMAR_DATA[ui.grammarSub] || [];
  els.grammarList.innerHTML = '';

  points.forEach(point => {
    const card = document.createElement('div');
    card.className = 'grammar-card';
    const examplesHtml = point.examples.map(ex => `
      <div class="grammar-example">
        <div class="kana grammar-example-jp">${ex.jp}</div>
        <div class="grammar-example-romaji">${ex.romaji}</div>
        <div class="grammar-example-en">${ex.en}</div>
      </div>
    `).join('');
    card.innerHTML = `
      <div class="grammar-pattern">${point.pattern}</div>
      <div class="grammar-pattern-romaji">${point.romaji}</div>
      <div class="grammar-meaning">${point.meaning}</div>
      <p class="grammar-explanation">${point.explanation}</p>
      <div class="grammar-examples">${examplesHtml}</div>
    `;
    els.grammarList.appendChild(card);
  });

  if (points.length === 0) {
    els.grammarList.innerHTML = '<p class="hint">No grammar points in this unit yet.</p>';
  }
}

els.grammarSubTabs.forEach(btn => btn.addEventListener('click', () => {
  ui.grammarSub = btn.dataset.gsub;
  renderTabs();
  renderGrammarList();
}));

// Quick-select presets (10, 20, 30, … All) so picking a study batch out of 103
// kanji doesn't mean tapping every tile — each preset selects the first N
// kanji in list order, replacing whatever was selected before.
function renderKanjiQuickSelect() {
  const items = allCharsFor('kanji', 'n5');
  const total = items.length;
  const steps = [];
  for (let n = 10; n < total; n += 10) steps.push(n);
  steps.push(total);

  els.kanjiQuickSelect.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'quick-select-label';
  label.textContent = 'Quick select:';
  els.kanjiQuickSelect.appendChild(label);

  steps.forEach(n => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn muted';
    btn.textContent = n === total ? 'All' : String(n);
    btn.title = n === total
      ? `Select all ${total} kanji — double-click to deselect them instead`
      : `Select the first ${n} kanji — double-click to deselect them instead`;

    // A double-click fires click→click→dblclick, so the single-click action is
    // deferred briefly to see if a second click follows; if it does, cancel
    // the select and deselect those first N instead. Avoids a select-then-
    // deselect flash and any flicker in between.
    let clickTimer = null;
    btn.addEventListener('click', () => {
      if (clickTimer) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        setSelectedSet('kanji', 'n5', new Set(items.slice(0, n).map(c => c.kana)));
        renderKanjiGrid();
      }, 250);
    });
    btn.addEventListener('dblclick', () => {
      clearTimeout(clickTimer);
      clickTimer = null;
      const cur = getSelectedSet('kanji', 'n5');
      items.slice(0, n).forEach(c => cur.delete(c.kana));
      setSelectedSet('kanji', 'n5', cur);
      renderKanjiGrid();
    });
    els.kanjiQuickSelect.appendChild(btn);
  });
}

els.kanjiSelectAll.addEventListener('click', () => {
  setSelectedSet('kanji', 'n5', new Set(allCharsFor('kanji', 'n5').map(c => c.kana)));
  renderKanjiGrid();
});

els.kanjiSelectNone.addEventListener('click', () => {
  setSelectedSet('kanji', 'n5', new Set());
  renderKanjiGrid();
});

els.selectAll.addEventListener('click', () => {
  const set = ui.tab === 'katakana' ? 'katakana' : 'hiragana';
  const all = allCharsFor(set, ui.sub).map(c => c.kana);
  setSelectedSet(set, ui.sub, new Set(all));
  renderCharGrid();
});

els.selectNone.addEventListener('click', () => {
  const set = ui.tab === 'katakana' ? 'katakana' : 'hiragana';
  setSelectedSet(set, ui.sub, new Set());
  renderCharGrid();
});

// Universal actions: every section at once (hiragana + katakana, single + double
// + words, plus kanji and counting), available from any tab since they live in
// the top nav rather than a grid.
function refreshCurrentView() {
  renderCharGrid();
  renderKanjiGrid();
  renderCountingGrid();
  renderVocabGrid();
  if (ui.tab === 'study') refreshStudyIntro();
}

els.selectAllUniversal.addEventListener('click', () => {
  SETS.forEach(set => MODES.forEach(mode => {
    setSelectedSet(set, mode, new Set(allCharsFor(set, mode).map(c => c.kana)));
  }));
  setSelectedSet('kanji', 'n5', new Set(allCharsFor('kanji', 'n5').map(c => c.kana)));
  COUNTING_MODES.forEach(mode => {
    setSelectedSet('counting', mode, new Set(allCharsFor('counting', mode).map(c => c.kana)));
  });
  VOCAB_UNITS.forEach(unit => {
    setSelectedSet('vocab', unit, new Set(allCharsFor('vocab', unit).map(c => c.kana)));
  });
  refreshCurrentView();
});

els.clearAllUniversal.addEventListener('click', () => {
  SETS.forEach(set => MODES.forEach(mode => setSelectedSet(set, mode, new Set())));
  setSelectedSet('kanji', 'n5', new Set());
  COUNTING_MODES.forEach(mode => setSelectedSet('counting', mode, new Set()));
  VOCAB_UNITS.forEach(unit => setSelectedSet('vocab', unit, new Set()));
  refreshCurrentView();
});

// ---- study pool: everything selected, across every section ----
function buildStudyPool() {
  const pool = [];
  SETS.forEach(set => {
    MODES.forEach(mode => {
      const selected = getSelectedSet(set, mode);
      allCharsFor(set, mode).forEach(c => {
        if (selected.has(c.kana)) pool.push({ kana: c.kana, romaji: c.romaji, alts: c.alts, emoji: c.emoji, id: c.id, group: `${set}_${mode}` });
      });
    });
  });
  const kanjiSelected = getSelectedSet('kanji', 'n5');
  allCharsFor('kanji', 'n5').forEach(c => {
    if (kanjiSelected.has(c.kana)) pool.push({ kana: c.kana, romaji: c.romaji, alts: c.alts, meaning: c.meaning, id: c.id, group: 'kanji' });
  });
  COUNTING_MODES.forEach(mode => {
    const selected = getSelectedSet('counting', mode);
    allCharsFor('counting', mode).forEach(c => {
      if (selected.has(c.kana)) pool.push({ kana: c.kana, romaji: c.romaji, alts: c.alts, meaning: c.meaning, id: c.id, group: `counting_${mode}` });
    });
  });
  VOCAB_UNITS.forEach(unit => {
    const selected = getSelectedSet('vocab', unit);
    allCharsFor('vocab', unit).forEach(c => {
      if (selected.has(c.kana)) pool.push({ kana: c.kana, romaji: c.romaji, alts: c.alts, emoji: c.emoji, meaning: c.meaning, id: c.id, group: `vocab_${unit}` });
    });
  });
  return pool;
}

function refreshStudyIntro() {
  const pool = buildStudyPool();
  els.studyCount.textContent = `${pool.length} Kana Card${pool.length === 1 ? '' : 's'}`;
  els.startBtn.disabled = pool.length === 0;
  els.studyIntro.hidden = false;
  els.quiz.hidden = true;
  els.summary.hidden = true;
}

// ---- quiz engine ----
// Rules: a card only advances once the correct rōmaji is typed (no reveal, no
// "correct/incorrect" text) — except Enter, which always skips to the next card.
let quiz = null;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextQueueItem() {
  if (quiz.queue.length === 0) {
    quiz.queue = shuffle(quiz.pool);
    quiz.progress = 0; // starting a fresh lap through the deck
    if (quiz.lastKana && quiz.queue.length > 1 && quiz.queue[0].kana === quiz.lastKana) {
      [quiz.queue[0], quiz.queue[1]] = [quiz.queue[1], quiz.queue[0]];
    }
  }
  const item = quiz.queue.shift();
  quiz.lastKana = item.kana;
  return item;
}

els.startBtn.addEventListener('click', startQuiz);
els.stopBtn.addEventListener('click', () => endQuiz(true));
els.backBtn.addEventListener('click', refreshStudyIntro);

// ---- answer mode: type the reading, or pick it from multiple choice ----
const ANSWER_MODE_KEY = 'realkana-clone:answermode';
let answerMode = 'type';
try { answerMode = localStorage.getItem(ANSWER_MODE_KEY) || 'type'; } catch (e) { /* ignore */ }

function setAnswerMode(mode) {
  answerMode = mode;
  try { localStorage.setItem(ANSWER_MODE_KEY, mode); } catch (e) { /* ignore */ }
  els.answerModeToggle.forEach(btn => btn.classList.toggle('active', btn.dataset.answerMode === mode));
}
els.answerModeToggle.forEach(btn => btn.addEventListener('click', () => setAnswerMode(btn.dataset.answerMode)));
setAnswerMode(answerMode);

// Standard edit-distance, used to find MCQ distractors that read/look close to
// the correct answer rather than obviously-wrong unrelated options.
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Picks distractors that look/sound close to the right answer: same section
// first (so options are thematically alike), ranked by how close the spelling
// is, falling back to the rest of the pool only if there aren't enough.
function pickMcqDistractors(item, pool, count) {
  const correctAnswers = new Set([item.romaji, ...(item.alts || [])]);
  const seen = new Set(correctAnswers);
  const byCloseness = (arr) => arr
    .filter(c => c.id !== item.id && !correctAnswers.has(c.romaji))
    .sort((a, b) => levenshtein(a.romaji, item.romaji) - levenshtein(b.romaji, item.romaji));
  const sameGroup = byCloseness(pool.filter(c => c.group === item.group));
  const otherGroup = byCloseness(pool.filter(c => c.group !== item.group));
  const picked = [];
  for (const c of [...sameGroup, ...otherGroup]) {
    if (seen.has(c.romaji)) continue;
    seen.add(c.romaji);
    picked.push(c.romaji);
    if (picked.length >= count) break;
  }
  return picked;
}

// Renders the multiple-choice buttons for the current card. Clicking one just
// "types" that text into the (hidden) answer input and fires the same input
// event typing would — reusing the exact same match/advance/no-feedback logic
// with no duplicated code path.
function renderMcqOptions(item) {
  const distractors = pickMcqDistractors(item, quiz.pool, 3);
  const options = shuffle([item.romaji, ...distractors]);
  els.mcqOptions.innerHTML = '';
  options.forEach(romaji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mcq-option';
    btn.textContent = romaji;
    btn.addEventListener('click', () => {
      if (!quiz || !quiz.current || quiz.advancing) return;
      els.answerInput.value = romaji;
      els.answerInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    els.mcqOptions.appendChild(btn);
  });
}

function startQuiz() {
  const pool = buildStudyPool();
  if (pool.length === 0) return;
  quiz = {
    pool, queue: [], current: null, correct: 0, incorrect: 0, progress: 0, lastKana: null, advancing: false,
    covered: { kana: false, meaning: false }, // persists across cards for the rest of this session
  };
  els.studyIntro.hidden = true;
  els.summary.hidden = true;
  els.quiz.hidden = false;
  showNextCharacter();
  updateStats();
  els.answerInput.disabled = false;
  els.answerInput.focus();
}

function showNextCharacter() {
  quiz.current = nextQueueItem();
  quiz.revealed = false;
  const item = quiz.current;

  const altsHtml = item.alts && item.alts.length
    ? `<div class="reveal-alts">also: ${item.alts.join(', ')}</div>`
    : '';

  els.charDisplay.className = 'flip-card'; // also clears a leftover "flipped" from the previous card

  // Word items only ever carry an emoji; Vocab items can carry both an emoji
  // and its English meaning — show both when both are present.
  let picture = '';
  if (item.emoji) picture += `<img class="quiz-emoji" src="${emojiImageUrl(item.emoji)}" alt="" />`;
  if (item.meaning) picture += peekWrap(`<span class="quiz-meaning">${item.meaning}</span>`, 'meaning');

  els.charDisplay.innerHTML = `
    <div class="flip-inner">
      <div class="flip-front">${picture}${peekWrap(`<span class="kana quiz-word">${item.kana}</span>`, 'kana', true)}</div>
      <div class="flip-back">
        <span class="reveal-answer">${item.romaji}</span>
        ${altsHtml}
      </div>
    </div>
  `;
  wireStudyCovers();
  els.answerInput.value = '';

  // MCQ: build the option buttons and hide the text input (kept focusable
  // off-screen so Space/Enter keep working exactly as they do in Type mode).
  const isMcq = answerMode === 'mcq';
  els.answerInput.classList.toggle('visually-hidden', isMcq);
  els.mcqOptions.hidden = !isMcq;
  if (isMcq) renderMcqOptions(item);
}

// Space flips the card over to reveal the answer, like a physical flashcard;
// pressing it again flips back. Doesn't affect typing or the retry logic at all.
function toggleReveal() {
  if (!quiz || !quiz.current) return;
  quiz.revealed = !quiz.revealed;
  els.charDisplay.classList.toggle('flipped', quiz.revealed);
}

// Real third-party pronunciation recordings would mean scraping/rehosting
// copyrighted audio from dictionary sites — not something to do. This uses
// the browser's own speech synthesis instead: no audio files to manage, and
// it prefers a better-sounding voice (Chrome's "Google 日本語", or an OS
// "Enhanced/Premium/Neural" voice) over whatever generic default the browser
// would otherwise pick.
function speakJapanese(text) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    window.speechSynthesis.cancel(); // don't let repeats queue up / overlap
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ja-JP';
    const jaVoices = window.speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('ja'));
    const best = jaVoices.find(v => /google/i.test(v.name))
      || jaVoices.find(v => /enhanced|premium|neural/i.test(v.name))
      || jaVoices[0];
    if (best) utter.voice = best;
    utter.rate = 0.9; // a touch slower than natural speed, for learners
    window.speechSynthesis.speak(utter);
  } catch (e) {
    // Audio is a nice-to-have; a synthesis failure must never break the quiz itself.
  }
}

function speakCurrent() {
  if (quiz && quiz.current) speakJapanese(quiz.current.kana);
}

if (els.playAudioBtn) {
  els.playAudioBtn.addEventListener('click', speakCurrent);
}

function acceptedAnswers(item) { return [item.romaji, ...item.alts]; }
function isExactMatch(value, item) {
  const v = value.toLowerCase();
  return acceptedAnswers(item).includes(v);
}

function advanceToNext() {
  quiz.progress++;
  showNextCharacter();
  updateStats();
}

// A correct match holds briefly on screen (so the last letter you typed is
// actually visible) before moving on; a skip via Enter moves on right away.
const ADVANCE_DELAY_MS = 350;

els.answerInput.addEventListener('input', () => {
  if (!quiz || !quiz.current || quiz.advancing) return;
  // No feedback of any kind for a wrong answer — the card simply doesn't move on
  // until the typed value exactly matches. Anything else is left alone so the
  // person can freely keep typing, backspacing, or trying again.
  if (isExactMatch(els.answerInput.value, quiz.current)) {
    quiz.correct++;
    answeredThisSession.add(quiz.current.id);
    quiz.advancing = true;
    setTimeout(() => {
      quiz.advancing = false;
      advanceToNext();
      els.answerInput.focus();
    }, ADVANCE_DELAY_MS);
  }
});

els.answerInput.addEventListener('keydown', (e) => {
  if (!quiz || !quiz.current) return;
  if (e.key === ' ') {
    e.preventDefault(); // don't let a literal space land in the input
    toggleReveal();
    return;
  }
  if (e.key !== 'Enter' || quiz.advancing) return;
  e.preventDefault();
  quiz.incorrect++; // skipped without a correct answer
  advanceToNext();
});

// Shift+V works no matter what's focused (the speaker button, a peeked card,
// an MCQ option) — not just while the answer input itself has focus.
document.addEventListener('keydown', (e) => {
  if (!quiz || !quiz.current) return;
  if (e.key.toLowerCase() === 'v' && e.shiftKey) {
    e.preventDefault();
    speakCurrent();
  }
});

// Progress cycles: once every selected card has been seen this lap, nextQueueItem()
// reshuffles a fresh lap and resets progress back to 0, so it just loops indefinitely.
function updateStats() {
  els.statProgress.textContent = `${quiz.progress} / ${quiz.pool.length}`;
}

function endQuiz(showSummary) {
  const finished = quiz;
  quiz = null;
  els.quiz.hidden = true;
  if (showSummary && finished) {
    const total = finished.correct + finished.incorrect;
    const accuracy = total === 0 ? 100 : Math.round((finished.correct / total) * 100);
    els.summaryText.textContent = `${finished.correct} correct / ${total} attempted (${accuracy}% accuracy)`;
    els.summary.hidden = false;
  } else {
    els.studyIntro.hidden = false;
  }
}

// ---- decorative background watermark: faint Japanese words scattered in the
// page's whitespace margins (sits behind the opaque card, see .watermark z-index) ----
const WATERMARK_WORDS = [
  'あ', 'ア', 'かな', '漢字', '日本語', '練習', '勉強',
  '言葉', '文字', 'ひらがな', 'カタカナ', '学ぶ', '単語', '頑張って',
];

function buildWatermark() {
  const layer = document.createElement('div');
  layer.className = 'watermark';
  layer.setAttribute('aria-hidden', 'true');

  // Jittered grid instead of pure random placement: each word gets its own cell
  // so words can't land on top of each other and stay evenly spread out.
  const cols = 4;
  const rows = Math.ceil(WATERMARK_WORDS.length / cols);
  const cellW = 100 / cols;
  const cellH = 100 / rows;

  shuffle(WATERMARK_WORDS).forEach((word, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jitterX = (Math.random() - 0.5) * cellW * 0.5;
    const jitterY = (Math.random() - 0.5) * cellH * 0.5;
    const top = row * cellH + cellH / 2 + jitterY;
    const left = col * cellW + cellW / 2 + jitterX;

    // Longer words render smaller so every word occupies a similar footprint
    // within its cell, instead of long words spilling into neighboring cells.
    const len = [...word].length;
    const size = Math.max(1.7, 5 - len * 0.65);

    const span = document.createElement('span');
    span.textContent = word;
    span.style.top = `${top}%`;
    span.style.left = `${left}%`;
    span.style.fontSize = `${size}rem`;
    span.style.transform = `translate(-50%, -50%) rotate(${-10 + Math.random() * 20}deg)`;
    layer.appendChild(span);
  });
  document.body.insertBefore(layer, document.body.firstChild);
}

// ---- init ----
renderTabs();
renderCharGrid();
renderKanjiQuickSelect();
renderRandomDigitSelect();
renderCountingGrid();
renderVocabGrid();
renderGrammarList();
buildWatermark();
