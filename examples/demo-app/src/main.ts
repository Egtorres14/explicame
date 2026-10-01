import "./style.css";
import { renderTable, type Report } from "./table";
import { mountDateFilter } from "./filter";

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = `
    <header><h1>Reportes</h1></header>
    <section class="toolbar" aria-label="Herramientas"></section>
    <table aria-label="Reportes de ventas">
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Total</th></tr></thead>
      <tbody></tbody>
    </table>`;
  const reports = (await (await fetch("/api/reports.json")).json()) as Report[];
  renderTable(app.querySelector("tbody")!, reports);
  mountDateFilter(app.querySelector<HTMLElement>(".toolbar")!, app.querySelector("tbody")!, reports);
}

void main();
