// Background blur for your camera: MediaPipe's selfie segmentation (Apache-2.0) finds you in each frame, the
// rest of the picture is blurred, and the result is a new video track that replaces your camera in the call.
// All on this device. Runs on the graphics chip where it can, on the processor otherwise.
import { assetUrl } from './api.mjs';

const FPS = 24;
let segP = null;
async function segmenter(cpuOnly = false) {
  if (cpuOnly) segP = null;
  if (!segP) segP = (async () => {
    const { FilesetResolver, ImageSegmenter, WASM, MODEL } = await import(/* @vite-ignore */ assetUrl('blur.js'));
    const files = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate) => ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
    let forced = null; try { forced = localStorage.getItem('meet:blur-delegate'); } catch {}
    if (forced === 'CPU' || cpuOnly) return { seg: await make('CPU'), delegate: 'CPU' };
    try { return { seg: await make('GPU'), delegate: 'GPU' }; } catch { return { seg: await make('CPU'), delegate: 'CPU' }; }
  })();
  return segP;
}

export class Blur {
  static async create(camera, { amount = 24 } = {}) {
    const b = new Blur(camera, amount);
    await b.start();
    return b;
  }

  constructor(camera, amount) {
    this.camera = camera;
    this.amount = amount;
    this.stats = { frames: 0, masks: 0, ms: 0, delegate: null };
  }

  async start() {
    const s = this.camera.getSettings();
    const w = s.width || 640, h = s.height || 360;
    this.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
    this.video.srcObject = new MediaStream([this.camera]);
    await this.video.play().catch(() => {});
    this.out = Object.assign(document.createElement('canvas'), { width: w, height: h });
    this.person = Object.assign(document.createElement('canvas'), { width: w, height: h });
    this.maskC = document.createElement('canvas');
    // The model looks at a small copy of the frame: the mask is smoothed when scaled up, and it is far cheaper.
    this.small = Object.assign(document.createElement('canvas'), { width: 256, height: Math.round((256 * h) / w) });
    this.sg = this.small.getContext('2d');
    // The background is blurred small and scaled up: it looks the same and costs a fraction.
    this.bg = Object.assign(document.createElement('canvas'), { width: 320, height: Math.round((320 * h) / w) });
    this.bgg = this.bg.getContext('2d');
    this.g = this.out.getContext('2d');
    this.pg = this.person.getContext('2d');
    this.mg = this.maskC.getContext('2d', { willReadFrequently: true });
    const { seg, delegate } = await segmenter();
    this.seg = seg;
    this.stats.delegate = delegate;
    this.track = this.out.captureStream(FPS).getVideoTracks()[0];
    this.track.contentHint = 'motion';
    this.timer = setInterval(() => this.frame(), 1000 / FPS);
  }

  frame() {
    const v = this.video;
    if (!v.videoWidth || this.busy) return;
    const { width: W, height: H } = this.out;
    this.busy = true;
    const t0 = performance.now();
    try {
      this.sg.drawImage(v, 0, 0, this.small.width, this.small.height);
      this.seg.segmentForVideo(this.small, t0, (r) => {
        const m = r.confidenceMasks?.[0];
        if (!m) return;
        // The mask (how sure each pixel is you) as an alpha channel.
        if (this.maskC.width !== m.width || this.maskC.height !== m.height) { this.maskC.width = m.width; this.maskC.height = m.height; this.img = this.mg.createImageData(m.width, m.height); }
        const p = m.getAsFloat32Array();
        const d = this.img.data;
        for (let i = 0; i < p.length; i++) { d[i * 4 + 3] = Math.min(255, Math.max(0, (p[i] - 0.25) * 2 * 255)); }
        this.mg.putImageData(this.img, 0, 0);
        this.stats.masks++;
      });
    } catch (e) { this.error = e.message; }
    // Background: the frame, blurred. Then you, cut out with the mask, on top.
    this.bgg.filter = `blur(${Math.max(2, Math.round((this.amount * this.bg.width) / W))}px)`;
    this.bgg.drawImage(v, 0, 0, this.bg.width, this.bg.height);
    this.g.imageSmoothingQuality = 'high';
    this.g.drawImage(this.bg, 0, 0, W, H);
    if (this.stats.masks) {
      this.pg.globalCompositeOperation = 'copy';
      this.pg.drawImage(v, 0, 0, W, H);
      this.pg.globalCompositeOperation = 'destination-in';
      this.pg.drawImage(this.maskC, 0, 0, W, H);
      this.g.drawImage(this.person, 0, 0);
    }
    this.stats.frames++;
    this.stats.ms += performance.now() - t0;
    this.busy = false;
    // A graphics chip that turns out slow (or a software one): the processor is faster for this small model.
    if (this.stats.frames === 12 && this.stats.delegate === 'GPU' && this.stats.ms / 12 > 60 && !this.switching) {
      this.switching = true;
      segmenter(true).then(({ seg, delegate }) => { this.seg = seg; this.stats = { frames: 0, masks: 0, ms: 0, delegate, switched: true }; }).catch(() => {});
    }
  }

  stop() {
    clearInterval(this.timer);
    this.track?.stop();
    if (this.video) this.video.srcObject = null;
  }
}
