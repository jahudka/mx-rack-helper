#!/usr/bin/env node

import { findMixer } from './findMixer';
import { setPortAliases } from './reaper';

(async () => {
  const scanner = await findMixer();
  await scanner.ensureSampleRate();

  const outputs = await scanner.scanCardRouting();
  await scanner.terminate();

  await setPortAliases(process.argv[2], outputs);
})();
