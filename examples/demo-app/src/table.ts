export interface Report {
  fecha: string;
  cliente: string;
  total: number;
}

export function renderTable(tbody: HTMLTableSectionElement, rows: Report[]): void {
  tbody.innerHTML = rows
    .map((r) => `<tr><td>${r.fecha}</td><td>${r.cliente}</td><td>${r.total.toLocaleString("es-CO")}</td></tr>`)
    .join("");
}
