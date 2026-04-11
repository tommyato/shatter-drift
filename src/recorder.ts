/**
 * MediaRecorder-based video capture from the Three.js canvas.
 * Records gameplay and produces a downloadable MP4/WebM blob.
 *
 * Usage: append ?demo=true&record=true&duration=15 to auto-record 15 seconds.
 */

export class GameRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recording = false;
  private startTime = 0;
  private maxDuration: number; // seconds
  private onComplete: ((blob: Blob) => void) | null = null;

  constructor(maxDuration = 15) {
    this.maxDuration = maxDuration;
  }

  /** Start recording the canvas */
  start(canvas: HTMLCanvasElement, onComplete?: (blob: Blob) => void) {
    if (this.recording) return;

    this.onComplete = onComplete || null;
    this.chunks = [];

    // Capture stream at 30fps
    const stream = canvas.captureStream(30);

    // Try VP9 first (better quality), fall back to VP8
    const mimeTypes = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];

    let selectedMime = "";
    for (const mime of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mime)) {
        selectedMime = mime;
        break;
      }
    }

    if (!selectedMime) {
      console.error("No supported video MIME type found");
      return;
    }

    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: selectedMime,
      videoBitsPerSecond: 5_000_000, // 5 Mbps for good quality
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: selectedMime });
      this.recording = false;

      if (this.onComplete) {
        this.onComplete(blob);
      } else {
        // Default: trigger download
        this.downloadBlob(blob);
      }
    };

    this.mediaRecorder.start(100); // collect data every 100ms
    this.recording = true;
    this.startTime = performance.now();

    // Show recording indicator
    this.showIndicator(true);
  }

  /** Call each frame to check duration */
  update() {
    if (!this.recording) return;

    const elapsed = (performance.now() - this.startTime) / 1000;
    if (elapsed >= this.maxDuration) {
      this.stop();
    }
  }

  /** Stop recording manually */
  stop() {
    if (!this.recording || !this.mediaRecorder) return;
    this.mediaRecorder.stop();
    this.showIndicator(false);
  }

  get isRecording(): boolean {
    return this.recording;
  }

  private downloadBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shatter-drift-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private showIndicator(show: boolean) {
    let indicator = document.getElementById("rec-indicator");
    if (show) {
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "rec-indicator";
        indicator.style.cssText = `
          position: fixed;
          top: 16px;
          right: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(0,0,0,0.7);
          padding: 8px 16px;
          border-radius: 20px;
          font-family: 'Orbitron', sans-serif;
          font-size: 14px;
          color: #ff4444;
          z-index: 9999;
          pointer-events: none;
        `;
        const dot = document.createElement("span");
        dot.style.cssText = `
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ff4444;
          animation: recBlink 1s ease-in-out infinite;
        `;
        const style = document.createElement("style");
        style.textContent = `@keyframes recBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`;
        document.head.appendChild(style);
        indicator.appendChild(dot);
        indicator.appendChild(document.createTextNode("REC"));
        document.body.appendChild(indicator);
      }
      indicator.style.display = "flex";
    } else if (indicator) {
      indicator.style.display = "none";
    }
  }
}
