importScripts('./generator.js');
self.addEventListener('message', (event) => {
  const {size, id, seed} = event.data;
  try {
    // Build the complex core with a solver; extra rows/columns are added
    // as mathematically forced connected regions, preserving uniqueness.
    const baseSize = size <= 9 ? 8 : 10;
    const core = BirdokuGen.generate(baseSize, 2) || seed;
    const puzzle = size === baseSize ? core : BirdokuGen.expand(core, size);
    self.postMessage({id, size, puzzle});
  } catch (error) {
    self.postMessage({id, size, puzzle: null, error: String(error)});
  }
});
