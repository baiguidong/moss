import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const quoteShell = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

// Native shells cannot source files inside Electron's asar. Materialize the
// startup hooks per terminal and remove them when that terminal stops.
export function prepareTerminalShell(launch) {
  if (!launch.startup) return launch;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-terminal-'));
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  const write = (name, contents) => {
    const filename = path.join(directory, name);
    fs.writeFileSync(filename, `${contents}\n`, { mode: 0o600 });
    return filename;
  };
  const env = { ...launch.env };
  let args = launch.args;
  try {
    if (path.basename(launch.shell) === 'zsh') {
      // Keep the real login/interactive profile order, including global files.
      // Each user profile sees its original ZDOTDIR and may change it normally.
      for (const name of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
        const restore = `if [ "$_moss_zdotdir_set" = 1 ]; then
  export ZDOTDIR="$_moss_user_zdotdir"
else
  unset ZDOTDIR
fi`;
        const initial = name === '.zshenv'
          ? `_moss_zdotdir_set=${Object.hasOwn(env, 'ZDOTDIR') ? 1 : 0}\n_moss_user_zdotdir=${quoteShell(env.ZDOTDIR || '')}\n`
          : '';
        const source = `${restore}\nif [ -f "\${ZDOTDIR-$HOME}/${name}" ]; then
  source "\${ZDOTDIR-$HOME}/${name}"
fi`;
        const next = name === '.zlogin'
          ? `unset _moss_zdotdir_set _moss_user_zdotdir\n${launch.startup}`
          : `_moss_zdotdir_set=\${+ZDOTDIR}\n_moss_user_zdotdir=\${ZDOTDIR-}\nexport ZDOTDIR=${quoteShell(directory)}`;
        write(name, `${initial}${source}\n${next}`);
      }
      env.ZDOTDIR = directory;
    } else if (path.basename(launch.shell) === 'bash') {
      // Bash ignores --rcfile for login shells. Source its login profiles from
      // an interactive rcfile, then apply Moss's paths in the same shell.
      const filename = write('bashrc', `[ ! -f /etc/profile ] || . /etc/profile
for _moss_profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -f "$_moss_profile" ]; then
    . "$_moss_profile"
    break
  fi
done
unset _moss_profile
${launch.startup}`);
      args = ['--noprofile', '--rcfile', filename, '-i'];
    } else {
      // POSIX interactive shells read ENV after their login profiles.
      env.ENV = write('profile', `${Object.hasOwn(env, 'ENV') ? `export ENV=${quoteShell(env.ENV)}` : 'unset ENV'}
if [ -n "\${ENV-}" ] && [ -f "$ENV" ]; then . "$ENV"; fi
${launch.startup}`);
    }
    return { ...launch, args, env, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
