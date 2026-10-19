import type { GroupExportData, GroupExportSection } from "../lib/groupExport";
import { groupExportHeading } from "../lib/groupExport";
import { displayName, genderColors, gradeColors, nameParts } from "../lib/groupPresentation";
import { groupGradeLabel } from "../lib/groupingGrade";

const bodyFont = '"Zen Kurenaido", sans-serif';
const headingFont = '"Zen Old Mincho", serif';
const cardWidth = 360, gap = 24, margin = 28, nameWidth = cardWidth - 64;
const graphemes = (text: string) => [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)].map(s => s.segment);
function lines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const character of graphemes(paragraph)) {
      if (line && context.measureText(line + character).width > width) { result.push(line); line = ""; }
      line += character;
    }
    result.push(line);
  }
  return result;
}
function warningIcon(context: CanvasRenderingContext2D, x: number, y: number) {
  context.save(); context.translate(x, y); context.scale(1.2, 1.2);
  context.strokeStyle = "#fdeff2"; context.fillStyle = "#fdeff2"; context.lineWidth = 1.5;
  context.stroke(new Path2D("M5.312 10.762C8.23 5.587 9.689 3 12 3s3.77 2.587 6.688 7.762l.364.644c2.425 4.3 3.638 6.45 2.542 8.022S17.786 21 12.364 21h-.728c-5.422 0-8.134 0-9.23-1.572s.117-3.722 2.542-8.022z"));
  context.stroke(new Path2D("M12 8v5")); context.beginPath(); context.arc(12, 16, 1, 0, Math.PI * 2); context.fill(); context.restore();
}

/** Render the complete saved result; viewport size and horizontal scroll never crop the output. */
export async function createGroupPng(data: GroupExportData, selectedIndex?: number): Promise<Blob> {
  const sections = selectedIndex === undefined ? data.sections : [data.sections[selectedIndex]].filter(Boolean);
  if (!sections.length) throw new Error("班がありません。");
  await document.fonts.ready;
  const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
  if (!context) throw new Error("画像を作成できません。");
  const columns = Math.min(5, sections.length), width = margin * 2 + columns * cardWidth + (columns - 1) * gap;
  context.font = `24px ${headingFont}`;
  const titleLines = lines(context, data.title || "班分け", width - margin * 2);
  const top = margin + titleLines.length * 34 + 34;
  context.font = `20px ${bodyFont}`;
  const cards = sections.map(section => {
    const members = section.members.map(person => {
      const nameLines = lines(context, displayName(person), nameWidth);
      return { person, nameLines, height: nameLines.length * 30 + 42 };
    });
    return { section, members, height: 78 + members.reduce((sum, member) => sum + member.height + 10, 0) + 10 };
  });
  const rowHeights: number[] = [];
  cards.forEach((card, index) => { const row = Math.floor(index / columns); rowHeights[row] = Math.max(rowHeights[row] || 0, card.height); });
  const flagged = new Set(data.flaggedIds), hasWarnings = sections.some(s => s.members.some(p => flagged.has(p.id)));
  context.font = `15px ${bodyFont}`;
  const warningLines = lines(context, "色のついた名前は、指定を満たせていないか、前回と同じ班の組合せが残っています。", width - margin * 2 - 64);
  const legendTop = top + rowHeights.reduce((a, b) => a + b, 0) + gap * (rowHeights.length - 1) + 24;
  const height = legendTop + 78 + (hasWarnings ? 28 + Math.max(32, warningLines.length * 23) : 0) + margin;
  // Keep even large rosters within browser canvas limits; no group or name is discarded.
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(12_000_000 / (width * height)));
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  context.scale(scale, scale); context.fillStyle = "white"; context.fillRect(0, 0, width, height); context.textBaseline = "top";
  context.fillStyle = "#222"; context.font = `24px ${headingFont}`;
  titleLines.forEach((line, i) => context.fillText(line, margin, margin + 34 * i));
  context.font = `14px ${bodyFont}`; context.fillStyle = "#555"; context.fillText("確定済みの班分け", margin, top - 25);
  let rowTop = top;
  cards.forEach((card, index) => {
    if (index && index % columns === 0) rowTop += rowHeights[Math.floor(index / columns) - 1] + gap;
    drawCard(card, margin + (index % columns) * (cardWidth + gap), rowTop);
  });
  context.font = `15px ${bodyFont}`;
  const genderLegend = [{ label: "男性", color: "#99ccff" }, { label: "女性", color: "#ff99ff" }];
  const genderWidth = context.measureText("先頭の文字：").width + genderLegend.reduce((w, e) => w + context.measureText(e.label).width + 36, 0);
  let legendX = width - margin - genderWidth;
  context.fillStyle = "#444"; context.fillText("先頭の文字：", legendX, legendTop); legendX += context.measureText("先頭の文字：").width;
  for (const item of genderLegend) {
    context.fillStyle = item.color; context.beginPath(); context.arc(legendX + 6, legendTop + 8, 5, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#444"; context.fillText(item.label, legendX + 18, legendTop); legendX += context.measureText(item.label).width + 36;
  }
  const labels = ["4年以上", "3年生", "2年生", "1年生"];
  const gradeWidth = labels.reduce((sum, label) => sum + context.measureText(label).width + 18, 0) - 18;
  legendX = width - margin - gradeWidth;
  labels.forEach((label, index) => {
    context.fillStyle = "#444"; context.fillText(label, legendX, legendTop + 34);
    const size = context.measureText(label).width; context.fillStyle = gradeColors[String(4 - index) as keyof typeof gradeColors]!;
    context.fillRect(legendX, legendTop + 54, size, 3); legendX += size + 18;
  });
  if (hasWarnings) {
    const y = legendTop + 78; context.fillStyle = "#4b454b"; context.fillRect(margin, y, width - margin * 2, height - margin - y);
    warningIcon(context, margin + 10, y + 10); context.fillStyle = "#fdeff2";
    warningLines.forEach((line, i) => context.fillText(line, margin + 48, y + 12 + i * 23));
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    canvas.width = 0; canvas.height = 0;
    if (blob) resolve(blob); else reject(new Error("画像を作成できませんでした。"));
  }, "image/png"));

  function drawCard(card: { section: GroupExportSection; members: { person: GroupExportSection["members"][number]; nameLines: string[]; height: number }[]; height: number }, x: number, y: number) {
    context!.strokeStyle = "#bbb"; context!.lineWidth = 1; context!.strokeRect(x, y, cardWidth, card.height);
    context!.fillStyle = "#222"; context!.font = `24px ${headingFont}`; context!.fillText(groupExportHeading(card.section.number), x + 18, y + 18);
    context!.font = `15px ${bodyFont}`; const count = `${card.members.length}人`; context!.fillText(count, x + cardWidth - 18 - context!.measureText(count).width, y + 24);
    context!.fillStyle = "#333"; context!.fillRect(x + 18, y + 58, cardWidth - 36, 1);
    let memberTop = y + 76;
    for (const { person, nameLines, height } of card.members) {
      context!.fillStyle = flagged.has(person.id) ? "#fdeff2" : "#fafafa"; context!.fillRect(x + 18, memberTop, cardWidth - 36, height);
      context!.font = `20px ${bodyFont}`;
      nameLines.forEach((line, i) => {
        const lineY = memberTop + 10 + i * 30, lineX = x + 30;
        context!.fillStyle = "#111";
        if (i === 0) {
          const [first, rest] = nameParts(line); context!.fillStyle = genderColors[person.gender as keyof typeof genderColors] || "#111";
          context!.fillText(first, lineX, lineY); context!.fillStyle = "#111"; context!.fillText(rest, lineX + context!.measureText(first).width, lineY);
        } else context!.fillText(line, lineX, lineY);
        const color = gradeColors[person.grade];
        if (color) { context!.fillStyle = color; context!.fillRect(lineX, lineY + 24, context!.measureText(line).width, 3); }
      });
      context!.font = `14px ${bodyFont}`; context!.fillStyle = "#444";
      context!.fillText(`${groupGradeLabel(person.grade) || ""}${person.id === card.section.leaderId ? "　◎ 班長" : ""}`, x + 30, memberTop + height - 24);
      memberTop += height + 10;
    }
  }
}
