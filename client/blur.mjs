// Background blur's segmentation model runner (MediaPipe Tasks, Apache-2.0), bundled into public/vendor/blur.js.
// Its WebAssembly comes from jsDelivr and the selfie segmentation model from Google's model storage, once.
export { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
export const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
export const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
