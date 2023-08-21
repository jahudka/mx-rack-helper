import { findMixer } from './findMixer';
import { getCapturePorts, setAlias } from './jackd';

(async () => {
  const scanner = await findMixer();
  await scanner.ensureSampleRate();

  const outputs = await scanner.scanCardRouting();
  const ports = await getCapturePorts();
  await scanner.terminate();

  for (const port of ports) {
    await setAlias(port, outputs[port] ?? null);
  }
})();
