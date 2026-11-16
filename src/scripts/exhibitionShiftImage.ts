import { shiftDateLabel } from '../lib/exhibitionShiftPresentation.ts';
import type { ShiftAssignment, ShiftPerson, ShiftSlot } from '../lib/exhibitionShiftTypes.ts';

export async function createShiftPng(
  title: string,
  slots: ShiftSlot[],
  assignments: Pick<ShiftAssignment, 'slotId' | 'personId'>[],
  people: Pick<ShiftPerson, 'id' | 'name'>[],
): Promise<Blob> {
  const columns = new Map<string, ShiftSlot[]>();
  for (const slot of slots) {
    const day = columns.get(slot.date) ?? [];
    day.push(slot);
    columns.set(slot.date, day);
  }
  if (!columns.size) throw new Error('表示中の時間枠がありません。');
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('シフト表の画像を作成できませんでした。');

  const width = 224, margin = 24, gap = 8, dateHeight = 38;
  const totalWidth = margin * 2 + columns.size * width + (columns.size - 1) * gap;
  const font = '"Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
  const wrap = (value: string, maxWidth: number) => {
    const lines = [''];
    for (const char of value) {
      const last = lines.length - 1;
      const line = lines[last] + char;
      if (lines[last] && ctx.measureText(line).width > maxWidth) lines.push(char);
      else lines[last] = line;
    }
    return lines;
  };
  ctx.font = `bold 24px ${font}`;
  const heading = wrap(title + ' 展示シフト', totalWidth - margin * 2);
  const names = new Map(people.map(person => [person.id, person.name]));
  const assigned = new Map<string, string[]>();
  for (const assignment of assignments) {
    const list = assigned.get(assignment.slotId) ?? [];
    list.push(names.get(assignment.personId) ?? '担当者');
    assigned.set(assignment.slotId, list);
  }
  ctx.font = `16px ${font}`;
  const days = [...columns].map(([date, day]) => ({
    date,
    slots: day.map(slot => {
      const own = assigned.get(slot.id) ?? [];
      const seats = [0, 1].map(index => ({ vacant: !own[index], lines: wrap(own[index] ?? '担当者なし', width - 36) }));
      return { time: slot.start + '–' + slot.end, seats, height: 38 + seats.reduce((h, seat) => h + 20 * seat.lines.length + 8, 0) };
    }),
  }));
  const top = margin + heading.length * 31 + 12;
  const totalHeight = top + dateHeight + gap + margin + Math.max(...days.map(day => day.slots.reduce((h, slot) => h + slot.height + gap, 0)));
  const scale = Math.min(2, 8192 / Math.max(totalWidth, totalHeight), Math.sqrt(12_000_000 / (totalWidth * totalHeight)));
  canvas.width = Math.ceil(totalWidth * scale);
  canvas.height = Math.ceil(totalHeight * scale);
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';
  const rect = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const label = (value: string, x: number, y: number, size: number, color: string, bold = false) => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };
  rect('#fff', 0, 0, totalWidth, totalHeight);
  heading.forEach((line, index) => label(line, margin, margin + index * 31, 24, '#18342f', true));
  days.forEach((day, index) => {
    const x = margin + index * (width + gap);
    rect('#dceee9', x, top, width, dateHeight);
    label(day.date.slice(0, 4) + '年 ' + shiftDateLabel(day.date), x + 12, top + 10, 17, '#18342f', true);
    let y = top + dateHeight + gap;
    for (const slot of day.slots) {
      rect('#f1f5f4', x, y, width, slot.height);
      label(slot.time, x + 12, y + 9, 15, '#36524c', true);
      let seatY = y + 30;
      for (const seat of slot.seats) {
        const height = seat.lines.length * 20 + 4;
        rect(seat.vacant ? '#f8e5e5' : '#fff', x + 8, seatY, width - 16, height);
        seat.lines.forEach((line, lineIndex) => label(line, x + 18, seatY + 3 + lineIndex * 20, 16, seat.vacant ? '#7d3737' : '#20312e'));
        seatY += height + 4;
      }
      y += slot.height + gap;
    }
  });
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('シフト表の画像を作成できませんでした。'));
  }, 'image/png'));
}
