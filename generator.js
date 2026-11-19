/* Birdoku puzzle maker. No dependencies; runs inside a Web Worker. */
const BirdokuGen = (() => {
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  function makeSolution(n) {
    const placed = [], used = new Set();
    function visit(r) {
      if (r === n) return true;
      for (const c of shuffle(Array.from({length: n}, (_, i) => i))) {
        if (used.has(c) || (r > 0 && Math.abs(c - placed[r - 1]) <= 1)) continue;
        placed.push(c);
        used.add(c);
        if (visit(r + 1)) return true;
        used.delete(c);
        placed.pop();
      }
      return false;
    }
    return visit(0) ? placed : null;
  }

  function neighbors(n) {
    return Array.from({length: n * n}, (_, p) => {
      const r = Math.floor(p / n), c = p % n, out = [];
      if (r > 0) out.push(p - n);
      if (r < n - 1) out.push(p + n);
      if (c > 0) out.push(p - 1);
      if (c < n - 1) out.push(p + 1);
      return out;
    });
  }

  function initialRegions(n, solution, nb) {
    const regions = Array(n * n).fill(-1), counts = Array(n).fill(1);
    for (let r = 0; r < n; r++) regions[r * n + solution[r]] = r;
    let missing = n * n - n;
    while (missing) {
      const frontier = [];
      for (let p = 0; p < regions.length; p++) {
        if (regions[p] !== -1) continue;
        const adjacent = new Set(nb[p].map(q => regions[q]).filter(k => k !== -1));
        for (const k of adjacent) frontier.push({p, k, weight: 1 / Math.pow(counts[k], 1.2)});
      }
      const total = frontier.reduce((s, item) => s + item.weight, 0);
      let chance = Math.random() * total, chosen = frontier[frontier.length - 1];
      for (const candidate of frontier) {
        chance -= candidate.weight;
        if (chance <= 0) { chosen = candidate; break; }
      }
      regions[chosen.p] = chosen.k;
      counts[chosen.k]++;
      missing--;
    }
    return regions;
  }

  // Enumerate only as many possible complete layouts as needed.
  // A puzzle is accepted only when exactly one layout remains.
  function solutions(n, regions, limit = 2) {
    const found = [], placed = [];
    const options = Array.from({length: n}, (_, r) =>
      Array.from({length: n}, (_, c) => ({c, region: regions[r * n + c]}))
        .filter(({region}) => region >= 0));
    function visit(r, lastColumn, usedColumns, usedRegions) {
      if (found.length >= limit) return;
      if (r === n) { found.push([...placed]); return; }
      for (const {c, region} of options[r]) {
        const columnBit = 1 << c, regionBit = 1 << region;
        if ((usedColumns & columnBit) || (usedRegions & regionBit) ||
            (lastColumn !== -1 && Math.abs(c - lastColumn) <= 1)) continue;
        placed.push(c);
        visit(r + 1, c, usedColumns | columnBit, usedRegions | regionBit);
        placed.pop();
        if (found.length >= limit) return;
      }
    }
    visit(0, -1, 0, 0);
    return found;
  }

  function generateOnce(n, maxSteps = 260) {
    const solution = makeSolution(n);
    if (!solution) return null;
    const nb = neighbors(n);
    const regions = initialRegions(n, solution, nb);
    const fixed = new Set(solution.map((c, r) => r * n + c));

    function canChange(p, target) {
      const before = regions[p];
      if (before === target || fixed.has(p)) return false;
      const sameNeighbors = nb[p].filter(q => regions[q] === before);
      if (sameNeighbors.length <= 1) return true;
      // Don't detach a section of the old color region.
      const visited = new Set([sameNeighbors[0]]), queue = [sameNeighbors[0]];
      for (let i = 0; i < queue.length; i++) {
        for (const q of nb[queue[i]]) {
          if (q !== p && regions[q] === before && !visited.has(q)) {
            visited.add(q);
            queue.push(q);
          }
        }
      }
      return sameNeighbors.every(q => visited.has(q));
    }

    let remaining = solutions(n, regions, 1000);
    for (let step = 0; step < maxSteps && remaining.length !== 1; step++) {
      const rival = remaining.find(candidate => candidate.some((c, r) => c !== solution[r]));
      const moves = [];
      const seen = new Set();
      function consider(p, target) {
        if (!canChange(p, target)) return;
        const key = `${p}-${target}`;
        if (!seen.has(key)) { seen.add(key); moves.push([p, target]); }
      }

      // Change a cell used by a competing solution, to eliminate that solution.
      if (rival) for (let r = 0; r < n; r++) {
        const p = r * n + rival[r];
        if (!fixed.has(p)) for (const neighbor of nb[p]) consider(p, regions[neighbor]);
      }
      // Explore boundary adjustments if the current rival is hard to remove.
      if (moves.length < 3 || step % 9 === 8) for (let j = 0; j < 30; j++) {
        const p = Math.floor(Math.random() * n * n);
        if (!fixed.has(p)) for (const neighbor of shuffle([...nb[p]])) {
          const target = regions[neighbor];
          if (canChange(p, target)) { consider(p, target); break; }
        }
      }
      shuffle(moves);
      let best = null, bestScore = Infinity;
      for (const [p, target] of moves) {
        const original = regions[p];
        regions[p] = target;
        const candidateSolutions = solutions(n, regions, Math.min(1000, remaining.length + 12));
        regions[p] = original;
        if (candidateSolutions.length < bestScore) {
          bestScore = candidateSolutions.length;
          best = {p, target, candidateSolutions};
        }
        if (bestScore === 1) break;
      }
      if (!best) break;
      const difference = bestScore - remaining.length;
      if (difference <= 0 || Math.random() < (difference <= 3 ? 0.1 : 0.005)) {
        regions[best.p] = best.target;
        remaining = best.candidateSolutions;
      }
    }
    return remaining.length === 1 ? {size: n, regions, solution} : null;
  }

  function generate(n, attempts = 6) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const result = generateOnce(n, 260);
      if (result && solutions(n, result.regions, 2).length === 1) return result;
    }
    return null;
  }

  function transform(puzzle) {
    const n = puzzle.size, rotation = Math.floor(Math.random() * 4);
    const mirror = Math.random() < 0.5;
    const colorMap = shuffle(Array.from({length: n}, (_, i) => i));
    const regions = Array(n * n), solution = Array(n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      let x = c, y = r;
      if (mirror) x = n - 1 - x;
      for (let k = 0; k < rotation; k++) [x, y] = [n - 1 - y, x];
      regions[y * n + x] = colorMap[puzzle.regions[r * n + c]];
      if (puzzle.solution[r] === c) solution[y] = x;
    }
    return {size: n, solution, regions};
  }

  return {generate, solutions, transform};
})();
if (typeof module !== 'undefined') module.exports = BirdokuGen;
