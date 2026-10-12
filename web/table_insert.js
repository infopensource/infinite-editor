// Keep the ribbon command format identical in the source and rich editors.
export function tableDimensions(command) {
  if (command === "table") return { rows: 2, columns: 2 };
  const match = /^table:(\d+)x(\d+)$/.exec(command);
  if (!match) return null;
  const rows = Number(match[1]);
  const columns = Number(match[2]);
  return Number.isInteger(rows) && rows >= 2 && rows <= 20
    && Number.isInteger(columns) && columns >= 1 && columns <= 12
    ? { rows, columns } : null;
}

export function tableMarkdown(rows, columns) {
  const row = (cells) => `| ${cells.join(" | ")} |`;
  return [
    row(Array.from({ length: columns }, (_, index) => `列 ${index + 1}`)),
    row(Array.from({ length: columns }, () => "---")),
    ...Array.from({ length: rows - 1 }, () => row(Array(columns).fill(""))),
  ].join("\n");
}
