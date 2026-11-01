const MAX_RECORDING_MS = 20_000;
const FORMATS = [
  { mime: "audio/webm;codecs=opus", extension: "webm" },
  { mime: "audio/webm", extension: "webm" },
  { mime: "audio/ogg;codecs=opus", extension: "ogg" },
  { mime: "audio/mp4", extension: "m4a" },
];

export class VoiceRecorder {
  private permission: Promise<void> | null = null;
  private recorder: MediaRecorder | null = null;
  private cancelRecording: (() => void) | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private readonly onRecording: (recording: boolean) => void) {}

  private checkSupport(): void {
    if (this.disposed) throw new DOMException("Запись отменена", "AbortError");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Для микрофона откройте игру через HTTPS или localhost/127.0.0.1.");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new Error("Браузер не поддерживает запись голоса. Используйте текстовый ввод.");
    }
  }

  requestPermission(): Promise<void> {
    try {
      this.checkSupport();
    } catch (error) {
      return Promise.reject(error);
    }
    if (!this.permission) {
      this.permission = navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          // При загрузке страницы только запрашиваем разрешение, без записи.
          for (const track of stream.getTracks()) track.stop();
        })
        .finally(() => { this.permission = null; });
    }
    return this.permission;
  }

  async record(): Promise<File> {
    this.checkSupport();
    if (this.recorder) throw new Error("Запись уже идёт");
    const generation = ++this.generation;
    if (this.permission) await this.permission;
    this.ensureCurrent(generation);
    const format = FORMATS.find((item) => MediaRecorder.isTypeSupported(item.mime));
    if (!format) throw new Error("Браузер не поддерживает доступные форматы записи.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const stopTracks = (): void => { for (const track of stream.getTracks()) track.stop(); };
    try {
      this.ensureCurrent(generation);
      const recorder = new MediaRecorder(stream, { mimeType: format.mime, audioBitsPerSecond: 64_000 });
      this.recorder = recorder;
      return await new Promise<File>((resolve, reject) => {
        const chunks: Blob[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const cleanup = (): void => {
          settled = true;
          clearTimeout(timer);
          recorder.ondataavailable = null;
          recorder.onstop = null;
          recorder.onerror = null;
          for (const track of stream.getAudioTracks()) track.onended = null;
          this.recorder = null;
          this.cancelRecording = null;
          stopTracks();
          this.onRecording(false);
        };
        const fail = (error: Error): void => {
          if (settled) return;
          cleanup();
          try {
            if (recorder.state !== "inactive") recorder.stop();
          } finally {
            reject(error);
          }
        };
        this.cancelRecording = () => fail(new DOMException("Запись отменена", "AbortError"));
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => fail(new Error("Не удалось записать голос. Проверьте микрофон."));
        for (const track of stream.getAudioTracks()) {
          track.onended = () => fail(new Error("Микрофон отключён. Подключите его и повторите запись."));
        }
        recorder.onstop = () => {
          if (settled) return;
          const type = recorder.mimeType || format.mime;
          const audio = new Blob(chunks, { type });
          cleanup();
          if (!audio.size) reject(new Error("Запись пустая. Попробуйте ещё раз."));
          else resolve(new File([audio], `voice.${format.extension}`, { type }));
        };
        try {
          recorder.start();
          this.onRecording(true);
          timer = setTimeout(() => this.stop(), MAX_RECORDING_MS);
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Не удалось начать запись"));
        }
      });
    } finally {
      stopTracks();
    }
  }

  stop(): void {
    if (this.recorder?.state === "recording") this.recorder.stop();
  }

  cancel(): void {
    this.generation += 1;
    this.cancelRecording?.();
  }

  private ensureCurrent(generation: number): void {
    if (this.disposed || generation !== this.generation) {
      throw new DOMException("Запись отменена", "AbortError");
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }
}
