import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const source = path.resolve("src/assets");
const output = path.resolve("public/media/site");
const cachePath = path.resolve(".image-manifest.json");
const old = JSON.parse(await fs.readFile(cachePath, "utf8").catch(() => "{}"));
const next = {};
async function visit(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await visit(file);
      continue;
    }
    if (!/\.(jpe?g|png|webp|avif)$/i.test(entry.name)) continue;
    const relative = path.relative(source, file);
    const buffer = await fs.readFile(file);
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const target = path.join(output, relative.replace(/\.[^.]+$/, ".webp"));
    next[relative] = hash;
    if (
      old[relative] === hash &&
      (
        await Promise.all(
          [
            target,
            target.replace(/\.webp$/, "-480.webp"),
            target.replace(/\.webp$/, "-1440.webp"),
          ].map((file) => fs.stat(file).catch(() => null)),
        )
      ).every(Boolean)
    )
      continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    for (const width of [480, 960, 1440]) {
      const destination =
        width === 960 ? target : target.replace(/\.webp$/, `-${width}.webp`);
      await sharp(buffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78, effort: 4 })
        .toFile(destination);
    }
  }
}
await visit(source);
await fs.mkdir("public/media/decorations", { recursive: true });
for (const [file, name] of [
  ["public/icons/advertising-background.svg", "advertising-background"],
  ["public/advertising/film-hole.svg", "film-hole"],
]) {
  const buffer = await fs.readFile(file),
    hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const target = `public/media/decorations/${name}.webp`;
  if (old[file] !== hash || !(await fs.stat(target).catch(() => null)))
    await sharp(buffer)
      .resize({ width: 1440, withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 })
      .toFile(target);
  next[file] = hash;
}
await fs.writeFile(cachePath, JSON.stringify(next, null, 2));
console.log(`Prepared site photos (480 / 960 / 1440px) and 2 decorations.`);
