// The speech model, in its own thread so the call never stutters while it works. Bundled by
// scripts/build-client.mjs into public/vendor/whisper-worker.js. Whisper (MIT) through transformers.js
// (Apache-2.0); the model files come from the Hugging Face hub once and the browser caches them.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
let asr = null;
let device = null;

self.onmessage = async (e) => {
  const d = e.data;
  if (d.op === 'load') {
    try {
      const progress_callback = (p) => { if (p.status === 'progress' || p.status === 'done') self.postMessage({ op: 'progress', file: p.file, loaded: p.loaded, total: p.total, status: p.status }); };
      if (d.device === 'webgpu') {
        try { asr = await pipeline('automatic-speech-recognition', d.model, { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback }); device = 'webgpu'; }
        catch { asr = null; }
      }
      if (!asr) { asr = await pipeline('automatic-speech-recognition', d.model, { device: 'wasm', dtype: 'q8', progress_callback }); device = 'wasm'; }
      // One short silent run, so the first real line is not slowed by setup.
      await asr(new Float32Array(16000));
      self.postMessage({ op: 'ready', device, model: d.model });
    } catch (err) { self.postMessage({ op: 'error', message: `The speech model could not load: ${err.message}` }); }
    return;
  }
  if (d.op === 'run') {
    const t0 = performance.now();
    try {
      const out = await asr(d.audio);
      self.postMessage({ op: 'done', id: d.id, text: String(out.text ?? '').trim(), ms: Math.round(performance.now() - t0) });
    } catch (err) { self.postMessage({ op: 'error', id: d.id, message: err.message }); }
  }
};
