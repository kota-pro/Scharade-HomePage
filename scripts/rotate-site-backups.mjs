import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  root: { type: "string" },
  protect: { type: "string", multiple: true },
  apply: { type: "string" },
} });

const { root, protect = [], apply } = values;
if (!root || !isAbsolute(root) || !["backups", "scharade-backups"].includes(basename(resolve(root)))) {
  throw new Error("Use --root with an absolute path to the site's backups or scharade-backups directory.");
}
const directory = realpathSync(root);
if (directory !== resolve(root) || !lstatSync(directory).isDirectory()) throw new Error("Use the real backup directory, without symlinks.");

const generationName = /^(?:before-\d{8}$|(?:before-|site-backup-|brotli-support-|shell-security-|security-dependencies-|session-|login-copy-)[\w.-]*20\d{6}[\w.-]*$)/;
const settingsBackup = /^(?:before-new-drive-secret|security-privilege-keys)-20\d{6}(?:-\d{6})?\.env$/;
const entries = readdirSync(directory, { withFileTypes: true });
const candidates = entries.filter(entry => entry.isDirectory() && generationName.test(entry.name) || entry.isFile() && settingsBackup.test(entry.name))
  .map(entry => {
    const { ino, mtimeMs } = lstatSync(join(directory, entry.name));
    return { name: entry.name, directory: entry.isDirectory(), ino, mtimeMs };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));

if (directory.endsWith("/scharade-backups") && !protect.length) throw new Error("Specify the first site backup with --protect before rotating server backups.");
for (const name of protect) if (!candidates.some(entry => entry.name === name)) throw new Error(`Protected generation was not found: ${name}`);

const retained = new Set([...protect, ...candidates.filter(entry => entry.directory && !protect.includes(entry.name)).slice(0, 5).map(entry => entry.name)]);
const remove = candidates.filter(entry => !retained.has(entry.name));
const checksum = createHash("sha256").update(JSON.stringify({ directory, candidates, protect })).digest("hex");
const plan = { directory, retained: [...retained], remove: remove.map(entry => entry.name), checksum };

if (apply !== undefined) {
  if (apply !== checksum) throw new Error("Backup list changed. Read the current plan before applying it.");
  for (const entry of remove) {
    const stat = lstatSync(join(directory, entry.name));
    if (stat.isSymbolicLink() || stat.ino !== entry.ino || stat.mtimeMs !== entry.mtimeMs) {
      throw new Error(`Backup changed while rotating: ${entry.name}`);
    }
  }
  for (const entry of remove) rmSync(join(directory, entry.name), { recursive: entry.directory });
}
process.stdout.write(`${JSON.stringify({ ...plan, applied: apply !== undefined }, null, 2)}\n`);
