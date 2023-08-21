export interface MixerScanner {
  ensureSampleRate(): Promise<void>;
  scanCardRouting(): Promise<(string|null)[]>;
  terminate(): Promise<void>;
}
