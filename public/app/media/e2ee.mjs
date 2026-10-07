// Attaches end-to-end encryption to RTCRtpSenders and RTCRtpReceivers. Used when other people's computers
// (participant hosts) or a media server forward the call. Direct (peer to peer) calls are already encrypted
// end to end by WebRTC itself, so they skip this.
export const e2eeSupported = () => typeof RTCRtpSender !== 'undefined' && ('createEncodedStreams' in RTCRtpSender.prototype || typeof RTCRtpScriptTransform !== 'undefined');
export const needsInsertableFlag = () => typeof RTCRtpSender !== 'undefined' && 'createEncodedStreams' in RTCRtpSender.prototype;

export class E2ee {
  constructor(key) {
    this.worker = new Worker(new URL('./e2ee-worker.js', import.meta.url));
    this.ready = new Promise((res) => {
      this.worker.addEventListener('message', function on(e) { if (e.data.op === 'key-ok') res(); });
    });
    this.worker.postMessage({ op: 'key', key });
  }
  attach(senderOrReceiver, kind, op) {
    if ('createEncodedStreams' in senderOrReceiver) {
      const { readable, writable } = senderOrReceiver.createEncodedStreams();
      this.worker.postMessage({ op, kind, readable, writable }, [readable, writable]);
    } else if (typeof RTCRtpScriptTransform !== 'undefined') {
      senderOrReceiver.transform = new RTCRtpScriptTransform(this.worker, { kind, op });
    }
  }
  stats() {
    return new Promise((res) => {
      const on = (e) => { if (e.data.op === 'stats') { this.worker.removeEventListener('message', on); res(e.data.stats); } };
      this.worker.addEventListener('message', on);
      this.worker.postMessage({ op: 'stats' });
    });
  }
  close() { this.worker.terminate(); }
}
