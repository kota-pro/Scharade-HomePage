/** Count Unicode code points rather than UTF-16 halves. */
export const noticeDuration = (message: string) => Math.max(4000, Math.min(15000, 3000 + Array.from(message).length * 80));
