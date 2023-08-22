import { encode, decode } from 'ini';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

export async function setPortAliases(configPath: string, aliases: (string | null)[]): Promise<void> {
  configPath = resolve(configPath);

  const config = decode(await readFile(configPath, 'utf-8'));
  const map = config.alias_in_JackIn;

  for (let i = 0; i < map.map_size; ++i) {
    map[`name${i}`] = aliases[i] ?? '';
  }

  await writeFile(configPath, encode(config));
}
