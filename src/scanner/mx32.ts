import { ClockRate, MXDispatcher } from '@mxfriend/common';
import {
  AuxInPatch,
  ClockSource,
  Mixer,
  MX32OSCPort,
  Output,
  OutputPos,
  OutputSource,
  PatchBlock,
  UserInSource,
  UserOutDest,
} from '@mxfriend/libmx32';
import { Collection, StringValue } from '@mxfriend/oscom';
import { MixerScanner } from './types';

const $scanner = Symbol('scanner');

export class MX32Scanner implements MixerScanner {
  private readonly port: MX32OSCPort;
  private readonly dispatcher: MXDispatcher;
  private readonly mixer: Mixer;

  static async create(ip: string): Promise<MX32Scanner> {
    const scanner = new MX32Scanner(ip);
    await scanner.port.open();
    return scanner;
  }

  private constructor(mixerAddress: string) {
    this.port = new MX32OSCPort({ mixerAddress });
    this.mixer = new Mixer();
    this.dispatcher = new MXDispatcher(this.port, this.mixer);
  }

  async ensureSampleRate(): Promise<void> {
    try {
      const [source, rate] = await this.dispatcher.addAndQuery(
        $scanner,
        this.mixer['-prefs'].clocksource,
        this.mixer['-prefs'].clockrate,
      );

      if (rate !== ClockRate.R44k1 && source === ClockSource.Internal) {
        this.mixer['-prefs'].clockrate.$set(ClockRate.R44k1);
      }
    } finally {
      this.dispatcher.remove(
        $scanner,
        this.mixer['-prefs'].clocksource,
        this.mixer['-prefs'].clockrate,
      );
    }
  }

  async scanCardRouting(): Promise<(string|null)[]> {
    const blocks = await this.dispatcher.query(
      this.mixer.config.routing.CARD['1-8'],
      this.mixer.config.routing.CARD['9-16'],
      this.mixer.config.routing.CARD['17-24'],
      this.mixer.config.routing.CARD['25-32'],
    );

    const names = await Promise.all(blocks.map(async (block) => this.resolveBlockRouting(block)));
    return names.flat();
  }

  async terminate(): Promise<void> {
    await this.port.close();
  }

  private async resolveBlockRouting(block?: PatchBlock): Promise<(string|null)[]> {
    if (block === undefined) {
      return new Array(8).fill(null);
    }

    if (block <= PatchBlock.Local25_32) {
      return genRange(block * 8, 'Local');
    } else if (block <= PatchBlock.A41_48) {
      return genRange((block - PatchBlock.A1_8) * 8, 'Aes50 A');
    } else if (block <= PatchBlock.B41_48) {
      return genRange((block - PatchBlock.B1_8) * 8, 'Aes50 B');
    } else if (block <= PatchBlock.Card25_32) {
      return genRange((block - PatchBlock.Card1_8) * 8, 'Card');
    } else if (block <= PatchBlock.Out9_16) {
      return this.resolveOutputBlock(this.mixer.outputs.main, block === PatchBlock.Out1_8 ? 0 : 8);
    } else if (block <= PatchBlock.P169_16) {
      return this.resolveOutputBlock(this.mixer.outputs.p16, block === PatchBlock.P16_18 ? 0 : 8);
    } else if (block <= PatchBlock.Aux1_6Mon) {
      const auxOuts = await this.resolveOutputBlock(this.mixer.outputs.aux, 0, 6);
      return [...auxOuts, 'Monitor L', 'Monitor R'];
    } else if (block <= PatchBlock.AuxIn1_6TB) {
      const auxIns = await this.resolveAuxInRemap();
      return [...auxIns, 'Talkback Int', 'Talkback Ext'];
    } else if (block <= PatchBlock.UserOut41_48) {
      return this.resolveUserOutBlock(block - PatchBlock.UserOut1_8);
    } else /*if (block <= PatchBlock.UserIn25_32)*/ {
      return this.resolveUserInBlock(block - PatchBlock.UserIn1_8);
    }
  }

  private async resolveOutputBlock(collection: Collection<Output>, base: number = 0, size: number = 8): Promise<(string|null)[]> {
    return Promise.all([...new Array(size).keys()].map((i) => this.resolveSingleOutput(collection, base + i)));
  }

  private async resolveSingleOutput(collection: Collection<Output>, output: number): Promise<string | null> {
    const node = collection.$get(output);
    const [source, tap] = await this.dispatcher.query(node.src, node.pos);
    return this.resolveOutput(source, tap);
  }

  private async resolveOutput(source?: OutputSource, tap?: OutputPos): Promise<string | null> {
    if (source === undefined || tap === undefined) {
      return null;
    }

    const name = await this.resolveOutputSource(source);
    const pos = ['IN', 'IN+M', '<EQ', '<EQ+M', 'EQ>', 'EQ>+M', 'PRE', 'PRE+M', 'POST'][tap];
    return `${name} (${pos})`;
  }

  private async resolveOutputSource(source: OutputSource): Promise<string> {
    if (source === OutputSource.Off) {
      return 'Off';
    } else if (source <= OutputSource.MainR) {
      const name = await this.dispatcher.query(this.mixer.main.st.config.name);
      return `${name !== undefined && name !== '' ? name : 'Main'} ${source === OutputSource.MainL ? 'L' : 'R'}`;
    } else if (source === OutputSource.MC) {
      return this.resolveName(this.mixer.main.m, 'M/C');
    } else if (source <= OutputSource.MixBus16) {
      source -= OutputSource.MixBus01;
      return this.resolveName(this.mixer.bus.$get(source), `Bus ${source + 1}`);
    } else if (source <= OutputSource.Matrix6) {
      source -= OutputSource.Matrix1;
      return this.resolveName(this.mixer.mtx.$get(source), `Matrix ${source + 1}`);
    } else if (source <= OutputSource.DirectOutCh32) {
      source -= OutputSource.DirectOutCh01;
      return this.resolveName(this.mixer.ch.$get(source), `Ch ${source + 1}`);
    } else if (source <= OutputSource.DirectOutAux8) {
      source -= OutputSource.DirectOutAux1;
      return this.resolveName(this.mixer.auxin.$get(source), `Aux ${source + 1}`);
    } else if (source <= OutputSource.DirectOutFX4R) {
      source -= OutputSource.DirectOutFX1L;
      return this.resolveName(this.mixer.fxrtn.$get(source), `FX ${Math.floor(source / 2) + 1}${source % 2 ? 'R' : 'L'}`);
    } else if (source <= OutputSource.MonitorR) {
      return `Monitor ${source === OutputSource.MonitorL ? 'L' : 'R'}`;
    } else {
      return 'Talkback';
    }
  }

  private async resolveAuxInRemap(): Promise<(string|null)[]> {
    const block = await this.dispatcher.query(this.mixer.config.routing.IN.AUX);

    switch (block) {
      case undefined: return new Array(6).fill(null);
      case AuxInPatch.Aux1_4: return [...new Array(6).keys()].map((i) => `Aux In ${i + 1}`);
      case AuxInPatch.Local1_2: return ['Local 1', 'Local 2', 'Aux In 3', 'Aux In 4', 'Aux In 5', 'Aux In 6'];
      case AuxInPatch.Local1_4: return ['Local 1', 'Local 2', 'Local 3', 'Local 4', 'Aux In 5', 'Aux In 6'];
      case AuxInPatch.Local1_6: return ['Local 1', 'Local 2', 'Local 3', 'Local 4', 'Local 5', 'Local 6'];
      case AuxInPatch.A1_2: return ['Aes50 A 1', 'Aes50 A 2', 'Aux In 3', 'Aux In 4', 'Aux In 5', 'Aux In 6'];
      case AuxInPatch.A1_4: return ['Aes50 A 1', 'Aes50 A 2', 'Aes50 A 3', 'Aes50 A 4', 'Aux In 5', 'Aux In 6'];
      case AuxInPatch.A1_6: return ['Aes50 A 1', 'Aes50 A 2', 'Aes50 A 3', 'Aes50 A 4', 'Aes50 A 5', 'Aes50 A 6'];
      case AuxInPatch.B1_2: return ['Aes50 B 1', 'Aes50 B 2', 'Aux In 3', 'Aux In 4', 'Aux In 5', 'Aux In 6'];
      case AuxInPatch.B1_4: return ['Aes50 B 1', 'Aes50 B 2', 'Aes50 B 3', 'Aes50 B 4', 'Aux In 5', 'Aux In 6'];
      case AuxInPatch.B1_6: return ['Aes50 B 1', 'Aes50 B 2', 'Aes50 B 3', 'Aes50 B 4', 'Aes50 B 5', 'Aes50 B 6'];
    }

    const userIn = await this.resolveUserInBlock(0);

    switch (block) {
      case AuxInPatch.UserIn1_2: return [...userIn.slice(0, 2), 'Aux In 3', 'Aux In 4', 'Aux In 5', 'Aux In 6'];
      case AuxInPatch.UserIn1_4: return [...userIn.slice(0, 4), 'Aux In 5', 'Aux In 6'];
      default: return userIn.slice(0, 6);
    }
  }

  private async resolveUserInBlock(block: number): Promise<(string|null)[]> {
    const nodes = [...this.mixer.config.userrout.in].slice(block * 8, block * 8 + 8);
    const sources = await this.dispatcher.query(...nodes);
    return sources.map((source) => this.resolveUserIn(source));
  }

  private resolveUserIn(source?: UserInSource): string | null {
    if (source === undefined) {
      return null;
    } else if (source === UserInSource.Off) {
      return 'Off';
    } else if (source <= UserInSource.LocalIn32) {
      return `Local ${source - UserInSource.LocalIn1 + 1}`;
    } else if (source <= UserInSource.AES50A48) {
      return `Aes50 A ${source - UserInSource.AES50A1 + 1}`;
    } else if (source <= UserInSource.AES50B48) {
      return `Aes50 B ${source - UserInSource.AES50B1 + 1}`;
    } else if (source <= UserInSource.CardIn32) {
      return `Card ${source - UserInSource.CardIn1 + 1}`;
    } else if (source <= UserInSource.AuxIn6) {
      return `Aux In ${source - UserInSource.AuxIn1 + 1}`;
    } else if (source === UserInSource.TBInternal) {
      return 'Talkback Int';
    } else if (source === UserInSource.TBExternal) {
      return 'Talkback Ext';
    } else {
      return null;
    }
  }

  private async resolveUserOutBlock(block: number): Promise<(string|null)[]> {
    const nodes = [...this.mixer.config.userrout.out].slice(block * 8, block * 8 + 8);
    const dests = await this.dispatcher.query(...nodes);
    return Promise.all(dests.map((dest) => this.resolveUserOut(dest)));
  }

  private async resolveUserOut(dest?: UserOutDest): Promise<string | null> {
    if (dest === undefined) {
      return null;
    } else if (dest <= UserOutDest.TBExternal) {
      return this.resolveUserIn(dest as UserInSource);
    } else if (dest <= UserOutDest.Outputs16) {
      return this.resolveSingleOutput(this.mixer.outputs.main, dest - UserOutDest.Outputs1);
    } else if (dest <= UserOutDest.P16_16) {
      return this.resolveSingleOutput(this.mixer.outputs.p16, dest - UserOutDest.P16_1);
    } else if (dest <= UserOutDest.Aux6) {
      return this.resolveSingleOutput(this.mixer.outputs.aux, dest - UserOutDest.Aux1);
    } else {
      return dest === UserOutDest.MonitorL ? 'Monitor L' : 'Monitor R';
    }
  }

  private async resolveName(ch: { config: { name: StringValue } }, fallback: string): Promise<string> {
    const name = await this.dispatcher.query(ch.config.name);
    return name !== undefined && name !== '' ? name : fallback;
  }
}

function genRange(base: number, label: string): string[] {
  return [...new Array(8).keys()].map((i) => `${label} ${i + base + 1}`);
}
