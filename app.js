(() => {
  'use strict';
  const SAVE_KEY = 'birdoku-state-v1';
  const USED_KEY = 'birdoku-used-starters-v1';
  // Fixed pastel rainbow: keep region order and distinct warm yellow, lime, and green.
  const COLORS = [
    '#e8a6bc', '#e8b096', '#f0c28f', '#e5c76f',
    '#a9d18c', '#79b97d', '#69c3c9', '#8fc7e2',
    '#a9b9e4', '#c7b0e4'
  ];
  const MIN_SIZE = 8, MAX_SIZE = 10;
  const randomSize = () => MIN_SIZE + Math.floor(Math.random() * (MAX_SIZE - MIN_SIZE + 1));
  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const dialog = $('win-dialog');
  const lossDialog = $('loss-dialog');
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
  let lastTap = null;
  let lastPointerTapAt = 0;
  const DOUBLE_TAP_MS = 340;
  const pendingWrongCrosses = new Map();

  try {
    const old = JSON.parse(localStorage.getItem(USED_KEY));
    if (old && typeof old === 'object') usedStarters = {...usedStarters, ...old};
  } catch (_) { /* storage may be disabled */ }

  // The brown bird silhouette is based on the supplied bird-emoji reference.
  const birdSVG = `<svg viewBox="-7 -7 253 214" xmlns="http://www.w3.org/2000/svg" class="bird-drawing" aria-hidden="true"><path class="bird-shape" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M 46 1 L 30 8 L 17 21 L 11 38 L 11 47 L 13 49 L 3 58 L 0 65 L 7 70 L 19 71 L 17 74 L 20 81 L 24 110 L 32 131 L 54 149 L 64 154 L 83 157 L 83 167 L 81 170 L 63 175 L 60 178 L 61 184 L 76 184 L 88 180 L 93 175 L 95 168 L 94 158 L 91 157 L 110 156 L 110 175 L 90 194 L 92 199 L 98 199 L 112 190 L 122 180 L 123 166 L 121 153 L 143 153 L 151 149 L 161 139 L 169 137 L 176 128 L 183 124 L 182 114 L 172 108 L 211 81 L 227 73 L 238 63 L 238 59 L 230 50 L 218 43 L 199 36 L 172 32 L 166 33 L 149 56 L 142 63 L 135 65 L 124 60 L 116 52 L 104 27 L 86 8 L 67 0 Z"/><ellipse class="bird-eye" cx="55" cy="47" rx="5.3" ry="6.2" fill="#fff5e8"/></svg>`;
  // The same silhouette is reused for color-region progress markers.


  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean;
    const num = parseInt(full, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h, s, l };
  }

  function hslToHex(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function emphasizeColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    return hslToHex(h, clamp(s + 0.055, 0, 1), clamp(l - 0.018, 0, 1));
  }

  function tell(text, duration = 3500) {
    message.textContent = text;
    if (messageTimeout) clearTimeout(messageTimeout);
    if (duration) messageTimeout = setTimeout(() => { message.textContent = ''; }, duration);
  }

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
    catch (_) { tell('Your browser is not allowing saved progress.'); }
  }

  function validState(s) {
    return s && Number.isInteger(s.size) && // Preserve progress on older boards, while new boards stay 8–10.
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
      if (mark === 'x') classes.push('is-cross');
      if (mark === 'bird') classes.push('is-bird');
      if (mark === 'mistake') classes.push('is-mistake');
      if (hintIndex === i) classes.push('is-hinted');
      const glyph = mark === 'bird' ? birdSVG : mark === 'x' ? '<span class="cross">×</span>' : mark === 'mistake' ? '<span class="cross cross-error">×</span>' : '';
      const label = `${mark === 'bird' ? 'Bird' : mark === 'mistake' ? 'Mistake' : mark === 'x' ? 'Eliminated' : 'Empty'}, row ${r + 1}, column ${c + 1}${mark === 'bird' ? ', tap to clear' : mark === 'x' || mark === 'mistake' ? ', tap to remove X, double tap for a bird' : ', tap to mark X, double tap for a bird'}`;
      const baseColor = palette[state.regions[i]] || COLORS[state.regions[i] % COLORS.length];
      const foundColor = emphasizeColor(baseColor);
      html += `<button class="${classes.join(' ')}" data-i="${i}" type="button" style="--cell-color:${baseColor};--cell-found-color:${foundColor}" aria-label="${label}">${glyph}</button>`;
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
      return `<span class="rainbow-bird${found ? ' is-found' : ''}" style="--bird-color:${color}" title="${found ? 'Bird placed' : 'Bird to find'}">${birdSVG}${found ? '<span class=\"progress-dot\" aria-hidden=\"true\"></span>' : ''}</span>`;
    }).join('');
    const mistakes = state.mistakes || 0;
    const limit = state.mistakeLimit || 5;
    const meter = $('mistake-meter');
    meter.textContent = `Mistakes ${mistakes} / ${limit}`;
    meter.setAttribute('aria-label', `${mistakes} mistakes made, ${limit} allowed`);
    meter.classList.toggle('at-limit', mistakes >= limit);
    $('undo').disabled = !!state.gameOver || !state.history || state.history.length === 0;
    $('hint').disabled = !!state.gameOver || !!state.completed;
    $('restart').disabled = !!state.gameOver;
  }

  function pushUndo() {
    state.history ||= [];
    state.history.push({marks: [...state.marks], completed: !!state.completed});
    if (state.history.length > 60) state.history.shift();
  }

  function solutionCell(index) {
    return state.solution[Math.floor(index / state.size)] === index % state.size;
  }

  function cancelPendingWrongCross(index) {
    const timer = pendingWrongCrosses.get(index);
    if (timer !== undefined) clearTimeout(timer);
    pendingWrongCrosses.delete(index);
  }

  function clearPendingWrongCrosses() {
    for (const timer of pendingWrongCrosses.values()) clearTimeout(timer);
    pendingWrongCrosses.clear();
  }

  function wrongMove(index, explanation, shareUndo = false) {
    if (state.completed || state.gameOver) return;
    cancelPendingWrongCross(index);
    if (!shareUndo) pushUndo();
    state.marks[index] = 'mistake';
    state.mistakes = (state.mistakes || 0) + 1;
    if (state.mistakes >= state.mistakeLimit) {
      state.gameOver = true;
      clearPendingWrongCrosses();
      lossDialog.classList.remove('hidden');
      tell('Game over — try the puzzle again or start a new one.', 0);
    } else {
      const left = state.mistakeLimit - state.mistakes;
      tell(`That was a mistake. ${left} ${left === 1 ? 'mistake' : 'mistakes'} remaining.`, 3200);
    }
    save();
    render();
  }

  function scheduleWrongCross(index) {
    // The first tap must remain available for a valid second tap to place a bird.
    // Only commit the mistaken X after the double-tap window has passed.
    cancelPendingWrongCross(index);
    const puzzle = state;
    pendingWrongCrosses.set(index, setTimeout(() => {
      pendingWrongCrosses.delete(index);
      if (state === puzzle && !state.completed && !state.gameOver &&
          state.marks[index] === 'x' && solutionCell(index)) {
        wrongMove(index, 'That square needs a bird.');
      }
    }, DOUBLE_TAP_MS + 40));
  }

  function winIfComplete() {
    const n = state.size;
    const solved = state.solution.every((c, r) => state.marks[r * n + c] === 'bird');
    if (solved && !state.completed && !state.gameOver) {
      clearPendingWrongCrosses();
      // Finish the entire grid, even when the player solved it before crossing every square.
      for (let i = 0; i < n * n; i++) {
        if (state.marks[i] !== 'bird') state.marks[i] = 'x';
      }
      state.completed = true;
      dialog.classList.remove('hidden');
      tell('All the birds are home! ✨', 0);
    }
  }

  function applyMark(index, value, fromHint = false, tentativeCross = false) {
    if (state.givens[index] || state.completed || state.gameOver) return;
    const correctPosition = solutionCell(index);
    if (value === 'bird' && !correctPosition) {
      wrongMove(index, 'That square cannot hold a bird.');
      return;
    }
    if (value === 'x' && correctPosition && !tentativeCross) {
      wrongMove(index, 'That square needs a bird.');
      return;
    }
    const next = state.marks[index] === value && !fromHint ? '' : value;
    if (next === state.marks[index]) return;
    cancelPendingWrongCross(index);
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
    if (state.completed || state.gameOver) return;
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
    clearPendingWrongCrosses();
    const p = BirdokuGen.transform(preset);
    const marks = Array(size * size).fill('');
    const givens = Array(size * size).fill('');
    const number = (state?.number || 0) + 1;
    const palette = [...COLORS];
    state = {size, regions: p.regions, solution: p.solution, palette: palette.slice(0, size),
      givens, marks, number, completed: false, gameOver: false, mistakes: 0,
      mistakeLimit: Math.random() < .5 ? 3 : 5, history: []};
    hintIndex = -1;
    dialog.classList.add('hidden');
    lossDialog.classList.add('hidden');
    save();
    render();
    tell('', 0);
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
      if (state.size >= MIN_SIZE && state.size <= MAX_SIZE) prefetch(state.size);
    } catch (_) { worker = null; }
  }

  // A single tap toggles an X on/off. A *quick* second tap on the
  // same square places a bird. Swiping still only adds Xs.
  function tapCell(index) {
    if (state.givens[index] || state.completed || state.gameOver) return;
    const mark = state.marks[index];
    const now = Date.now();
    const isDoubleTap = lastTap && lastTap.index === index &&
      now - lastTap.time <= DOUBLE_TAP_MS;
    lastTap = null;

    if (isDoubleTap) {
      cancelPendingWrongCross(index);
      // The first tap has already toggled X. Treat the two taps as one
      // undoable bird-placement action, rather than making Undo visit X.
      const solutionCell = state.solution[Math.floor(index / state.size)] === index % state.size;
      if (!solutionCell) {
        wrongMove(index, 'This square cannot hold a bird.');
        return;
      }
      const historyLength = state.history?.length || 0;
      applyMark(index, 'bird');
      if (state.history?.length === historyLength + 1 && historyLength > 0) {
        state.history.pop();
        save();
        render();
      }
      return;
    }

    // Tapping an existing bird clears it. Tapping an X removes it.
    if (mark === 'bird' || mark === 'x' || mark === 'mistake') {
      cancelPendingWrongCross(index);
      applyMark(index, '');
    } else {
      applyMark(index, 'x', false, true);
      if (solutionCell(index)) scheduleWrongCross(index);
    }
    if (mark !== 'bird') lastTap = {index, time: now};
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
    if (state.completed || state.gameOver || state.givens[index] || state.marks[index]) return;
    if (solutionCell(index)) {
      if (!swipe.warned) {
        swipe.warned = true;
        const alreadySavedUndo = swipe.changed;
        swipe.changed = true;
        wrongMove(index, 'That square needs a bird.', alreadySavedUndo);
      }
      return;
    }
    if (!swipe.changed) pushUndo();
    swipe.changed = true;
    state.marks[index] = 'x';
    const cell = board.querySelector(`[data-i="${index}"]`);
    if (cell) {
      cell.classList.add('is-cross');
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
      lastTap = null;
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
      lastPointerTapAt = Date.now();
      tapCell(previous.start);
    }
  }
  board.addEventListener('pointerup', event => finishSwipe(event));
  board.addEventListener('pointercancel', event => finishSwipe(event, true));
  // Keep keyboard-accessible buttons working; pointer taps are handled above.
  board.addEventListener('click', event => {
    // Mobile browsers can dispatch a detail=0 click after pointerup.
    // Ignore it to prevent a single touch from toggling the cell twice.
    if (event.detail !== 0 || Date.now() - lastPointerTapAt < 500) return;
    const cell = event.target.closest('.cell');
    if (cell) tapCell(Number(cell.dataset.i));
  });
  $('new-puzzle').addEventListener('click', () => { lastTap = null; newPuzzle(); });
  $('hint').addEventListener('click', () => { lastTap = null; giveHint(); });
  $('undo').addEventListener('click', () => {
    lastTap = null;
    if (!state.history?.length || state.gameOver) return;
    clearPendingWrongCrosses();
    const previous = state.history.pop();
    state.marks = previous.marks;
    state.completed = previous.completed;
    hintIndex = -1;
    dialog.classList.add('hidden');
    tell('Last move undone.');
    save();
    render();
  });
  function restartGame() {
    lastTap = null;
    clearPendingWrongCrosses();
    state.history = [];
    state.marks = Array(state.size * state.size).fill('');
    state.completed = false;
    state.gameOver = false;
    state.mistakes = 0;
    hintIndex = -1;
    dialog.classList.add('hidden');
    lossDialog.classList.add('hidden');
    tell('Fresh start, same puzzle.');
    save();
    render();
  }
  $('restart').addEventListener('click', restartGame);
  $('play-again').addEventListener('click', () => { lastTap = null; newPuzzle(); });
  $('retry-puzzle').addEventListener('click', restartGame);
  $('loss-new-puzzle').addEventListener('click', () => { lastTap = null; newPuzzle(); });
  $('close-dialog').addEventListener('click', () => dialog.classList.add('hidden'));

  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (validState(saved)) state = saved;
  } catch (_) {}
  if (state) {
    if (!Number.isInteger(state.mistakeLimit) || ![3, 5].includes(state.mistakeLimit)) {
      state.mistakeLimit = Math.random() < .5 ? 3 : 5;
    }
    if (!Number.isInteger(state.mistakes)) state.mistakes = 0;
    if (typeof state.gameOver !== 'boolean') state.gameOver = false;
    // Correct older saves that reached the limit before this rule was fixed.
    if (!state.completed && state.mistakes >= state.mistakeLimit) state.gameOver = true;
    if (state.completed) {
      for (let i = 0; i < state.marks.length; i++) {
        if (state.marks[i] !== 'bird') state.marks[i] = 'x';
      }
    }
    // Older releases put permanent crosses on Easy / Medium boards. Clear
    // only those original clues when upgrading, leaving user-made moves alone.
    if (state.givens.some(mark => mark === 'x')) {
      state.marks = state.marks.map((mark, i) => state.givens[i] === 'x' ? '' : mark);
      state.givens = Array(state.size * state.size).fill('');
      state.history = [];
      save();
    }
    save();
    render();
    if (state.gameOver) lossDialog.classList.remove('hidden');
    // The rules are already above the board; keep the space below it empty on launch.
    tell('', 0);
  } else newPuzzle();
  startBackgroundGenerator();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'}).catch(() => {});
  }
})();
