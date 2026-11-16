export function blogPhotoTape(key: string) {
  let hash = 0;
  for (const character of key) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return {
    "--tape-url": `url(/images/tapes/asset${hash % 70 + 1}.svg)`,
    "--tape-rotate": `${Math.floor(hash / 70) % 41 * 0.5 - 10}deg`,
  };
}
