type Position = { cell: HTMLTableCellElement; row: number; column: number };
type TableGrid = {
  cells: Position[];
  slots: Position[][];
  rows: HTMLTableRowElement[];
  columns: number;
};

function grid(table: HTMLTableElement): TableGrid {
  const rows = Array.from(table.rows);
  const slots = rows.map(() => [] as Position[]);
  const cells: Position[] = [];
  for (const [row, tr] of rows.entries()) {
    let column = 0;
    for (const cell of Array.from(tr.cells)) {
      while (slots[row][column]) column++;
      const position = { cell, row, column };
      cells.push(position);
      for (let y = row; y < Math.min(row + cell.rowSpan, rows.length); y++) {
        for (let x = column; x < column + cell.colSpan; x++) slots[y][x] = position;
      }
      column += cell.colSpan;
    }
  }
  return { cells, slots, rows, columns: Math.max(0, ...slots.map(row => row.length)) };
}

function emptyCell(tag: "td" | "th" = "td") {
  const cell = document.createElement(tag);
  cell.innerHTML = "<p><br></p>";
  return cell;
}

export function newBlogTable(rows: number, columns: number) {
  const table = document.createElement("table");
  const body = table.createTBody();
  for (let y = 0; y < rows; y++) {
    const row = body.insertRow();
    for (let x = 0; x < columns; x++) row.append(emptyCell(y ? "td" : "th"));
  }
  return table;
}

function insertAt(model: TableGrid, row: number, column: number, cell = emptyCell()) {
  const next = model.cells.find(position => position.row === row && position.column >= column);
  if (next) next.cell.before(cell);
  else model.rows[row].append(cell);
}

export function changeBlogTable(
  selected: HTMLTableCellElement,
  action: string,
  span = { rows: 1, columns: 2 },
) {
  const current = selected.closest("table");
  const currentRow = selected.parentElement as HTMLTableRowElement;
  if (!current) throw new Error("表のセルにカーソルを置いてください。");
  const table = current.cloneNode(true) as HTMLTableElement;
  const model = grid(table);
  const position = model.cells.find(item => item.row === currentRow.rowIndex && item.cell.cellIndex === selected.cellIndex);
  if (!position) throw new Error("選択したセルを確認してください。");
  const { cell, row, column } = position;

  switch (action) {
    case "table-delete":
      return { current, html: "<p><br></p>" };
    case "header": {
      const replacement = emptyCell(cell.tagName === "TH" ? "td" : "th");
      replacement.innerHTML = cell.innerHTML;
      replacement.rowSpan = cell.rowSpan;
      replacement.colSpan = cell.colSpan;
      cell.replaceWith(replacement);
      break;
    }
    case "row-add": {
      if (model.rows.length >= 20) throw new Error("表は20行まで追加できます。");
      const at = row + cell.rowSpan;
      const inserted = table.insertRow(at);
      const crossing = model.cells.filter(item => item.row < at && item.row + item.cell.rowSpan > at);
      crossing.forEach(item => item.cell.rowSpan++);
      for (let x = 0; x < model.columns; x++)
        if (!crossing.some(item => x >= item.column && x < item.column + item.cell.colSpan)) inserted.append(emptyCell());
      break;
    }
    case "column-add": {
      if (model.columns >= 12) throw new Error("表は12列まで追加できます。");
      const at = column + cell.colSpan;
      const crossing = model.cells.filter(item => item.column < at && item.column + item.cell.colSpan > at);
      crossing.forEach(item => item.cell.colSpan++);
      for (let y = 0; y < model.rows.length; y++)
        if (!crossing.some(item => y >= item.row && y < item.row + item.cell.rowSpan)) insertAt(model, y, at);
      break;
    }
    case "row-delete": {
      if (model.rows.length === 1) return { current, html: "<p><br></p>" };
      for (const item of model.cells.filter(item => item.row <= row && item.row + item.cell.rowSpan > row)) {
        if (item.cell.rowSpan === 1) continue;
        item.cell.rowSpan--;
        if (item.row === row) insertAt(model, row + 1, item.column, item.cell);
      }
      table.deleteRow(row);
      break;
    }
    case "column-delete": {
      if (model.columns === 1) return { current, html: "<p><br></p>" };
      for (const item of model.cells.filter(item => item.column <= column && item.column + item.cell.colSpan > column)) {
        if (item.cell.colSpan > 1) item.cell.colSpan--;
        else item.cell.remove();
      }
      break;
    }
    case "split": {
      const { rowSpan, colSpan } = cell;
      cell.colSpan = cell.rowSpan = 1;
      for (let y = row; y < row + rowSpan; y++) {
        for (let x = column; x < column + colSpan; x++) {
          if (x === column && y === row) continue;
          const next = model.cells.find(item => item.row === y && item.column > column);
          if (next) next.cell.before(emptyCell());
          else model.rows[y].append(emptyCell());
        }
      }
      break;
    }
    case "merge": {
      const bottom = row + span.rows, right = column + span.columns;
      const selected = new Set<Position>();
      for (let y = row; y < bottom; y++) {
        for (let x = column; x < right; x++) {
          const target = model.slots[y]?.[x];
          if (!target || target.row < row || target.column < column ||
            target.row + target.cell.rowSpan > bottom || target.column + target.cell.colSpan > right)
            throw new Error("現在のセルから右下へ結合する範囲を確認してください。");
          selected.add(target);
        }
      }
      for (const target of selected) {
        if (target.cell === cell) continue;
        if (target.cell.textContent?.trim() || target.cell.querySelector("img")) cell.append(...target.cell.childNodes);
        target.cell.remove();
      }
      cell.rowSpan = span.rows;
      cell.colSpan = span.columns;
      break;
    }
    default: throw new Error("表の操作を選択してください。");
  }
  return { current, html: table.outerHTML };
}
