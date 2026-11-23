// Capa de impresión del POS (diseño 3.5): el ticket es un documento neutro y
// cada adaptador lo convierte a su formato. Por ahora solo el adaptador de
// navegador (HTML de 80 mm + diálogo de impresión, o impresión directa con
// Chrome en modo kiosco --kiosk-printing). El adaptador ESC/POS para abrir el
// cajón se agrega cuando se confirme el modelo de impresora (P45).
import { fecha, fechaHora, numero } from "./formato";

export interface Ticket {
  folio: string; fecha: string; sucursal: string; caja: string; cajero: string; pedido?: string | null;
  renglones: { nombre: string; cantidad: string; unidad: string; precio: string; descuento: string; oferta?: string | null; importe: string }[];
  subtotal: string; ieps: string; iva: string; descuento: string; total: string; anticipo_aplicado?: string;
  pagos: { forma: string; importe: string; referencia: string | null }[]; recibido: string; cambio: string;
  /** Ticket hecho sin conexión: los impuestos se desglosan al sincronizar. */
  provisional?: boolean;
}

export interface Impresora {
  nombre: string;
  imprimir(t: Ticket | { titulo: string; lineas: [string, string][]; nota?: string }): Promise<void>;
  abrirCajon(): Promise<boolean>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const $ = (v: string | number) => `$${numero(v, 2)}`;
const cant = (v: string) => (Number(v) % 1 === 0 ? String(Number(v)) : numero(v, 3));

/** Separa en el ticket la oferta de fin del día del descuento autorizado con PIN. */
function lineasDescuento(r: Ticket["renglones"][number]): string {
  const oferta = Number(r.oferta ?? 0);
  const otro = Math.round((Number(r.descuento) - oferta) * 100) / 100;
  const linea = (t: string, v: number) => `<tr><td>&nbsp;&nbsp;${t}</td><td class="d">-${$(v)}</td></tr>`;
  return (oferta ? linea("Oferta de fin del día", oferta) : "") + (otro ? linea("Descuento autorizado", otro) : "");
}

function htmlTicket(t: Ticket): string {
  const filas = t.renglones.map((r) => `
    <tr><td colspan="2">${esc(r.nombre)}</td></tr>
    <tr><td>${cant(r.cantidad)} ${esc(r.unidad)} × ${$(r.precio)}</td><td class="d">${$(Number(r.importe) + Number(r.descuento))}</td></tr>${lineasDescuento(r)}`).join("");
  const pagos = t.pagos.map((p) => `<tr><td>${esc(p.forma)}${p.referencia ? ` (${esc(p.referencia)})` : ""}</td><td class="d">${$(p.importe)}</td></tr>`).join("");
  return `
    <div class="c"><b>${esc(t.sucursal)}</b><br>${esc(t.caja)}</div>
    <div>Folio: <b>${esc(t.folio)}</b><br>${fechaHora(t.fecha)}<br>Atendió: ${esc(t.cajero)}${t.pedido ? `<br>Pedido: ${esc(t.pedido)}` : ""}</div>
    <hr><table>${filas}</table><hr>
    ${t.provisional ? `<div class="c"><b>TICKET PROVISIONAL · SIN CONEXIÓN</b><br><small>El desglose de impuestos se registra al volver el internet.</small></div>` : ""}
    <table>
      ${Number(t.descuento) ? `<tr><td>Descuentos</td><td class="d">-${$(t.descuento)}</td></tr>` : ""}
      ${t.provisional ? "" : `<tr><td>Subtotal</td><td class="d">${$(t.subtotal)}</td></tr>
      ${Number(t.ieps) ? `<tr><td>IEPS</td><td class="d">${$(t.ieps)}</td></tr>` : ""}
      <tr><td>IVA</td><td class="d">${$(t.iva)}</td></tr>`}
      <tr class="t"><td>TOTAL</td><td class="d">${$(t.total)}</td></tr>
      ${pagos}
      <tr><td>Cambio</td><td class="d">${$(t.cambio)}</td></tr>
    </table>
    <hr><div class="c">¡Gracias por su compra!<br><small>Si requiere factura, dé hoy mismo sus datos fiscales y su correo con este ticket: la factura le llega por correo al día siguiente.</small></div>`;
}

function htmlSimple(d: { titulo: string; lineas: [string, string][]; nota?: string }) {
  return `<div class="c"><b>${esc(d.titulo)}</b></div><hr><table>${d.lineas.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="d">${esc(b)}</td></tr>`).join("")}</table><hr>${d.nota ? `<div class="c"><small>${esc(d.nota)}</small></div><hr>` : ""}<div class="c"><small>${fecha(new Date())}</small></div>`;
}

/** Adaptador de navegador: arma el HTML de 80 mm en un iframe oculto y llama a print(). */
/** Recibo de anticipo de un pedido (P64): no es comprobante fiscal. */
export function recibo(r: { folio: string; pedido: string; cliente_nombre: string; fecha_entrega: string; importe: string; forma: string; referencia?: string | null; total: string; anticipado: string; saldo: string; sucursal: string; cajero: string; leyenda: string }) {
  return {
    titulo: `RECIBO DE ANTICIPO ${r.folio}`,
    lineas: [["Sucursal", r.sucursal], ["Pedido", r.pedido], ["Cliente", r.cliente_nombre], ["Entrega", fecha(r.fecha_entrega)], ["Recibimos", $(r.importe)],
      ["Forma de pago", r.forma + (r.referencia ? ` (${r.referencia})` : "")], ["Total del pedido", $(r.total)], ["Anticipado a la fecha", $(r.anticipado)], ["Saldo", $(r.saldo)], ["Atendió", r.cajero]] as [string, string][],
    nota: r.leyenda,
  };
}

export const impresoraNavegador: Impresora = {
  nombre: "Navegador",
  async imprimir(t) {
    const cuerpo = "titulo" in t ? htmlSimple(t) : htmlTicket(t);
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(f);
    const doc = f.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: 80mm auto; margin: 3mm; }
      body { font-family: monospace; font-size: 12px; width: 74mm; margin: 0; }
      table { width: 100%; border-collapse: collapse; } td { vertical-align: top; } .d { text-align: right; white-space: nowrap; }
      .c { text-align: center; } .t td { font-weight: bold; font-size: 14px; } hr { border: 0; border-top: 1px dashed #000; }
    </style></head><body>${cuerpo}</body></html>`);
    doc.close();
    await new Promise((r) => setTimeout(r, 50));
    f.contentWindow!.focus();
    // Las pruebas automáticas de pantalla desactivan el diálogo de impresión.
    if (!(window as unknown as { __sinImpresion?: boolean }).__sinImpresion) f.contentWindow!.print();
    setTimeout(() => f.remove(), 1000);
  },
  async abrirCajon() {
    return false; // el navegador no abre el cajón; lo hará el adaptador ESC/POS (P45)
  },
};
