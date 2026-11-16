/** Explicit sizes and pixel hotspots keep SVG cursors usable in all three engines. */
const cursor = (
  body: string,
  viewBox: string,
  x: number,
  y: number,
  fallback = "crosshair",
) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="${viewBox}" color="#171717">${body}</svg>`)}") ${x} ${y}, ${fallback}`;
export const layoutToolCursors: Record<string, string> = {
  select: cursor(
    '<path fill="currentColor" d="m20.42 11.09l-15-7c-.38-.18-.83-.1-1.13.2s-.38.75-.2 1.13l7 15c.17.35.52.58.91.58h.06c.41-.02.76-.29.89-.68l1.84-5.53l5.53-1.84c.39-.13.66-.48.68-.89s-.2-.79-.58-.96Zm-6.74 1.96c-.3.1-.53.33-.63.63l-1.21 3.62L7.07 7.07l10.23 4.78l-3.62 1.21Z"/>',
    "0 0 24 24",
    5,
    5,
    "default",
  ),
  direct: cursor(
    '<path fill="currentColor" d="m20.42 11.09l-15-7a.99.99 0 0 0-1.13.2c-.3.3-.38.75-.2 1.13l7 15c.17.35.52.58.91.58h.06c.41-.02.76-.29.89-.68l1.84-5.53l5.53-1.84c.39-.13.66-.48.68-.89s-.2-.79-.58-.96Z"/>',
    "0 0 24 24",
    5,
    5,
    "default",
  ),
  draw: cursor(
    '<path fill="currentColor" d="m6.95 14.93l4.24-5.66l8.49-7.07c.39-.39 1.04-.39 1.41 0l.71.71c.39.37.39 1.02 0 1.41l-7.07 8.49l-5.66 4.24zm1.41 2.83l-2.12-2.12l-2.83 1.41L2 21.29l2.12-2.12c.2-.17.51-.17.71 0c.17.2.17.51 0 .71L2.71 22l4.24-1.41z"/>',
    "0 0 24 24",
    2,
    22,
  ),
  anchor: cursor(
    '<circle cx="18" cy="18" r="4" fill="currentColor"/><path d="M18 30a11.893 11.893 0 0 1-4.104-.72l.684-1.88A9.973 9.973 0 0 0 18 28z" fill="currentColor"/><path d="M22.148 29.264l-.691-1.877a9.956 9.956 0 0 0 2.997-1.748l1.292 1.527a11.953 11.953 0 0 1-3.598 2.098z" fill="currentColor"/><path d="M10.29 27.195a12.014 12.014 0 0 1-2.68-3.187l1.73-1.003a10.024 10.024 0 0 0 2.235 2.658z" fill="currentColor"/><path d="M28.413 23.967l-1.734-.996a9.916 9.916 0 0 0 1.176-3.264l1.971.34a11.896 11.896 0 0 1-1.413 3.92z" fill="currentColor"/><path d="M6.182 20.093a12.128 12.128 0 0 1-.004-4.163l1.97.342a10.121 10.121 0 0 0 .004 3.474z" fill="currentColor"/><path d="M27.845 16.234a9.902 9.902 0 0 0-1.196-3.257l1.729-1.006a11.903 11.903 0 0 1 1.436 3.912z" fill="currentColor"/><path d="M9.331 13.01L7.6 12.013a12.01 12.01 0 0 1 2.674-3.193l1.288 1.53a10.01 10.01 0 0 0-2.23 2.662z" fill="currentColor"/><path d="M24.41 10.324a9.96 9.96 0 0 0-3.01-1.731l.68-1.881a11.95 11.95 0 0 1 3.612 2.077z" fill="currentColor"/><path d="M14.562 8.606l-.688-1.877A12.103 12.103 0 0 1 18 6v2a10.088 10.088 0 0 0-3.438.606z" fill="currentColor"/><path d="M11 2H2v9h2V4h7V2z" fill="currentColor"/>',
    "0 0 32 32",
    0,
    0,
  ),
  text: "text",
  freehand: cursor(
    '<path d="M28.828 7.134a4.094 4.094 0 0 0-5.656 0L.343 29.962H9.59a4.968 4.968 0 0 0 3.536-1.465L28.828 12.79a3.998 3.998 0 0 0 0-5.656zM12.293 20.84l2.086-2.086l2.83 2.83l-2.087 2.085zm-.583 6.242a2.982 2.982 0 0 1-2.122.879H5.171l5.708-5.707l2.83 2.83zm15.704-15.707l-8.792 8.794l-2.83-2.83l8.794-8.792a2.047 2.047 0 0 1 2.828 0a2 2 0 0 1 0 2.828z" fill="currentColor"/><path d="M13 4H4v9h2V6h7V4z" fill="currentColor"/>',
    "0 0 32 32",
    0,
    0,
  ),
  ruler: cursor(
    '<path fill="currentColor" d="M128 28a100 100 0 1 0 100 100A100.11 100.11 0 0 0 128 28m4 191.91V184a4 4 0 0 0-8 0v35.91A92.13 92.13 0 0 1 36.09 132H72a4 4 0 0 0 0-8H36.09A92.13 92.13 0 0 1 124 36.09V72a4 4 0 0 0 8 0V36.09A92.13 92.13 0 0 1 219.91 124H184a4 4 0 0 0 0 8h35.91A92.13 92.13 0 0 1 132 219.91"/>',
    "0 0 256 256",
    12,
    12,
  ),
  shapes: "crosshair",
  image: "crosshair",
  pan: "grab",
};
export const layoutToolCursor = (tool: string) =>
  layoutToolCursors[tool] ?? layoutToolCursors.select;
