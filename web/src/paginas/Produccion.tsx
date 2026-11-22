// Producción y costos (Fase 5): órdenes de producción generadas del plan o a
// mano, vales de surtido, avance por etapa, cierre con costo real y balance de
// masa y piezas, trazabilidad por lote, sobrantes, variaciones, rendimiento y
// estado de costo de producción y ventas. Los botones se muestran según
// permisos; el servidor valida de nuevo permisos, alcance y tolerancias.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Group, Modal, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from "@mantine/core";
import { descargar, GET, POST, textoError } from "../api";
import { fecha, fechaHora, fechaIso, numero } from "../formato";
import { useSesion } from "../sesion";

const $ = (v: string | number | null | undefined, d = 2) => {
  if (v === null || v === undefined || v === "") return "—";
  const x = Number(Number(v).toFixed(d)); // sin "-$0.00" por redondeo
  return `${x < 0 ? "-" : ""}$${numero(Math.abs(x), d)}`;
};
const cant = (v: string | number | null | undefined, d = 3) => (v === null || v === undefined || v === "" ? "—" : numero(v, Number(v) % 1 === 0 ? 0 : d));
const pct = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : `${numero(v, 2)} %`);
const COLOR: Record<string, string> = { LIBERADA: "blue", EN_PROCESO: "yellow", CERRADA: "green", CANCELADA: "gray" };
const Est = ({ e }: { e: string }) => <Badge color={COLOR[e] ?? "gray"} variant="light">{e === "EN_PROCESO" ? "En proceso" : e.charAt(0) + e.slice(1).toLowerCase()}</Badge>;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const hoyIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
const primeroDeMes = () => `${hoyIso().slice(0, 8)}01`;

function useRefrescar() {
  const qc = useQueryClient();
  return () => ["p-ordenes", "p-orden", "p-opciones", "p-sobrantes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
const useOpciones = () => useQuery({ queryKey: ["p-opciones"], queryFn: () => GET("/api/produccion/opciones") });

function Periodo({ desde, hasta, onChange }: { desde: string; hasta: string; onChange: (d: string, h: string) => void }) {
  const [d, setD] = useState(fecha(desde));
  const [h, setH] = useState(fecha(hasta));
  return (
    <Group align="flex-end">
      <TextInput label="Desde" w={130} value={d} onChange={(e) => setD(e.currentTarget.value)} placeholder="DD/MM/AAAA" />
      <TextInput label="Hasta" w={130} value={h} onChange={(e) => setH(e.currentTarget.value)} placeholder="DD/MM/AAAA" />
      <Button variant="default" onClick={() => { const a = fechaIso(d); const b = fechaIso(h); if (a && b) onChange(a, b); }}>Consultar</Button>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------
function Generar() {
  const op = useOpciones();
  const refrescar = useRefrescar();
  const [plan, setPlan] = useState<string | null>(null);
  const [manual, setManual] = useState({ articulo: null as string | null, cantidad: "", fecha: "", almacen: null as string | null, comentario: "" });
  const gen = useMutation({ mutationFn: () => POST(`/api/produccion/planes/${plan}/generar`, {}), onSuccess: refrescar });
  const alta = useMutation({
    mutationFn: () => POST("/api/produccion/ordenes", { articulo: manual.articulo, cantidad: manual.cantidad, fecha: manual.fecha ? fechaIso(manual.fecha) : null, almacen: manual.almacen, comentario: manual.comentario || null }),
    onSuccess: () => { setManual({ ...manual, cantidad: "", comentario: "" }); refrescar(); },
  });
  const planes = (op.data?.planes ?? []).filter((p: any) => !p.ordenes);
  const peps = (op.data?.almacenes ?? []).filter((a: any) => a.tipo === "PEP");
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Card withBorder>
        <Text fw={600}>Generar órdenes de un plan aprobado</Text>
        <Text size="xs" c="dimmed" mb="sm">Crea una orden por cada masa o intermedio a preparar (en kg) y por cada producto (en piezas), con la receta y el estándar congelados.</Text>
        <Group align="flex-end">
          <Select label="Plan" w={260} data={planes.map((p: any) => ({ value: p.id, label: `${p.folio} · ${fecha(p.fecha)}` }))} value={plan} onChange={setPlan} placeholder={planes.length ? "Elige el plan" : "No hay planes pendientes"} />
          <Button disabled={!plan} loading={gen.isPending} onClick={() => gen.mutate()}>Generar órdenes</Button>
        </Group>
        {gen.error && <Alert mt="xs" color="red">{textoError(gen.error)}</Alert>}
        {gen.data && <Alert mt="xs" color="green">Plan {gen.data.plan}: se liberaron {gen.data.ordenes.length} órdenes ({gen.data.ordenes[0]} a {gen.data.ordenes.at(-1)}).</Alert>}
      </Card>
      <Card withBorder>
        <Text fw={600}>Orden manual</Text>
        <Text size="xs" c="dimmed" mb="sm">Para un pedido especial, un reproceso o producción fuera del plan.</Text>
        <Group align="flex-end">
          <Select label="Masa o producto" searchable w={240} data={(op.data?.articulos ?? []).map((a: any) => ({ value: a.clave, label: `${a.clave} · ${a.nombre}` }))} value={manual.articulo} onChange={(v) => setManual({ ...manual, articulo: v })} />
          <TextInput label={`Cantidad${manual.articulo ? ` (${(op.data?.articulos ?? []).find((a: any) => a.clave === manual.articulo)?.unidad ?? ""})` : ""}`} w={110} value={manual.cantidad} onChange={(e) => setManual({ ...manual, cantidad: e.currentTarget.value })} />
          <TextInput label="Fecha" placeholder="Hoy" w={120} value={manual.fecha} onChange={(e) => setManual({ ...manual, fecha: e.currentTarget.value })} />
          <Select label="Producción en proceso" w={160} data={peps.map((a: any) => a.clave)} value={manual.almacen ?? peps[0]?.clave ?? null} onChange={(v) => setManual({ ...manual, almacen: v })} />
          <TextInput label="Comentario" w={200} value={manual.comentario} onChange={(e) => setManual({ ...manual, comentario: e.currentTarget.value })} />
          <Button loading={alta.isPending} onClick={() => alta.mutate()} disabled={!manual.articulo || !manual.cantidad}>Liberar</Button>
        </Group>
        {alta.error && <Alert mt="xs" color="red">{textoError(alta.error)}</Alert>}
        {alta.data && <Alert mt="xs" color="green">Orden {alta.data.folio} liberada.</Alert>}
      </Card>
    </SimpleGrid>
  );
}

function Ordenes() {
  const op = useOpciones();
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState({ estatus: null as string | null, plan: null as string | null });
  const r = useQuery({ queryKey: ["p-ordenes", f], queryFn: () => GET(`/api/produccion/ordenes?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])}`) });
  const abierta = params.get("orden");
  const ver = op.data?.ver_costos;
  return (
    <Stack>
      {op.data?.puede.crear && <Generar />}
      <Group align="flex-end">
        <Select label="Estatus" w={160} clearable data={[{ value: "LIBERADA", label: "Liberada" }, { value: "EN_PROCESO", label: "En proceso" }, { value: "CERRADA", label: "Cerrada" }, { value: "CANCELADA", label: "Cancelada" }]} value={f.estatus} onChange={(v) => setF({ ...f, estatus: v })} />
        <Select label="Plan" w={220} clearable data={(op.data?.planes ?? []).map((p: any) => ({ value: p.id, label: `${p.folio} · ${fecha(p.fecha)}` }))} value={f.plan} onChange={(v) => setF({ ...f, plan: v })} />
      </Group>
      <ScrollArea>
        <Table withTableBorder striped highlightOnHover fz="sm">
          <Table.Thead><Table.Tr>
            <Table.Th>Folio</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Nivel</Table.Th><Table.Th>Producto</Table.Th><Table.Th>Estatus</Table.Th>
            <Table.Th ta="right">Planeado</Table.Th><Table.Th ta="right">Real</Table.Th>{ver && <><Table.Th ta="right">Costo real</Table.Th><Table.Th ta="right">Estándar</Table.Th></>}<Table.Th>Plan</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>{(r.data?.ordenes ?? []).map((o: any) => (
            <Table.Tr key={o.id} style={{ cursor: "pointer" }} onClick={() => setParams({ tab: "ordenes", orden: o.id })}>
              <Table.Td>{o.folio}{o.fuera_tolerancia && <Badge ml={4} size="xs" color="orange">fuera de tolerancia</Badge>}</Table.Td>
              <Table.Td>{fecha(o.fecha)}</Table.Td><Table.Td>{o.nivel === "N1" ? "Masa" : "Producto"}</Table.Td>
              <Table.Td>{o.articulo}<Text size="xs" c="dimmed">{o.nombre}</Text></Table.Td><Table.Td><Est e={o.estatus} /></Table.Td>
              <Table.Td ta="right">{cant(o.cantidad_plan)} {o.unidad}</Table.Td><Table.Td ta="right">{o.cantidad_real ? `${cant(o.cantidad_real)} ${o.unidad}` : ""}</Table.Td>
              {ver && <><Table.Td ta="right">{o.costo_unitario ? $(o.costo_unitario, 4) : ""}</Table.Td><Table.Td ta="right">{$(o.costo_estandar, 4)}</Table.Td></>}
              <Table.Td>{o.plan}</Table.Td>
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </ScrollArea>
      <Modal opened={!!abierta} onClose={() => setParams({ tab: "ordenes" })} size="90%" title="Orden de producción">
        {abierta && <DetalleOrden id={abierta} />}
      </Modal>
    </Stack>
  );
}

function imprimirOrden(d: any) {
  const o = d.orden;
  const w = window.open("", "_blank");
  if (!w) return;
  const comp = d.componentes.map((c: any) => `<tr><td>${esc(c.clave)}<br><small>${esc(c.nombre)}</small></td><td>${esc(c.tipo)}</td><td class="d">${cant(c.cantidad_estandar)} ${esc(c.unidad)}</td><td class="d">${cant(c.surtido)}</td><td class="d"></td></tr>`).join("");
  const etp = d.etapas.map((e: any) => `<tr><td>${esc(e.clave)} · ${esc(e.nombre)}</td><td class="d">${cant(e.minutos_estandar, 1)} min</td><td class="d"></td><td class="d"></td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.folio)}</title><style>body{font-family:system-ui,sans-serif;font-size:12px;margin:24px}table{width:100%;border-collapse:collapse;margin-bottom:12px}td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left}.d{text-align:right}h1{font-size:18px}</style></head><body>
    <h1>Orden de producción ${esc(o.folio)}</h1>
    <p><b>${esc(o.articulo)}</b> · ${esc(o.nombre)}<br><b>Fecha:</b> ${fecha(o.fecha)} · <b>Cantidad:</b> ${cant(o.cantidad_plan)} ${esc(o.unidad)}${o.lotes_plan ? ` (${cant(o.lotes_plan)} lotes)` : ""}${o.formadas_plan ? ` · ${cant(o.formadas_plan)} piezas a formar` : ""}<br><b>Almacén:</b> ${esc(o.almacen_pep)} · <b>Plan:</b> ${esc(o.plan ?? "manual")} · receta versión ${o.receta_version}</p>
    <table><thead><tr><th>Material</th><th>Tipo</th><th class="d">Estándar</th><th class="d">Surtido</th><th class="d">Usado real</th></tr></thead><tbody>${comp}</tbody></table>
    <table><thead><tr><th>Etapa</th><th class="d">Minutos estándar</th><th class="d">Minutos reales</th><th class="d">Merma y causa</th></tr></thead><tbody>${etp}</tbody></table>
    <p>Cantidad buena: ________ &nbsp; Piezas formadas: ________ &nbsp; Firma: ____________________</p>
    <script>window.print()</script></body></html>`);
  w.document.close();
}

function DetalleOrden({ id }: { id: string }) {
  const op = useOpciones();
  const r = useQuery({ queryKey: ["p-orden", id], queryFn: () => GET(`/api/produccion/ordenes/${id}`) });
  const [accion, setAccion] = useState<null | "surtir" | "avance" | "cerrar" | "cancelar">(null);
  const [aviso, setAviso] = useState<string | null>(null);
  if (!r.data) return r.error ? <Alert color="red">{textoError(r.error)}</Alert> : <Text>Cargando…</Text>;
  const d = r.data;
  const o = d.orden;
  const abiertaO = o.estatus === "LIBERADA" || o.estatus === "EN_PROCESO";
  const p = op.data?.puede ?? {};
  const ver = op.data?.ver_costos;
  const listo = (msg: string) => { setAviso(msg); setAccion(null); r.refetch(); };
  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs"><Title order={3}>{o.folio}</Title><Est e={o.estatus} />{o.fuera_tolerancia && <Badge color="orange">Fuera de tolerancia</Badge>}</Group>
          <Text>{o.articulo} · {o.nombre}</Text>
          <Text size="sm" c="dimmed">
            {o.nivel === "N1" ? "Masa o intermedio" : "Producto terminado"} · {fecha(o.fecha)} · planeado {cant(o.cantidad_plan)} {o.unidad}{o.lotes_plan ? ` (${cant(o.lotes_plan)} lotes)` : ""}{o.formadas_plan ? ` · ${cant(o.formadas_plan)} piezas a formar` : ""}
            {" "}· {o.almacen_pep} → {o.almacen_destino} · {o.plan ? `plan ${o.plan}` : "orden manual"} · receta v{o.receta_version} · liberó {o.liberada_por_usuario}
          </Text>
          {o.estatus === "CERRADA" && <Text size="sm">Cerró {o.cerrada_por_usuario} el {fechaHora(o.cerrada_en)} · {cant(o.cantidad_real)} {o.unidad}{o.piezas_formadas ? ` de ${cant(o.piezas_formadas)} formadas` : ""}{o.lote ? ` · lote ${o.lote}` : ""} · consumo {o.consumo} · entrada {o.entrada}</Text>}
          {o.estatus === "CANCELADA" && <Text size="sm" c="red">Cancelada por {o.cancelada_por_usuario}: {o.motivo_cancelacion}</Text>}
          {o.justificacion && <Text size="sm" c="orange">Justificación: {o.justificacion}</Text>}
        </div>
        <Group gap="xs">
          <Button variant="default" onClick={() => imprimirOrden(d)}>Imprimir hoja</Button>
          {abiertaO && p.surtir && <Button variant="light" onClick={() => setAccion("surtir")}>Vale de surtido</Button>}
          {abiertaO && p.avance && <Button variant="light" onClick={() => setAccion("avance")}>Registrar avance</Button>}
          {abiertaO && p.cerrar && <Button color="green" onClick={() => setAccion("cerrar")}>Cerrar orden</Button>}
          {abiertaO && p.cancelar && <Button color="red" variant="subtle" onClick={() => setAccion("cancelar")}>Cancelar</Button>}
        </Group>
      </Group>
      {aviso && <Alert color="green" withCloseButton onClose={() => setAviso(null)}>{aviso}</Alert>}
      {accion === "surtir" && <Surtir d={d} alTerminar={listo} />}
      {accion === "avance" && <Avance d={d} alTerminar={listo} />}
      {accion === "cerrar" && <Cerrar d={d} alTerminar={listo} />}
      {accion === "cancelar" && <Cancelar d={d} alTerminar={listo} />}

      {o.balance && <Balance b={o.balance} o={o} ver={ver} />}

      <Text fw={600}>Materiales</Text>
      <ScrollArea>
        <Table withTableBorder fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Material</Table.Th><Table.Th>Tipo</Table.Th><Table.Th ta="right">Estándar</Table.Th><Table.Th ta="right">Surtido</Table.Th><Table.Th ta="right">En producción</Table.Th><Table.Th ta="right">Real</Table.Th>{ver && <><Table.Th ta="right">Costo estándar</Table.Th><Table.Th ta="right">Importe real</Table.Th></>}</Table.Tr></Table.Thead>
          <Table.Tbody>{d.componentes.map((c: any) => (
            <Table.Tr key={c.clave}>
              <Table.Td>{c.clave}<Text size="xs" c="dimmed">{c.nombre}</Text></Table.Td><Table.Td>{c.tipo}</Table.Td>
              <Table.Td ta="right">{cant(c.cantidad_estandar)} {c.unidad}</Table.Td>
              <Table.Td ta="right">{["MASA", "INTERMEDIO"].includes(c.tipo) ? "de su orden" : cant(c.surtido)}</Table.Td>
              <Table.Td ta="right">{cant(c.en_pep)}</Table.Td><Table.Td ta="right">{cant(c.cantidad_real)}</Table.Td>
              {ver && <><Table.Td ta="right">{$(c.costo_unitario, 4)}</Table.Td><Table.Td ta="right">{c.importe ? $(c.importe) : ""}</Table.Td></>}
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </ScrollArea>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <div>
          <Text fw={600}>Etapas</Text>
          <Table withTableBorder fz="sm">
            <Table.Thead><Table.Tr><Table.Th>Etapa</Table.Th><Table.Th ta="right">Min. estándar</Table.Th><Table.Th ta="right">Min. reales</Table.Th>{ver && <Table.Th ta="right">Mano de obra</Table.Th>}</Table.Tr></Table.Thead>
            <Table.Tbody>{d.etapas.map((e: any) => <Table.Tr key={e.clave}><Table.Td>{e.clave}</Table.Td><Table.Td ta="right">{cant(e.minutos_estandar, 1)}</Table.Td><Table.Td ta="right">{cant(e.minutos_reales, 1)}</Table.Td>{ver && <Table.Td ta="right">{e.importe ? $(e.importe) : ""}</Table.Td>}</Table.Tr>)}</Table.Tbody>
          </Table>
        </div>
        <div>
          <Text fw={600}>Enlaces con otras órdenes</Text>
          {!d.depende.length && !d.abastece.length && <Text size="sm" c="dimmed">Sin enlaces.</Text>}
          {d.depende.map((x: any) => <Text key={x.id} size="sm" component="div">Toma {cant(x.cantidad)} de {x.articulo} de la orden {x.folio} (<Est e={x.estatus} />)</Text>)}
          {d.abastece.map((x: any) => <Text key={x.id} size="sm" component="div">Abastece {cant(x.cantidad)} a {x.articulo}, orden {x.folio} (<Est e={x.estatus} />)</Text>)}
        </div>
      </SimpleGrid>
      {!!d.avances.length && <>
        <Text fw={600}>Avance por etapa</Text>
        <Table withTableBorder fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Etapa</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Merma</Table.Th><Table.Th>Causa</Table.Th><Table.Th ta="right">Minutos</Table.Th><Table.Th>Registró</Table.Th><Table.Th>Comentario</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{d.avances.map((a: any, i: number) => <Table.Tr key={i}><Table.Td>{fechaHora(a.creado_en)}</Table.Td><Table.Td>{a.etapa}</Table.Td><Table.Td ta="right">{cant(a.cantidad)}</Table.Td><Table.Td ta="right">{cant(a.merma)}</Table.Td><Table.Td>{a.causa}</Table.Td><Table.Td ta="right">{cant(a.minutos, 1)}</Table.Td><Table.Td>{a.usuario}</Table.Td><Table.Td>{a.comentario}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </>}
      {!!d.vales.length && <>
        <Text fw={600}>Vales de surtido</Text>
        {d.vales.map((v: any) => <Text key={v.id} size="sm" td={v.cancelado ? "line-through" : undefined}>{v.folio} · desde {v.origen} · {v.usuario} · {fechaHora(v.creado_en)} · {v.comentario}</Text>)}
      </>}
      {!!d.lotes.length && <>
        <Text fw={600}>Lotes consumidos (trazabilidad)</Text>
        <Table withTableBorder fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Material</Table.Th><Table.Th>Lote</Table.Th><Table.Th>Caducidad</Table.Th><Table.Th ta="right">Cantidad</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{d.lotes.map((l: any, i: number) => <Table.Tr key={i}><Table.Td>{l.articulo}</Table.Td><Table.Td>{l.lote ?? "sin lote"}</Table.Td><Table.Td>{fecha(l.caducidad)}</Table.Td><Table.Td ta="right">{cant(l.cantidad)}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </>}
    </Stack>
  );
}

function Balance({ b, o, ver }: { b: any; o: any; ver: boolean }) {
  return (
    <Card withBorder bg={o.fuera_tolerancia ? "orange.0" : "green.0"}>
      <Text fw={600} mb="xs">Balance al cierre</Text>
      <SimpleGrid cols={{ base: 1, sm: ver ? 3 : 2 }}>
        {b.masa && <div>
          <Text size="sm" fw={600}>Masa {b.masa.dentro ? "✔" : "✖"}</Text>
          <Text size="sm">Usada {cant(b.masa.real)} kg contra {cant(b.masa.estandar)} kg estándar ({pct(b.masa.pct)})</Text>
        </div>}
        {b.piezas && <div>
          <Text size="sm" fw={600}>Piezas {b.piezas.dentro ? "✔" : "✖"}</Text>
          <Text size="sm">{cant(b.piezas.buenas)} buenas de {cant(b.piezas.formadas)} formadas; merma registrada {cant(b.piezas.merma)}. La masa usada debía rendir {cant(b.piezas.esperadas, 2)} ({pct(b.piezas.pct)}).</Text>
          {Number(b.piezas.sin_explicar) !== 0 && <Text size="sm" c="orange">Piezas sin explicar: {cant(b.piezas.sin_explicar)}</Text>}
        </div>}
        {ver && <div>
          <Text size="sm" fw={600}>Costo</Text>
          <Text size="sm">Materiales {$(o.costo_mp)} · mano de obra {$(o.costo_mod)} · indirectos {$(o.costo_gif)}</Text>
          <Text size="sm">Real {$(b.total.real)} contra estándar {$(b.total.estandar)} · variación <b>{$(b.total.variacion)}</b> ({pct(b.total.pct)})</Text>
          <Text size="sm">Por unidad: real {$(o.costo_unitario, 4)} · estándar {$(o.costo_estandar, 4)}</Text>
        </div>}
      </SimpleGrid>
      {!!b.fuera?.length && <Stack gap={0} mt="xs">{b.fuera.map((f: string) => <Text key={f} size="sm" c="orange">• {f}</Text>)}</Stack>}
      {!!b.avisos?.length && <Text size="xs" c="dimmed" mt="xs">Avisos: {b.avisos.join(" · ")}</Text>}
      {ver && <Table mt="xs" fz="xs" withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Material</Table.Th><Table.Th ta="right">Estándar</Table.Th><Table.Th ta="right">Real</Table.Th><Table.Th ta="right">%</Table.Th><Table.Th ta="right">Var. por cantidad</Table.Th><Table.Th ta="right">Var. por precio</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{b.consumos.map((c: any) => <Table.Tr key={c.clave} c={c.dentro ? undefined : "orange.8"}><Table.Td>{c.clave}</Table.Td><Table.Td ta="right">{cant(c.estandar)}</Table.Td><Table.Td ta="right">{cant(c.real)}</Table.Td><Table.Td ta="right">{pct(c.pct)}</Table.Td><Table.Td ta="right">{$(c.variacion_cantidad)}</Table.Td><Table.Td ta="right">{$(c.variacion_precio)}</Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>}
    </Card>
  );
}

function Surtir({ d, alTerminar }: { d: any; alTerminar: (m: string) => void }) {
  const op = useOpciones();
  const origenes = (op.data?.almacenes ?? []).filter((a: any) => a.tipo === "MP" || a.tipo === "INS");
  const [origen, setOrigen] = useState<string | null>(origenes[0]?.clave ?? null);
  const materiales = d.componentes.filter((c: any) => !["MASA", "INTERMEDIO"].includes(c.tipo));
  const [q, setQ] = useState<Record<string, string>>(() => Object.fromEntries(materiales.map((c: any) => [c.clave, String(Math.max(0, Number((Number(c.cantidad_estandar) - Number(c.surtido)).toFixed(3))))])));
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: () => POST(`/api/produccion/ordenes/${d.orden.id}/surtir`, { origen: origen ?? origenes[0]?.clave, motivo: motivo || null, renglones: Object.entries(q).filter(([, v]) => Number(v) > 0).map(([articulo, cantidad]) => ({ articulo, cantidad })) }),
    onSuccess: (x: any) => alTerminar(`Vale ${x.folio} registrado: el material pasó a producción en proceso.`),
  });
  if (!materiales.length) return <Alert color="blue">Esta orden no lleva materia prima: sus masas o intermedios salen de sus propias órdenes.</Alert>;
  return (
    <Card withBorder>
      <Text fw={600}>Vale de surtido</Text>
      <Text size="xs" c="dimmed" mb="xs">Se propone lo estándar que falta por surtir. Si pasas del estándar más la tolerancia, escribe el motivo.</Text>
      <Group align="flex-end" mb="xs"><Select label="Sale de" w={160} data={origenes.map((a: any) => a.clave)} value={origen} onChange={setOrigen} /></Group>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        {materiales.map((c: any) => <TextInput key={c.clave} label={`${c.clave} (${c.unidad})`} description={`estándar ${cant(c.cantidad_estandar)} · surtido ${cant(c.surtido)}`} value={q[c.clave] ?? ""} onChange={(e) => { const v = e.currentTarget.value; setQ((x) => ({ ...x, [c.clave]: v })); }} />)}
      </SimpleGrid>
      <TextInput mt="xs" label="Motivo (si pasa del estándar)" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
      {m.error && <Alert mt="xs" color="red">{textoError(m.error)}</Alert>}
      <Button mt="xs" loading={m.isPending} onClick={() => m.mutate()}>Surtir</Button>
    </Card>
  );
}

function Avance({ d, alTerminar }: { d: any; alTerminar: (m: string) => void }) {
  const op = useOpciones();
  const etapas = d.etapas.length ? d.etapas : (op.data?.etapas ?? []);
  const [x, setX] = useState({ etapa: etapas[0]?.clave ?? null, cantidad: "", merma: "", causa: null as string | null, minutos: "", comentario: "" });
  const conMerma = (op.data?.etapas ?? []).find((e: any) => e.clave === x.etapa)?.registra_merma;
  const m = useMutation({
    mutationFn: () => POST(`/api/produccion/ordenes/${d.orden.id}/avance`, { etapa: x.etapa, cantidad: x.cantidad || null, merma: x.merma || null, causa: x.causa, minutos: x.minutos || null, comentario: x.comentario || null }),
    onSuccess: () => alTerminar("Avance registrado."),
  });
  return (
    <Card withBorder>
      <Text fw={600}>Registrar avance</Text>
      <Group align="flex-end" mt="xs">
        <Select label="Etapa" w={200} data={(op.data?.etapas ?? []).map((e: any) => ({ value: e.clave, label: e.nombre }))} value={x.etapa} onChange={(v) => setX({ ...x, etapa: v })} />
        <TextInput label={d.orden.nivel === "N2" ? "Piezas que pasaron" : `Cantidad (${d.orden.unidad})`} w={140} value={x.cantidad} onChange={(e) => setX({ ...x, cantidad: e.currentTarget.value })} />
        {conMerma && <>
          <TextInput label="Merma" w={100} value={x.merma} onChange={(e) => setX({ ...x, merma: e.currentTarget.value })} />
          <Select label="Causa" w={160} data={(op.data?.causas ?? []).map((c: any) => ({ value: c.clave, label: c.nombre }))} value={x.causa} onChange={(v) => setX({ ...x, causa: v })} />
        </>}
        <TextInput label="Minutos" w={100} value={x.minutos} onChange={(e) => setX({ ...x, minutos: e.currentTarget.value })} />
        <TextInput label="Comentario" w={220} value={x.comentario} onChange={(e) => setX({ ...x, comentario: e.currentTarget.value })} />
        <Button loading={m.isPending} onClick={() => m.mutate()}>Registrar</Button>
      </Group>
      {!conMerma && <Text size="xs" c="dimmed" mt={4}>En esta etapa no se registra merma (catálogo de etapas).</Text>}
      {m.error && <Alert mt="xs" color="red">{textoError(m.error)}</Alert>}
    </Card>
  );
}

function Cerrar({ d, alTerminar }: { d: any; alTerminar: (m: string) => void }) {
  const o = d.orden;
  const [real, setReal] = useState(String(Number(o.cantidad_plan)));
  const [formadas, setFormadas] = useState("");
  const [just, setJust] = useState("");
  const ratio = Number(real) > 0 ? Number(real) / Number(o.cantidad_plan) : 0;
  const sugerido = useMemo(() => Object.fromEntries(d.componentes.map((c: any) => [c.clave, (Number(c.cantidad_estandar) * ratio).toFixed(3)])), [d.componentes, ratio]);
  const [consumo, setConsumo] = useState<Record<string, string>>({});
  const [minutos, setMinutos] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => POST(`/api/produccion/ordenes/${o.id}/cerrar`, {
      cantidad: real, piezas_formadas: formadas || null, justificacion: just || null,
      consumos: Object.entries(consumo).filter(([, v]) => v !== "").map(([articulo, cantidad]) => ({ articulo, cantidad })),
      minutos: Object.entries(minutos).filter(([, v]) => v !== "").map(([etapa, mins]) => ({ etapa, minutos: mins })),
    }),
    onSuccess: (x: any) => alTerminar(`Orden cerrada: entrada ${x.entrada}${x.costo_total ? ` por ${$(x.costo_total)} (${$(x.costo_unitario, 4)} por ${o.unidad})` : ""}.${x.fuera_tolerancia ? " Quedó marcada fuera de tolerancia." : ""}`),
  });
  const fueraTol = (m.error as any)?.datos?.error === "tolerancia";
  return (
    <Card withBorder>
      <Text fw={600}>Cerrar orden</Text>
      <Text size="xs" c="dimmed" mb="xs">Lo que dejes vacío se toma del estándar para la cantidad real (minutos: del avance si se capturaron). Se consume de producción en proceso y el producto entra a {o.almacen_destino} a su costo real.</Text>
      <Group align="flex-end">
        <TextInput label={o.nivel === "N2" ? "Piezas buenas" : `Producido (${o.unidad})`} w={140} value={real} onChange={(e) => setReal(e.currentTarget.value)} />
        {o.nivel === "N2" && <TextInput label="Piezas formadas" placeholder="buenas + merma" w={140} value={formadas} onChange={(e) => setFormadas(e.currentTarget.value)} />}
      </Group>
      <Text size="sm" fw={600} mt="sm">Consumo real</Text>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        {d.componentes.map((c: any) => <TextInput key={c.clave} label={`${c.clave} (${c.unidad})`} placeholder={sugerido[c.clave]} description={`en producción ${cant(c.en_pep)}`} value={consumo[c.clave] ?? ""} onChange={(e) => { const v = e.currentTarget.value; setConsumo((x) => ({ ...x, [c.clave]: v })); }} />)}
      </SimpleGrid>
      {!!d.etapas.length && <>
        <Text size="sm" fw={600} mt="sm">Minutos reales</Text>
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          {d.etapas.map((e: any) => <TextInput key={e.clave} label={e.clave} placeholder={(Number(e.minutos_estandar) * ratio).toFixed(1)} value={minutos[e.clave] ?? ""} onChange={(ev) => { const v = ev.currentTarget.value; setMinutos((x) => ({ ...x, [e.clave]: v })); }} />)}
        </SimpleGrid>
      </>}
      {m.error && <Alert mt="xs" color={fueraTol ? "orange" : "red"}>{textoError(m.error)}</Alert>}
      {(fueraTol || just) && <Textarea mt="xs" label="Justificación (obligatoria fuera de tolerancia)" value={just} onChange={(e) => setJust(e.currentTarget.value)} />}
      <Button mt="xs" color="green" loading={m.isPending} onClick={() => m.mutate()}>Cerrar orden</Button>
    </Card>
  );
}

function Cancelar({ d, alTerminar }: { d: any; alTerminar: (m: string) => void }) {
  const [motivo, setMotivo] = useState("");
  const m = useMutation({ mutationFn: () => POST(`/api/produccion/ordenes/${d.orden.id}/cancelar`, { motivo }), onSuccess: (x: any) => alTerminar(["Orden cancelada.", ...x.avisos].join(" ")) });
  return (
    <Card withBorder>
      <Textarea label="Motivo de la cancelación" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
      {m.error && <Alert mt="xs" color="red">{textoError(m.error)}</Alert>}
      <Button mt="xs" color="red" loading={m.isPending} onClick={() => m.mutate()}>Cancelar orden</Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trazabilidad y sobrantes
// ---------------------------------------------------------------------------
function Trazabilidad() {
  const [q, setQ] = useState("");
  const [buscar, setBuscar] = useState<string | null>(null);
  const r = useQuery({ queryKey: ["p-traza", buscar], enabled: !!buscar, queryFn: () => GET(`/api/produccion/trazabilidad?${/^OP-/i.test(buscar!) ? "orden" : "lote"}=${encodeURIComponent(buscar!)}`) });
  return (
    <Stack>
      <Group align="flex-end">
        <TextInput label="Lote o folio de orden (OP-…)" w={260} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <Button onClick={() => setBuscar(q.trim())} disabled={!q.trim()}>Rastrear</Button>
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {r.data && <>
        {!!r.data.lotes.length && <Text size="sm">Lote {r.data.lotes.map((l: any) => `${l.codigo} de ${l.articulo}${l.caducidad ? ` (caduca ${fecha(l.caducidad)})` : ""}`).join(", ")}</Text>}
        <Text fw={600}>Hacia atrás: de qué se hizo</Text>
        {!r.data.atras.length && <Text size="sm" c="dimmed">No salió de una orden de producción (es materia prima o empaque comprado): su origen está en la recepción de compra.</Text>}
        {!!r.data.atras.length && <Table withTableBorder fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Orden</Table.Th><Table.Th>Producto</Table.Th><Table.Th>Material</Table.Th><Table.Th>Lote</Table.Th><Table.Th>Caducidad</Table.Th><Table.Th ta="right">Cantidad</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{r.data.atras.map((x: any, i: number) => <Table.Tr key={i}><Table.Td>{x.folio}</Table.Td><Table.Td>{x.producto}</Table.Td><Table.Td>{x.material}</Table.Td><Table.Td>{x.lote ?? "—"}</Table.Td><Table.Td>{fecha(x.caducidad)}</Table.Td><Table.Td ta="right">{cant(x.cantidad)}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>}
        <Text fw={600}>Hacia adelante: en qué se usó</Text>
        <Table withTableBorder fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Orden</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Producto</Table.Th><Table.Th>Estatus</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th>Lote</Table.Th><Table.Th>Almacén</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{r.data.adelante.map((x: any, i: number) => <Table.Tr key={i}><Table.Td>{x.folio}</Table.Td><Table.Td>{fecha(x.fecha)}</Table.Td><Table.Td>{x.producto}</Table.Td><Table.Td><Est e={x.estatus} /></Table.Td><Table.Td ta="right">{cant(x.cantidad)}</Table.Td><Table.Td>{x.lote ?? "—"}</Table.Td><Table.Td>{x.almacen}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
        {!!r.data.salidas.length && <>
          <Text fw={600}>Salidas del producto (ventas, traspasos y mermas)</Text>
          <Table withTableBorder fz="sm"><Table.Tbody>{r.data.salidas.map((x: any, i: number) => <Table.Tr key={i}><Table.Td>{x.tipo}</Table.Td><Table.Td>{x.folio}</Table.Td><Table.Td>{fecha(x.fecha)}</Table.Td><Table.Td>{x.almacen}</Table.Td><Table.Td>{x.articulo}</Table.Td><Table.Td>{x.lote}</Table.Td><Table.Td ta="right">{cant(x.cantidad)}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
        </>}
      </>}
    </Stack>
  );
}

function Sobrantes() {
  const r = useQuery({ queryKey: ["p-sobrantes"], queryFn: () => GET("/api/produccion/sobrantes") });
  const op = useOpciones();
  return (
    <Stack>
      <Text size="sm" c="dimmed">Lo que quedó en producción en proceso. Las masas que no se reutilizan se registran como merma en Inventarios → Mermas; el material sobrante se usa en otra orden o se regresa cancelando su vale.</Text>
      <Table withTableBorder striped fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Almacén</Table.Th><Table.Th>Artículo</Table.Th><Table.Th ta="right">Cantidad</Table.Th>{op.data?.ver_costos && <Table.Th ta="right">Valor</Table.Th>}<Table.Th>Vence</Table.Th><Table.Th>Qué hacer</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.sobrantes ?? []).map((s: any) => (
          <Table.Tr key={`${s.almacen}-${s.clave}`}>
            <Table.Td>{s.almacen}</Table.Td><Table.Td>{s.clave}<Text size="xs" c="dimmed">{s.nombre}</Text></Table.Td><Table.Td ta="right">{cant(s.cantidad)} {s.unidad}</Table.Td>
            {op.data?.ver_costos && <Table.Td ta="right">{$(s.valor)}</Table.Td>}
            <Table.Td>{s.vence ? <Text size="sm" c={s.vencido ? "red" : undefined}>{fechaHora(s.vence)}</Text> : ""}</Table.Td><Table.Td>{s.accion}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------
function Variaciones() {
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso() });
  const r = useQuery({ queryKey: ["p-var", p], queryFn: () => GET(`/api/produccion/variaciones?desde=${p.desde}&hasta=${p.hasta}`) });
  const [err, setErr] = useState<string | null>(null);
  const total = (r.data?.ordenes ?? []).reduce((s: number, o: any) => s + Number(o.variacion ?? 0), 0);
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Periodo desde={p.desde} hasta={p.hasta} onChange={(desde, hasta) => setP({ desde, hasta })} />
        <Button variant="default" onClick={() => descargar(`/api/produccion/variaciones?desde=${p.desde}&hasta=${p.hasta}&formato=xlsx`, `variaciones-${p.desde}-${p.hasta}.xlsx`).catch((e) => setErr(textoError(e)))}>Exportar a Excel</Button>
      </Group>
      {err && <Alert color="red">{err}</Alert>}
      <Text size="sm">Órdenes cerradas por fecha de producción. Variación total del periodo: <b>{$(total)}</b> (positiva = costó más que el estándar).</Text>
      <ScrollArea>
        <Table withTableBorder striped fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Orden</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Producto</Table.Th><Table.Th ta="right">Real</Table.Th><Table.Th ta="right">Materiales</Table.Th><Table.Th ta="right">Mano de obra</Table.Th><Table.Th ta="right">Indirectos</Table.Th><Table.Th ta="right">Costo real</Table.Th><Table.Th ta="right">Estándar</Table.Th><Table.Th ta="right">Variación</Table.Th><Table.Th>Justificación</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(r.data?.ordenes ?? []).map((o: any) => (
            <Table.Tr key={o.id}>
              <Table.Td style={{ whiteSpace: "nowrap" }}>{o.folio}{o.fuera_tolerancia && <Badge ml={4} size="xs" color="orange">fuera</Badge>}</Table.Td><Table.Td>{fecha(o.fecha)}</Table.Td><Table.Td>{o.articulo}</Table.Td>
              <Table.Td ta="right">{cant(o.cantidad_real)} {o.unidad}</Table.Td><Table.Td ta="right">{$(o.costo_mp)}</Table.Td><Table.Td ta="right">{$(o.costo_mod)}</Table.Td><Table.Td ta="right">{$(o.costo_gif)}</Table.Td>
              <Table.Td ta="right">{$(o.costo_total)}</Table.Td><Table.Td ta="right">{$(o.total_estandar)}</Table.Td><Table.Td ta="right" c={Number(o.variacion) > 0.005 ? "red" : undefined}>{$(o.variacion)}</Table.Td><Table.Td>{o.justificacion}</Table.Td>
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </ScrollArea>
      <Text fw={600}>Por material</Text>
      <Table withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Material</Table.Th><Table.Th ta="right">Estándar</Table.Th><Table.Th ta="right">Real</Table.Th><Table.Th ta="right">Importe estándar</Table.Th><Table.Th ta="right">Importe real</Table.Th><Table.Th ta="right">Var. por cantidad</Table.Th><Table.Th ta="right">Var. por precio</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.materiales ?? []).map((x: any) => <Table.Tr key={x.clave}><Table.Td>{x.clave}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td><Table.Td ta="right">{cant(x.estandar)} {x.unidad}</Table.Td><Table.Td ta="right">{cant(x.real)}</Table.Td><Table.Td ta="right">{$(x.importe_estandar)}</Table.Td><Table.Td ta="right">{$(x.importe_real)}</Table.Td><Table.Td ta="right">{$(x.variacion_cantidad)}</Table.Td><Table.Td ta="right">{$(x.variacion_precio)}</Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>
    </Stack>
  );
}

function Rendimiento() {
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso() });
  const r = useQuery({ queryKey: ["p-rend", p], queryFn: () => GET(`/api/produccion/rendimiento?desde=${p.desde}&hasta=${p.hasta}`) });
  const { puede } = useSesion();
  const [err, setErr] = useState<string | null>(null);
  const tabla = (titulo: string, cols: [string, string, boolean?][], filas: any[]) => (
    <div>
      <Text fw={600}>{titulo}</Text>
      <Table withTableBorder fz="sm">
        <Table.Thead><Table.Tr>{cols.map(([t, , der]) => <Table.Th key={t} ta={der ? "right" : undefined}>{t}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>{filas.map((f, i) => <Table.Tr key={i}>{cols.map(([t, k, der]) => <Table.Td key={t} ta={der ? "right" : undefined}>{der ? (k.endsWith("pct") ? pct(f[k]) : cant(f[k])) : f[k]}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
      </Table>
    </div>
  );
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Periodo desde={p.desde} hasta={p.hasta} onChange={(desde, hasta) => setP({ desde, hasta })} />
        {puede("produccion.ordenes:exportar") && <Button variant="default" onClick={() => descargar(`/api/produccion/rendimiento?desde=${p.desde}&hasta=${p.hasta}&formato=xlsx`, `rendimiento-${p.desde}-${p.hasta}.xlsx`).catch((e) => setErr(textoError(e)))}>Exportar a Excel</Button>}
      </Group>
      {err && <Alert color="red">{err}</Alert>}
      {r.data && <>
        {tabla("Por producto", [["Producto", "clave"], ["Órdenes", "ordenes", true], ["Planeado", "planeado", true], ["Real", "real", true], ["Formadas", "formadas", true], ["Merma", "merma", true], ["Cumplimiento", "cumplimiento_pct", true]], r.data.productos)}
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          {tabla("Merma por etapa y causa", [["Etapa", "etapa"], ["Causa", "causa"], ["Producto", "producto"], ["Merma", "merma", true]], r.data.por_causa)}
          {tabla("Por persona (quien registró el avance)", [["Usuario", "usuario"], ["Cantidad", "cantidad", true], ["Merma", "merma", true], ["Merma", "merma_pct", true]], r.data.por_persona)}
          {tabla("Por turno", [["Turno", "turno"], ["Órdenes", "ordenes", true], ["Piezas", "piezas", true], ["Merma", "merma", true]], r.data.por_turno)}
        </SimpleGrid>
      </>}
    </Stack>
  );
}

function EstadoCostos() {
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso(), sucursal: null as string | null });
  const r = useQuery({ queryKey: ["p-estado", p], queryFn: () => GET(`/api/produccion/estado-costos?desde=${p.desde}&hasta=${p.hasta}${p.sucursal ? `&sucursal=${p.sucursal}` : ""}`) });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Stack maw={760}>
      <Group justify="space-between" align="flex-end">
        <Periodo desde={p.desde} hasta={p.hasta} onChange={(desde, hasta) => setP({ ...p, desde, hasta })} />
        <TextInput label="Sucursal (opcional)" w={140} placeholder="Todas" value={p.sucursal ?? ""} onChange={(e) => setP({ ...p, sucursal: e.currentTarget.value.trim().toUpperCase() || null })} />
        <Button variant="default" onClick={() => descargar(`/api/produccion/estado-costos?desde=${p.desde}&hasta=${p.hasta}${p.sucursal ? `&sucursal=${p.sucursal}` : ""}&formato=xlsx`, `estado-costos-${p.desde}-${p.hasta}.xlsx`).catch((e) => setErr(textoError(e)))}>Exportar a Excel</Button>
      </Group>
      {(err || r.error) && <Alert color="red">{err ?? textoError(r.error)}</Alert>}
      {r.data && <>
        <Card withBorder>
          <Text fw={700} ta="center">Estado de costo de producción y de lo vendido</Text>
          <Text size="sm" c="dimmed" ta="center" mb="sm">Del {fecha(r.data.desde)} al {fecha(r.data.hasta)}{r.data.sucursal ? ` · sucursal ${r.data.sucursal}` : " · todas las sucursales"}</Text>
          <Table fz="sm">
            <Table.Tbody>{r.data.lineas.map((l: any) => (
              <Table.Tr key={l.concepto} fw={l.nivel === 0 ? 700 : undefined} bg={l.nivel === 0 ? "gray.0" : undefined}>
                <Table.Td pl={l.nivel === 0 ? undefined : "lg"}>{l.concepto}</Table.Td><Table.Td ta="right">{$(l.importe)}</Table.Td>
              </Table.Tr>
            ))}</Table.Tbody>
          </Table>
        </Card>
        <Stack gap={2}>
          {r.data.comprobaciones.map((c: any) => <Text key={c.concepto} size="sm" c={c.cuadra ? "green" : "red"}>{c.cuadra ? "✔" : "✖"} {c.concepto}{c.cuadra ? "" : `: diferencia ${$(c.diferencia)}`}</Text>)}
          <Text size="xs" c="dimmed">{r.data.contabilidad}</Text>
        </Stack>
      </>}
    </Stack>
  );
}

export function Produccion() {
  const op = useOpciones();
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const ver = !!op.data?.ver_costos;
  const pestanas = [
    { v: "ordenes", t: "Órdenes", ok: true },
    { v: "trazabilidad", t: "Trazabilidad por lote", ok: true },
    { v: "sobrantes", t: "Sobrantes", ok: true },
    { v: "rendimiento", t: "Rendimiento y merma", ok: puede("produccion.ordenes:ver") },
    { v: "variaciones", t: "Variaciones", ok: ver },
    { v: "estado", t: "Estado de costos", ok: ver },
  ].filter((p) => p.ok);
  const tab = pestanas.some((p) => p.v === params.get("tab")) ? params.get("tab")! : "ordenes";
  return (
    <Stack>
      <Title order={2}>Producción</Title>
      <Tabs value={tab} onChange={(v) => setParams(v ? { tab: v } : {})} keepMounted={false}>
        <Tabs.List>{pestanas.map((p) => <Tabs.Tab key={p.v} value={p.v}>{p.t}</Tabs.Tab>)}</Tabs.List>
        <Tabs.Panel value="ordenes" pt="md"><Ordenes /></Tabs.Panel>
        <Tabs.Panel value="trazabilidad" pt="md"><Trazabilidad /></Tabs.Panel>
        <Tabs.Panel value="sobrantes" pt="md"><Sobrantes /></Tabs.Panel>
        <Tabs.Panel value="rendimiento" pt="md"><Rendimiento /></Tabs.Panel>
        <Tabs.Panel value="variaciones" pt="md"><Variaciones /></Tabs.Panel>
        <Tabs.Panel value="estado" pt="md"><EstadoCostos /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
