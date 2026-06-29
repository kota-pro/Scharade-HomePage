import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findAppRoot(startDir: string) {
  let currentDir = startDir;

  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return process.cwd();
}

export function getDataDir(moduleUrl: string) {
  const configuredDir = process.env.DATA_DIR?.trim();
  if (configuredDir) {
    return path.resolve(configuredDir);
  }

  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const appRoot = findAppRoot(moduleDir);
  return path.join(appRoot, ".data");
}
