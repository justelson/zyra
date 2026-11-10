import { installDesktopTui, removeDesktopTui } from './desktop-tui-install.mjs';

const [action, ...args] = process.argv.slice(2);
const value = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
try {
  const options = { channel: value('channel'), version: value('version'), directory: value('package') };
  if (!options.version) throw new Error('A Desktop version is required.');
  const result = action === 'install'
    ? await installDesktopTui({ ...options, directory: value('package') })
    : action === 'remove' ? await removeDesktopTui(options) : (() => { throw new Error('Unknown terminal installation action.'); })();
  console.log(JSON.stringify(result));
} catch (error) { console.error(error.message); process.exitCode = 1; }
