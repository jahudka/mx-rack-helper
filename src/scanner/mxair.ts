import { ClockRate, MXDispatcher } from '@mxfriend/common';
import { Mixer, MXAirOSCPort, UsbSrc } from '@mxfriend/libmxair';
import { StringValue } from '@mxfriend/oscom';
import { MixerScanner } from './types';

const $scanner = Symbol('scanner');

export class MXAirScanner implements MixerScanner {
  private readonly port: MXAirOSCPort;
  private readonly mixer: Mixer;
  private readonly dispatcher: MXDispatcher;

  static async create(ip: string): Promise<MXAirScanner> {
    const scanner = new MXAirScanner(ip);
    await scanner.port.open();
    return scanner;
  }

  constructor(mixerAddress: string) {
    this.port = new MXAirOSCPort({ mixerAddress });
    this.mixer = new Mixer();
    this.dispatcher = new MXDispatcher(this.port, this.mixer);
  }

  async ensureSampleRate(): Promise<void> {
    try {
      const srate = await this.dispatcher.addAndQuery($scanner, this.mixer['-prefs'].clockrate);

      if (srate !== ClockRate.R44k1) {
        this.mixer['-prefs'].clockrate.$set(ClockRate.R44k1);
      }
    } finally {
      this.dispatcher.remove($scanner, this.mixer['-prefs'].clockrate);
    }
  }

  async scanCardRouting(): Promise<(string | null)[]> {
    return Promise.all([...new Array(18).keys()].map((idx) => this.resolveSinglePatchPoint(idx)));
  }

  private async resolveSinglePatchPoint(idx: number): Promise<string | null> {
    const point = this.mixer.routing.usb.$get(idx);
    const [source, tap] = await this.dispatcher.query(point.src, point.pos);
    const name = await this.resolveUsbSource(source);

    if (name === null || tap === undefined) {
      return null;
    }

    const pos = ['IN', 'IN+M', '<EQ', '<EQ+M', 'EQ>', 'EQ>+M', 'PRE', 'PRE+M', 'POST'][tap];
    return `${name} (${pos})`;
  }

  private async resolveUsbSource(source?: UsbSrc): Promise<string | null> {
    if (source === undefined) {
      return null;
    } else if (source <= UsbSrc.Ch16) {
      return this.resolveName(this.mixer.ch.$get(source), `Ch ${source+1}`);
    } else if (source <= UsbSrc.AuxR) {
      const name = await this.resolveName(this.mixer.rtn.aux, 'Aux');
      return `${name} ${source === UsbSrc.AuxL ? 'L' : 'R'}`;
    } else if (source <= UsbSrc.Fx4R) {
      source -= UsbSrc.Fx1L;
      const fx = Math.floor(source / 4);
      const name = await this.resolveName(this.mixer.rtn.$get(fx), `FX ${fx+1}`)
      return `${name}${/\d$/.test(name) ? '' : ' '}${source % 2 ? 'R' : 'L'}`;
    } else if (source <= UsbSrc.Bus6) {
      source -= UsbSrc.Bus1;
      return this.resolveName(this.mixer.bus.$get(source), `Bus ${source+1}`);
    } else if (source <= UsbSrc.Send4) {
      source -= UsbSrc.Send1;
      return this.resolveName(this.mixer.fxsend.$get(source), `FxSend ${source+1}`);
    } else {
      const name = await this.resolveName(this.mixer.lr, `Main`);
      return `${name} ${source === UsbSrc.L ? 'L' : 'R'}`;
    }
  }

  private async resolveName(ch: { config: { name: StringValue } }, fallback: string): Promise<string> {
    const name = await this.dispatcher.query(ch.config.name);
    return name !== undefined && name !== '' ? name : fallback;
  }

  async terminate(): Promise<void> {
    await this.port.close();
  }
}
