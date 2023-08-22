#!/usr/bin/env node

import { findMixer } from './findMixer';
import { setPortAliases } from './reaper';

(async () => {
  while (true) {
    try {
      const scanner = await findMixer();
      await scanner.ensureSampleRate();

      const outputs = await scanner.scanCardRouting();
      await scanner.terminate();

      await setPortAliases(process.argv[2], outputs);

      return;
    } catch (e: any) {
      if (e.code === 'ENETUNREACH') {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      throw e;
    }
  }
})();
