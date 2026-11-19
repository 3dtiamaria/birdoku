importScripts('./generator.js');
self.addEventListener('message', (event) => {
  const {size, id} = event.data;
  try {
    const puzzle = BirdokuGen.generate(size, 7);
    self.postMessage({id, size, puzzle});
  } catch (error) {
    self.postMessage({id, size, puzzle: null, error: String(error)});
  }
});
