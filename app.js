(() => {
  'use strict';
  const SAVE_KEY = 'birdoku-state-v1';
  const USED_KEY = 'birdoku-used-starters-v1';
  // The first eleven colors retain the original palette, expanded for variable-sized boards.
  // Fixed, gentle rainbow based on the original game’s silhouette progression:
  // rose → blush → peach → gold → green → teal → blue → lilac → pink.
  // Keep the same order across puzzles rather than shuffling the palette.
  const COLORS = [
    '#ec9db5', '#f4bccf', '#efb2ac', '#f5c4a4',
    '#edda91', '#c4dda4', '#a1d4c3', '#87c9d0',
    '#a8d5ed', '#aec3e7', '#c2b0df', '#dcadd2'
  ];
  const MIN_SIZE = 8, MAX_SIZE = 12;
  const randomSize = () => MIN_SIZE + Math.floor(Math.random() * (MAX_SIZE - MIN_SIZE + 1));
  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const dialog = $('win-dialog');
  const message = $('message');
  const cached = Object.fromEntries(Array.from({length: MAX_SIZE - MIN_SIZE + 1}, (_, i) => [i + MIN_SIZE, []]));
  const pending = new Set();
  let worker = null;
  let workerBusy = false;
  let nextId = 0;
  let state = null;
  let messageTimeout = null;
  let hintIndex = -1;
  let usedStarters = {8: [], 10: []};
  let swipe = null;

  try {
    const old = JSON.parse(localStorage.getItem(USED_KEY));
    if (old && typeof old === 'object') usedStarters = {...usedStarters, ...old};
  } catch (_) { /* storage may be disabled */ }

  // The black bird silhouette is based on the supplied bird-emoji reference.
  const birdSVG = `<svg viewBox="-7 -7 253 214" xmlns="http://www.w3.org/2000/svg" class="bird-drawing" aria-hidden="true"><path class="bird-shape" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M 46 1 L 30 8 L 17 21 L 11 38 L 11 47 L 13 49 L 3 58 L 0 65 L 7 70 L 19 71 L 17 74 L 20 81 L 24 110 L 32 131 L 54 149 L 64 154 L 83 157 L 83 167 L 81 170 L 63 175 L 60 178 L 61 184 L 76 184 L 88 180 L 93 175 L 95 168 L 94 158 L 91 157 L 110 156 L 110 175 L 90 194 L 92 199 L 98 199 L 112 190 L 122 180 L 123 166 L 121 153 L 143 153 L 151 149 L 161 139 L 169 137 L 176 128 L 183 124 L 182 114 L 172 108 L 211 81 L 227 73 L 238 63 L 238 59 L 230 50 L 218 43 L 199 36 L 172 32 L 166 33 L 149 56 L 142 63 L 135 65 L 124 60 L 116 52 L 104 27 L 86 8 L 67 0 Z"/><ellipse class="bird-eye" cx="55" cy="47" rx="5.3" ry="6.2" fill="#fff5e8"/></svg>`;
  // The same silhouette is reused for color-region progress markers.

  function tell(text, duration = 3500) {
    message.textContent = text;
    if (messageTimeout) clearTimeout(messageTimeout);
    if (duration) messageTimeout = setTimeout(() => { message.textContent = 'One bird in every row, column, and color.'; }, duration);
  }

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
    catch (_) { tell('Your browser is not allowing saved progress.'); }
  }

  function validState(s) {
    return s && Number.isInteger(s.size) && // Preserve progress on older boards, while new boards stay 8–12.
      s.size >= 6 && s.size <= 20 &&
      Array.isArray(s.regions) && s.regions.length === s.size * s.size &&
      Array.isArray(s.marks) && s.marks.length === s.size * s.size &&
      Array.isArray(s.solution) && s.solution.length === s.size &&
      Array.isArray(s.givens) && s.givens.length === s.size * s.size;
  }

  function render() {
    if (!state) return;
    const n = state.size;
    const palette = n > 12 && Array.isArray(state.palette) ? state.palette : COLORS;
    board.style.setProperty('--n', String(n));
    board.dataset.size = String(n);
    board.setAttribute('aria-label', `${n} by ${n} bird puzzle`);
    let html = '';
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n), c = i % n;
      const mark = state.marks[i];
      const classes = ['cell'];
      if (hintIndex === i) classes.push('is-hinted');
      const glyph = mark === 'bird' ? birdSVG : mark === 'x' ? '<span class="cross">×</span>' : '';
      const label = `${mark === 'bird' ? 'Bird' : mark === 'x' ? 'Eliminated' : 'Empty'}, row ${r + 1}, column ${c + 1}${mark === 'bird' ? ', tap to clear' : mark === 'x' ? ', tap to try a bird' : ', tap to mark X'}`;
      html += `<button class="${classes.join(' ')}" data-i="${i}" type="button" style="--cell-color:${palette[state.regions[i]] || COLORS[state.regions[i] % COLORS.length]}" aria-label="${label}">${glyph}</button>`;
    }
    board.innerHTML = html;
    const progress = $('progress');
    const placedColors = new Set();
    for (let i = 0; i < state.marks.length; i++) {
      if (state.marks[i] === 'bird') placedColors.add(state.regions[i]);
    }
    progress.style.setProperty('--progress-count', String(n));
    progress.setAttribute('aria-label', `${placedColors.size} of ${n} bird colors completed`);
    // Order the same colors as the board into a warm-to-cool rainbow strip.
    const rainbowOrder = Array.from({length: n}, (_, i) => i);
    progress.innerHTML = rainbowOrder.map(region => {
      const found = placedColors.has(region);
      const color = palette[region] || COLORS[region % COLORS.length];
      return `<span class="rainbow-bird${found ? ' is-found' : ''}" style="--bird-color:${color}" title="${found ? 'Bird placed' : 'Bird to find'}">${birdSVG}</span>`;
    }).join('');
    $('undo').disabled = !state.history || state.history.length === 0;
  }

  function pushUndo() {
    state.history ||= [];
    state.history.push({marks: [...state.marks], completed: !!state.completed});
    if (state.history.length > 60) state.history.shift();
  }

  function errorAt(index, text) {
    tell(`💡 ${text}`, 3800);
    const cell = board.querySelector(`[data-i="${index}"]`);
    if (cell) {
      cell.classList.remove('is-error');
      void cell.offsetWidth;
      cell.classList.add('is-error');
      setTimeout(() => cell.classList.remove('is-error'), 550);
    }
  }

  function winIfComplete() {
    const n = state.size;
    const solved = state.solution.every((c, r) => state.marks[r * n + c] === 'bird');
    if (solved && !state.completed) {
      state.completed = true;
      dialog.classList.remove('hidden');
      tell('All the birds are home! ✨', 0);
    }
  }

  function applyMark(index, value, fromHint = false, tentativeCross = false) {
    if (state.givens[index]) return;
    if (state.completed) { tell('Puzzle finished — start a new one or undo.'); return; }
    const correctPosition = state.solution[Math.floor(index / state.size)] === index % state.size;
    if (value === 'bird' && !correctPosition) {
      errorAt(index, 'Not quite. Try eliminating a few more squares first.');
      return;
    }
    if (value === 'x' && correctPosition && !tentativeCross) {
      errorAt(index, 'Keep this square in play for now.');
      return;
    }
    const next = state.marks[index] === value && !fromHint ? '' : value;
    if (next === state.marks[index]) return;
    pushUndo();
    state.marks[index] = next;
    hintIndex = fromHint ? index : -1;
    winIfComplete();
    save();
    render();
    if (hintIndex !== -1) setTimeout(() => {
      hintIndex = -1;
      const cell = board.querySelector(`[data-i="${index}"]`);
      if (cell) cell.classList.remove('is-hinted');
    }, 1600);
  }

  function giveHint() {
    if (state.completed) { tell('You already solved it!'); return; }
    const n = state.size;
    const candidates = [];
    for (let i = 0; i < n * n; i++) {
      if (state.marks[i]) continue;
      if (state.solution[Math.floor(i / n)] === i % n) continue;
      const r = Math.floor(i / n), c = i % n, region = state.regions[i];
      let explained = false;
      for (let j = 0; j < n * n; j++) {
        if (state.marks[j] !== 'bird') continue;
        const rr = Math.floor(j / n), cc = j % n;
        if (r === rr || c === cc || region === state.regions[j] ||
            (Math.abs(r - rr) <= 1 && Math.abs(c - cc) <= 1)) {
          explained = true;
          break;
        }
      }
      if (explained) candidates.push(i);
    }
    if (candidates.length) {
      const i = candidates[Math.floor(Math.random() * candidates.length)];
      applyMark(i, 'x', true);
      tell('That square cannot hold a bird because of a bird you placed.');
      return;
    }
    // If every other space in a row is crossed out, the last cell must be the bird.
    for (let r = 0; r < n; r++) {
      const open = [];
      for (let c = 0; c < n; c++) if (state.marks[r * n + c] === '') open.push(r * n + c);
      if (open.length === 1 && state.solution[r] === open[0] % n) {
        applyMark(open[0], 'bird', true);
        tell('Only one spot is left in that row!');
        return;
      }
    }
    const otherSpaces = [];
    for (let i = 0; i < n * n; i++) {
      if (!state.marks[i] && state.solution[Math.floor(i / n)] !== i % n) otherSpaces.push(i);
    }
    if (otherSpaces.length) {
      applyMark(otherSpaces[Math.floor(Math.random() * otherSpaces.length)], 'x', true);
      tell('A little hint: this square can safely be eliminated.');
      return;
    }
    const birdsLeft = state.solution.map((c, r) => r * n + c).filter(i => state.marks[i] !== 'bird');
    if (birdsLeft.length) {
      applyMark(birdsLeft[0], 'bird', true);
      tell("Here's a bird to help you along!");
    }
  }

  function freshPuzzle(size, preset) {
    // Every new puzzle starts with an entirely blank board: no prefilled Xs.
    const p = BirdokuGen.transform(preset);
    const marks = Array(size * size).fill('');
    const givens = Array(size * size).fill('');
    const number = (state?.number || 0) + 1;
    const palette = [...COLORS];
    state = {size, regions: p.regions, solution: p.solution, palette: palette.slice(0, size),
      givens, marks, number, completed: false, history: []};
    hintIndex = -1;
    dialog.classList.add('hidden');
    save();
    render();
    tell(`Find ${size} birds!`);
  }

  function starterFor(size) {
    const seedSize = size <= 9 ? 8 : 10;
    const seed = takeStarter(seedSize);
    return size === seedSize ? seed : BirdokuGen.expand(seed, size);
  }

  function takeStarter(size) {
    const collection = window.BIRDOKU_STARTERS[size];
    let used = usedStarters[size] || [];
    if (used.length >= collection.length) used = [];
    const options = Array.from({length: collection.length}, (_, i) => i).filter(i => !used.includes(i));
    const chosen = options[Math.floor(Math.random() * options.length)];
    used.push(chosen);
    usedStarters[size] = used;
    try { localStorage.setItem(USED_KEY, JSON.stringify(usedStarters)); } catch (_) {}
    return collection[chosen];
  }

  function prefetch(size) {
    if (!worker || cached[size].length || pending.has(size)) return;
    pending.add(size);
    if (!workerBusy) runNextRequest();
  }

  function runNextRequest() {
    if (!worker || workerBusy) return;
    const size = pending.values().next().value;
    if (!size) return;
    pending.delete(size);
    workerBusy = true;
    const seedSize = size <= 9 ? 8 : 10;
    worker.postMessage({size, id: ++nextId, seed: takeStarter(seedSize)});
  }

  function newPuzzle() {
    const size = randomSize();
    const generated = cached[size].shift();
    freshPuzzle(size, generated || starterFor(size));
    prefetch(size);
  }

  function startBackgroundGenerator() {
    if (typeof Worker === 'undefined') return;
    try {
      worker = new Worker(window.BIRDOKU_WORKER_URL || './worker.js');
      worker.addEventListener('message', (event) => {
        workerBusy = false;
        const {size, puzzle} = event.data;
        if (puzzle && BirdokuGen.validPuzzle(puzzle)) cached[size].push(puzzle);
        runNextRequest();
      });
      worker.addEventListener('error', () => { workerBusy = false; worker.terminate(); worker = null; });
      prefetch(state.size);
    } catch (_) { worker = null; }
  }

  // Each tap advances the cell: empty → X → bird → empty.
  // The first X is tentative, even on the bird's square, because the next
  // tap must always be able to place a bird there. Swipes stay X-only.
  function tapCell(index) {
    if (state.givens[index] || state.completed) return;
    const mark = state.marks[index];
    if (mark === '') applyMark(index, 'x', false, true);
    else if (mark === 'x') applyMark(index, 'bird');
    else applyMark(index, '');
  }

  function cellAtPoint(x, y) {
    const rect = board.getBoundingClientRect();
    if (x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) return -1;
    const n = state.size;
    const col = Math.min(n - 1, Math.floor((x - rect.left) / rect.width * n));
    const row = Math.min(n - 1, Math.floor((y - rect.top) / rect.height * n));
    return row * n + col;
  }

  function paintCross(index) {
    if (index < 0 || swipe.visited.has(index)) return;
    swipe.visited.add(index);
    if (state.completed || state.givens[index] || state.marks[index]) return;
    if (state.solution[Math.floor(index / state.size)] === index % state.size) {
      if (!swipe.warned) {
        errorAt(index, 'There should be a bird in this square.');
        swipe.warned = true;
      }
      return;
    }
    if (!swipe.changed) pushUndo();
    swipe.changed = true;
    state.marks[index] = 'x';
    const cell = board.querySelector(`[data-i="${index}"]`);
    if (cell) {
      cell.innerHTML = '<span class="cross">×</span>';
      cell.setAttribute('aria-label', `Eliminated, row ${Math.floor(index / state.size) + 1}, column ${index % state.size + 1}`);
    }
  }

  function paintBetween(x1, y1, x2, y2) {
    // Sample the pointer path so a fast swipe doesn't leave gaps between cells.
    const rect = board.getBoundingClientRect();
    const spacing = Math.max(3, Math.min(rect.width, rect.height) / state.size / 3);
    const samples = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / spacing));
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      paintCross(cellAtPoint(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t));
    }
  }

  board.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || swipe) return;
    const cell = event.target.closest('.cell');
    if (!cell) return;
    event.preventDefault();
    swipe = {id: event.pointerId, start: Number(cell.dataset.i), x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY,
      active: false, changed: false, warned: false, visited: new Set()};
    board.setPointerCapture(event.pointerId);
  });

  board.addEventListener('pointermove', event => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const next = cellAtPoint(event.clientX, event.clientY);
    if (!swipe.active && next !== -1 && next !== swipe.start &&
        Math.hypot(event.clientX - swipe.startX, event.clientY - swipe.startY) > 6) {
      swipe.active = true;
    }
    if (swipe.active) paintBetween(swipe.x, swipe.y, event.clientX, event.clientY);
    swipe.x = event.clientX;
    swipe.y = event.clientY;
  });

  function finishSwipe(event, canceled = false) {
    if (!swipe || event.pointerId !== swipe.id) return;
    const previous = swipe;
    if (swipe.active && !canceled) paintBetween(swipe.x, swipe.y, event.clientX, event.clientY);
    swipe = null;
    if (board.hasPointerCapture(event.pointerId)) board.releasePointerCapture(event.pointerId);
    if (previous.changed) {
      save();
      render();
    } else if (!previous.active && !canceled) {
      tapCell(previous.start);
    }
  }
  board.addEventListener('pointerup', event => finishSwipe(event));
  board.addEventListener('pointercancel', event => finishSwipe(event, true));
  // Keep keyboard-accessible buttons working; pointer taps are handled above.
  board.addEventListener('click', event => {
    if (event.detail !== 0) return;
    const cell = event.target.closest('.cell');
    if (cell) tapCell(Number(cell.dataset.i));
  });
  $('new-puzzle').addEventListener('click', newPuzzle);
  $('hint').addEventListener('click', giveHint);
  $('undo').addEventListener('click', () => {
    if (!state.history?.length) return;
    const previous = state.history.pop();
    state.marks = previous.marks;
    state.completed = previous.completed;
    hintIndex = -1;
    dialog.classList.add('hidden');
    tell('Last move undone.');
    save();
    render();
  });
  $('restart').addEventListener('click', () => {
    state.history = [];
    state.marks = Array(state.size * state.size).fill('');
    state.completed = false;
    hintIndex = -1;
    dialog.classList.add('hidden');
    tell('Fresh start, same puzzle.');
    save();
    render();
  });
  $('play-again').addEventListener('click', newPuzzle);
  $('close-dialog').addEventListener('click', () => dialog.classList.add('hidden'));

  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (validState(saved)) state = saved;
  } catch (_) {}
  if (state) {
    // Older releases put permanent crosses on Easy / Medium boards. Clear
    // only those original clues when upgrading, leaving user-made moves alone.
    if (state.givens.some(mark => mark === 'x')) {
      state.marks = state.marks.map((mark, i) => state.givens[i] === 'x' ? '' : mark);
      state.givens = Array(state.size * state.size).fill('');
      state.history = [];
      save();
    }
    render();
    tell(state.completed ? 'Beautifully solved! Start another puzzle any time.' : 'Welcome back! Your puzzle was saved.');
  } else newPuzzle();
  startBackgroundGenerator();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
