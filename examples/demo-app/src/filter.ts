import { renderTable, type Report } from "./table";

export function mountDateFilter(toolbar: HTMLElement, tbody: HTMLTableSectionElement, all: Report[]): void {
  toolbar.innerHTML = `
    <button type="button" data-testid="filtro-fecha">Filtrar por fecha</button>
    <dialog aria-label="Filtro por fecha">
      <form method="dialog">
        <label for="desde">Desde</label> <input id="desde" type="date" />
        <label for="hasta">Hasta</label> <input id="hasta" type="date" />
        <label for="agrupar">Agrupar por</label>
        <select id="agrupar"><option>Día</option><option>Semana</option><option>Mes</option></select>
        <button type="button" data-action="aplicar">Aplicar</button>
        <button type="button" data-action="guardar">Guardar como predeterminado</button>
      </form>
    </dialog>`;
  const dialog = toolbar.querySelector("dialog")!;
  toolbar.querySelector<HTMLButtonElement>('[data-testid="filtro-fecha"]')!.onclick = () => dialog.showModal();
  toolbar.querySelector<HTMLButtonElement>('[data-action="aplicar"]')!.onclick = () => {
    const desde = toolbar.querySelector<HTMLInputElement>("#desde")!.value;
    const hasta = toolbar.querySelector<HTMLInputElement>("#hasta")!.value;
    renderTable(tbody, all.filter((r) => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta)));
    dialog.close();
  };
  toolbar.querySelector<HTMLButtonElement>('[data-action="guardar"]')!.onclick = async () => {
    await fetch("/api/preferences", { method: "POST", body: JSON.stringify({ filtro: "fecha" }) });
  };
}
