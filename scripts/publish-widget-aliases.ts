import { copyFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface AliasDefinition {
  from: string;
  to: string;
}

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = resolve(ROOT_DIR, 'dist');

const ALIASES: AliasDefinition[] = [
  {
    from: 'ims-growth-calculator.iife.js',
    to: 'webflow-growth-calculator.js'
  },
  {
    from: 'ims-growth-calculator.iife.js',
    to: 'widget.latest.js'
  },
  {
    from: 'scene-runtime.iife.js',
    to: 'scene.latest.js'
  }
];

async function main(): Promise<void> {
  await rm(resolve(DIST_DIR, 'widget'), { recursive: true, force: true });

  for (const alias of ALIASES) {
    await copyFile(
      resolve(DIST_DIR, alias.from),
      resolve(DIST_DIR, alias.to)
    );
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
