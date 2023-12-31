import { MXDiscoveryService } from '@mxfriend/common';
import { MX32_UDP_PORT } from '@mxfriend/libmx32';
import { MXAIR_UDP_PORT } from '@mxfriend/libmxair';
import { MixerScanner, MX32Scanner, MXAirScanner } from './scanner';

export async function findMixer(): Promise<MixerScanner | undefined> {
  const mx32 = new MXDiscoveryService(MX32_UDP_PORT, 1000, 10000);
  const mxair = new MXDiscoveryService(MXAIR_UDP_PORT, 1000, 10000);

  const result = new Promise<MixerScanner | undefined>((resolve) => {
    mx32.on('mixer-found', ({ ip }) => {
      resolve(MX32Scanner.create(ip));
    });

    mxair.on('mixer-found', ({ ip }) => {
      resolve(MXAirScanner.create(ip));
    });

    setTimeout(() => resolve(undefined), 10000);
  });

  try {
    await mx32.start();
    await mxair.start();
    return await result;
  } finally {
    mx32.off();
    mxair.off();
    await mx32.stop();
    await mxair.stop();
  }
}
