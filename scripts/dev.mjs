// Runs the game server and the web app together for local development.
//   npm run dev
import { spawn } from 'node:child_process';

const procs = [
  { name: 'server', color: 33, cmd: ['npm', 'run', 'dev', '-w', '@terrago/game-server'] },
  { name: 'web', color: 36, cmd: ['npm', 'run', 'dev', '-w', '@terrago/web'] },
];

const children = procs.map(({ name, color, cmd }) => {
  const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (d) =>
      d
        .toString()
        .split('\n')
        .filter(Boolean)
        .forEach((line) => out.write(prefix + line + '\n')),
    );
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let down = false;
function shutdown(code) {
  if (down) return;
  down = true;
  children.forEach((c) => c.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
