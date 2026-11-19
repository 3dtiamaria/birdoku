(() => {
  'use strict';
  const SAVE_KEY = 'birdoku-state-v1';
  const USED_KEY = 'birdoku-used-starters-v1';
  const COLORS = ['#b07b58', '#f5a9c8', '#e8bd50', '#ebd78c', '#617db3', '#bdd1e3', '#ffa877', '#5eb7b6', '#d780b5', '#9774c6', '#b1d99d'];
  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const sizeSelect = $('grid-size');
  const difficultySelect = $('difficulty');
  const dialog = $('win-dialog');
  const message = $('message');
  const cached = {6: [], 8: [], 10: []};
  const pending = new Set();
  let worker = null;
  let workerBusy = false;
  let nextId = 0;
  let state = null;
  let messageTimeout = null;
  let hintIndex = -1;
  let usedStarters = {6: [], 8: [], 10: []};
  let swipe = null;

  try {
    const old = JSON.parse(localStorage.getItem(USED_KEY));
    if (old && typeof old === 'object') usedStarters = {...usedStarters, ...old};
  } catch (_) { /* storage may be disabled */ }

  // Original simple bird icon drawn directly as SVG; no external images or fonts.
  const birdSVG = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="bird-drawing" aria-hidden="true">
    <path d="M17 25Q10 10 22 8L30 19Q33 11 43 12L46 25" fill="#68667e" stroke="#4c4a65" stroke-width="2" stroke-linejoin="round"/>
    <path d="M9 32Q9 16 32 15Q55 15 55 36Q55 55 33 56Q10 54 9 32Z" fill="#6d6a86"/>
    <path d="M13 41Q20 49 33 46Q47 46 52 40Q48 57 32 57Q18 56 13 41Z" fill="#fff9ef"/>
    <ellipse cx="22" cy="31" rx="3.4" ry="4.4" fill="#29293e"/>
    <ellipse cx="42" cy="31" rx="3.4" ry="4.4" fill="#29293e"/>
    <circle cx="23" cy="29" r="1.3" fill="#fff"/><circle cx="43" cy="29" r="1.3" fill="#fff"/>
    <ellipse cx="15" cy="39" rx="5.8" ry="3.7" fill="#e4a7b0" opacity=".85"/>
    <ellipse cx="49" cy="39" rx="5.8" ry="3.7" fill="#e4a7b0" opacity=".85"/>
    <path d="M26 37Q32 33 38 37L32 43Z" fill="#f0b761" stroke="#d89847" stroke-width=".7" stroke-linejoin="round"/>
  </svg>`;

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
    return s && [6, 8, 10].includes(s.size) &&
      Array.isArray(s.regions) && s.regions.length === s.size * s.size &&
      Array.isArray(s.marks) && s.marks.length === s.size * s.size &&
      Array.isArray(s.solution) && s.solution.length === s.size &&
      Array.isArray(s.givens) && s.givens.length === s.size * s.size;
  }

  function countBirds() { return state.marks.filter(mark => mark === 'bird').length; }

  function render() {
    if (!state) return;
    const n = state.size;
    sizeSelect.value = String(n);
    difficultySelect.value = state.difficulty;
    board.style.setProperty('--n', String(n));
    board.dataset.size = String(n);
    board.setAttribute('aria-label', `${n} by ${n} bird puzzle`);
    let html = '';
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n), c = i % n;
      const mark = state.marks[i];
      const classes = ['cell'];
      if (state.givens[i] === 'x') classes.push('is-given');
      if (hintIndex === i) classes.push('is-hinted');
      const glyph = mark === 'bird' ? birdSVG : mark === 'x' ? '<span class="cross">×</span>' : '';
      const label = `${mark === 'bird' ? 'Bird' : mark === 'x' ? 'Eliminated' : 'Empty'}, row ${r + 1}, column ${c + 1}${state.givens[i] ? ', given clue' : mark === 'bird' ? ', tap to clear' : mark === 'x' ? ', tap to try a bird' : ', tap to mark X'}`;
      html += `<button class="${classes.join(' ')}" data-i="${i}" type="button" style="--cell-color:${state.palette?.[state.regions[i]] || COLORS[state.regions[i]]}" aria-label="${label}" ${state.givens[i] ? 'aria-disabled="true"' : ''}>${glyph}</button>`;
    }
    board.innerHTML = html;
    $('progress').textContent = `${countBirds()} / ${n} birds`;
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

  function freshPuzzle(size, difficulty, preset) {
    const p = BirdokuGen.transform(preset);
    const marks = Array(size * size).fill('');
    const givens = Array(size * size).fill('');
    let clues = difficulty === 'easy' ? Math.round(size * size * .19)
      : difficulty === 'medium' ? Math.round(size * size * .06) : 0;
    const empty = Array.from({length: size * size}, (_, i) => i)
      .filter(i => p.solution[Math.floor(i / size)] !== i % size);
    for (let i = empty.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [empty[i], empty[j]] = [empty[j], empty[i]];
    }
    for (const i of empty.slice(0, clues)) { marks[i] = 'x'; givens[i] = 'x'; }
    const number = (state?.number || 0) + 1;
    const palette = [...COLORS];
    for (let i = palette.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [palette[i], palette[j]] = [palette[j], palette[i]];
    }
    state = {size, difficulty, regions: p.regions, solution: p.solution, palette: palette.slice(0, size),
      givens, marks, number, completed: false, history: []};
    hintIndex = -1;
    dialog.classList.add('hidden');
    save();
    render();
    tell(`Puzzle ${number} · Find ${size} birds. Have fun!`);
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
    worker.postMessage({size, id: ++nextId});
  }

  function newPuzzle() {
    const size = Number(sizeSelect.value), difficulty = difficultySelect.value;
    const generated = cached[size].shift();
    freshPuzzle(size, difficulty, generated || takeStarter(size));
    prefetch(size);
  }

  function startBackgroundGenerator() {
    if (typeof Worker === 'undefined') return;
    try {
      worker = new Worker(window.BIRDOKU_WORKER_URL || './worker.js');
      worker.addEventListener('message', (event) => {
        workerBusy = false;
        const {size, puzzle} = event.data;
        if (puzzle && BirdokuGen.solutions(size, puzzle.regions, 2).length === 1) cached[size].push(puzzle);
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
    state.marks = [...state.givens];
    state.completed = false;
    hintIndex = -1;
    dialog.classList.add('hidden');
    tell('Fresh start, same puzzle.');
    save();
    render();
  });
  sizeSelect.addEventListener('change', newPuzzle);
  difficultySelect.addEventListener('change', newPuzzle);
  $('play-again').addEventListener('click', newPuzzle);
  $('close-dialog').addEventListener('click', () => dialog.classList.add('hidden'));

  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (validState(saved)) state = saved;
  } catch (_) {}
  if (state) { render(); tell(state.completed ? 'Beautifully solved! Start another puzzle any time.' : 'Welcome back! Your puzzle was saved.'); }
  else freshPuzzle(10, 'medium', takeStarter(10));
  startBackgroundGenerator();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
