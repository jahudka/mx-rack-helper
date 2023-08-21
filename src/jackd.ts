import { exec } from 'child_process';

export async function getCapturePorts(): Promise<number[]> {
  const output = await asyncExec('jack_lsp');
  const lines = output.matchAll(/^system:capture_(\d+)$/gm);
  return [...lines].map((match) => parseInt(match[1], 10)).sort((a, b) => a - b);
}

export async function setAlias(port: number, alias: string | null): Promise<void> {
  const cmd = typeof alias === 'string'
    ? `jack_alias system:capture_${port} ${alias}`
    : `jack_alias -u system:capture_${port}`;

  await asyncExec(cmd);
}

async function asyncExec(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { encoding: 'utf-8' }, (error, stdout) => {
      error ? reject(error) : resolve(stdout);
    });
  });
}
