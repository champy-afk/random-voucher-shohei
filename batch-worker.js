importScripts('batch-engine.js');
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: allocateBatch(data.products, data.people, data.percent) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
