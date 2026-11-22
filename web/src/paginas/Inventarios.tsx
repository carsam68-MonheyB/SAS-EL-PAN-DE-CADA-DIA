// Inventarios (Fase 3): existencias valuadas, kárdex, alertas, entradas por
// compra, surtido a producción, entrada de producción, traspasos, mermas y
// conteos físicos. Los botones se muestran según permisos; el servidor valida
// de nuevo permiso, alcance por almacén, límites y segregación.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Badge, Button, Card, Group, Modal, MultiSelect, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { descargar, GET, POST, PUT, textoError } from "../api";
import { fecha, fechaHora, fechaIso, numero } from "../formato";
import { useSesion } from "../sesion";

const TIPO_MOV: Record<string, string> = {
  INICIAL: "Inventario inicial", ENTRADA_COMPRA: "Entrada por compra", ENTRADA_PRODUCCION: "Entrada de producción",
  SURTIDO_SALIDA: "Surtido (salida)", SURTIDO_ENTRADA: "Surtido (entrada)", TRASPASO_ENVIO: "Traspaso (envío)",
  TRASPASO_RECEPCION: "Traspaso (recepción)", MERMA: "Merma", AJUSTE_ENTRADA: "Ajuste (sobrante)", AJUSTE_SALIDA: "Ajuste (faltante)", CANCELACION: "Cancelación",
};
const ESTATUS_COLOR: Record<string, string> = { ENVIADO: "blue", RECIBIDO: "green", CANCELADO: "gray", POR_AUTORIZAR: "orange", APLICADA: "green", APLICADO: "green", RECHAZADA: "red", RECHAZADO: "red", CANCELADA: "gray", CAPTURA: "blue" };
const ESTATUS_TXT: Record<string, string> = { ENVIADO: "En tránsito", RECIBIDO: "Recibido", CANCELADO: "Cancelado", POR_AUTORIZAR: "Por autorizar", APLICADA: "Aplicada", APLICADO: "Aplicado", RECHAZADA: "Rechazada", RECHAZADO: "Rechazado", CANCELADA: "Cancelada", CAPTURA: "En captura" };
const Estatus = ({ e }: { e: string }) => <Badge color={ESTATUS_COLOR[e] ?? "gray"} variant="light">{ESTATUS_TXT[e] ?? e}</Badge>;
const cant = (v: string | number | null | undefined, d = 3) => (v === null || v === undefined || v === "" ? "" : numero(v, Number(v) % 1 === 0 ? 0 : d));
const Pesos = ({ v, d = 2 }: { v: string | number | null | undefined; d?: number }) =>
  v === null || v === undefined ? <Text span c="dimmed" size="xs">—</Text> : <>{Number(v) < 0 ? "-" : ""}${numero(Math.abs(Number(v)), d)}</>;

interface Opciones {
  almacenes: { clave: string; nombre: string; tipo: string; sucursal: string; mio: boolean }[];
  articulos: { clave: string; nombre: string; tipo: string; unidad: string; maneja_lote: boolean; maneja_caducidad: boolean; unidades: string[] }[];
  causas: { clave: string; nombre: string; aplica: string }[];
  proveedores: { clave: string; nombre: string }[];
  planes: { id: string; folio: string; fecha: string }[];
  entrada_sin_oc: boolean;
  entrada_produccion_directa: boolean;
}
const useOpciones = () => useQuery<Opciones>({ queryKey: ["inv-opciones"], queryFn: () => GET("/api/inventarios/opciones") });
const datosAlmacen = (o: Opciones | undefined, f: (a: Opciones["almacenes"][number]) => boolean) =>
  (o?.almacenes ?? []).filter(f).map((a) => ({ value: a.clave, label: `${a.clave} · ${a.nombre}` }));

function useRefrescar() {
  const qc = useQueryClient();
  return () => ["inv-existencias", "inv-alertas", "inv-movimientos", "inv-traspasos", "inv-mermas", "inv-conteos", "inv-kardex", "inv-doc"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

// ---------------------------------------------------------------------------
// Editor de renglones
// ---------------------------------------------------------------------------
interface Fila { articulo: string | null; cantidad: string; unidad: string | null; lote: string; caducidad: string; costo_unitario: string }
const filaVacia = (): Fila => ({ articulo: null, cantidad: "", unidad: null, lote: "", caducidad: "", costo_unitario: "" });

function Renglones({ filas, setFilas, tipos, entrada, costo, opciones }: { filas: Fila[]; setFilas: (f: Fila[]) => void; tipos: string[]; entrada?: boolean; costo?: boolean; opciones: Opciones }) {
  const arts = useMemo(() => new Map(opciones.articulos.map((a) => [a.clave, a])), [opciones]);
  const data = opciones.articulos.filter((a) => tipos.includes(a.tipo)).map((a) => ({ value: a.clave, label: `${a.clave} · ${a.nombre}` }));
  const cambiar = (i: number, c: Partial<Fila>) => setFilas(filas.map((f, j) => (j === i ? { ...f, ...c } : f)));
  return (
    <Stack gap={6}>
      {filas.map((f, i) => {
        const a = f.articulo ? arts.get(f.articulo) : undefined;
        return (
          <Group key={i} align="flex-end" gap="xs" wrap="wrap">
            <Select label={i === 0 ? "Artículo" : undefined} searchable w={300} data={data} value={f.articulo} onChange={(v) => cambiar(i, { articulo: v, unidad: v ? arts.get(v)!.unidad : null, lote: "", caducidad: "" })} />
            <TextInput label={i === 0 ? "Cantidad" : undefined} w={110} placeholder="0" value={f.cantidad} onChange={(e) => cambiar(i, { cantidad: e.currentTarget.value })} />
            <Select label={i === 0 ? "Unidad" : undefined} w={100} data={a ? [a.unidad, ...a.unidades.filter((u) => u !== a.unidad)] : []} value={f.unidad} allowDeselect={false} onChange={(v) => cambiar(i, { unidad: v })} />
            {a?.maneja_lote && <TextInput label="Lote" w={150} placeholder={entrada ? "Código del lote" : "Vacío = por caducidad"} value={f.lote} onChange={(e) => cambiar(i, { lote: e.currentTarget.value })} />}
            {entrada && a?.maneja_lote && a.maneja_caducidad && <TextInput label="Caducidad" w={120} placeholder="DD/MM/AAAA" value={f.caducidad} error={f.caducidad && !fechaIso(f.caducidad) ? "No válida" : undefined} onChange={(e) => cambiar(i, { caducidad: e.currentTarget.value })} />}
            {costo && <TextInput label={i === 0 ? "Costo unitario" : undefined} w={120} placeholder="$ por unidad" value={f.costo_unitario} onChange={(e) => cambiar(i, { costo_unitario: e.currentTarget.value })} />}
            {filas.length > 1 && <ActionIcon variant="subtle" color="red" mb={4} onClick={() => setFilas(filas.filter((_, j) => j !== i))}>✕</ActionIcon>}
          </Group>
        );
      })}
      <Button variant="default" size="xs" w={160} onClick={() => setFilas([...filas, filaVacia()])}>Agregar renglón</Button>
    </Stack>
  );
}
const cuerpoRenglones = (filas: Fila[]) => filas.filter((f) => f.articulo && f.cantidad).map((f) => ({
  articulo: f.articulo, cantidad: f.cantidad.trim(), unidad: f.unidad, lote: f.lote.trim() || null,
  caducidad: f.caducidad ? fechaIso(f.caducidad) : null, costo_unitario: f.costo_unitario.trim() || null,
}));

/** Formulario genérico de documento con renglones. */
function FormDoc({ titulo, ayuda, ruta, tipos, entrada, costo, encabezado, cuerpo, listo, exito }: {
  titulo: string; ayuda: string; ruta: string; tipos: string[]; entrada?: boolean; costo?: boolean;
  encabezado: React.ReactNode; cuerpo: () => Record<string, unknown>; listo: boolean; exito: (x: any) => string;
}) {
  const op = useOpciones();
  const refrescar = useRefrescar();
  const [filas, setFilas] = useState<Fila[]>([filaVacia()]);
  const [aviso, setAviso] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => POST(ruta, { ...cuerpo(), renglones: cuerpoRenglones(filas) }),
    onSuccess: (x) => { setAviso(exito(x)); setFilas([filaVacia()]); refrescar(); },
  });
  if (!op.data) return null;
  return (
    <Card withBorder>
      <Text fw={600}>{titulo}</Text>
      <Text size="xs" c="dimmed" mb="sm">{ayuda}</Text>
      <Stack gap="sm">
        {encabezado}
        <Renglones filas={filas} setFilas={setFilas} tipos={tipos} entrada={entrada} costo={costo} opciones={op.data} />
        <Group><Button loading={m.isPending} disabled={!listo || !cuerpoRenglones(filas).length} onClick={() => { setAviso(null); m.mutate(); }}>Registrar</Button></Group>
        {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
        {aviso && <Alert color="green">{aviso}</Alert>}
      </Stack>
    </Card>
  );
}

function Operaciones() {
  const { puede } = useSesion();
  const op = useOpciones();
  const [compra, setCompra] = useState({ almacen: null as string | null, proveedor: null as string | null, referencia: "", comentario: "" });
  const [surtido, setSurtido] = useState({ origen: null as string | null, destino: null as string | null, plan_id: null as string | null, comentario: "" });
  const [prod, setProd] = useState({ almacen: null as string | null, comentario: "" });
  const o = op.data;
  const sucursalDe = (clave: string | null) => o?.almacenes.find((a) => a.clave === clave)?.sucursal;
  const tipoProd = o?.almacenes.find((a) => a.clave === prod.almacen)?.tipo;
  const opciones = [
    puede("compras.recepcion:crear") && op.data?.entrada_sin_oc && "compra", puede("inventarios.surtido:crear") && "surtido", puede("produccion.ordenes:crear") && op.data?.entrada_produccion_directa && "produccion",
  ].filter(Boolean) as string[];
  const [cual, setCual] = useState<string | null>(null);
  const sel = cual ?? opciones[0] ?? null;
  if (!opciones.length) return <Text c="dimmed" size="sm">Tu puesto no registra surtidos ni entradas de producción aquí. Las compras se reciben en Compras → Órdenes de compra.</Text>;
  return (
    <Stack>
      <Select w={320} label="¿Qué vas a registrar?" allowDeselect={false} value={sel} onChange={setCual}
        data={[{ value: "compra", label: "Entrada por compra" }, { value: "surtido", label: "Surtido a producción (vale)" }, { value: "produccion", label: "Entrada de producción terminada" }].filter((x) => opciones.includes(x.value))} />
      {sel === "compra" && (
        <FormDoc titulo="Entrada por compra" ruta="/api/inventarios/compras" tipos={["INSUMO", "EMPAQUE"]} entrada costo
          ayuda="Entrada sin orden de compra (habilitada en Configuración solo para casos especiales); lo normal es recibir en Compras → Órdenes de compra. Puedes capturar en la unidad de compra (ej. BULTO): el sistema convierte a la unidad base y el costo también."
          listo={!!compra.almacen} cuerpo={() => compra} exito={(x) => `Se registró la entrada ${x.folio}.`}
          encabezado={(
            <Group align="flex-end">
              <Select label="Almacén" w={280} data={datosAlmacen(o, (a) => a.mio && ["MP", "INS"].includes(a.tipo))} value={compra.almacen} onChange={(v) => setCompra({ ...compra, almacen: v })} />
              <Select label="Proveedor" w={240} searchable clearable data={(o?.proveedores ?? []).map((p) => ({ value: p.clave, label: `${p.clave} · ${p.nombre}` }))} value={compra.proveedor} onChange={(v) => setCompra({ ...compra, proveedor: v })} />
              <TextInput label="Factura o remisión" w={180} value={compra.referencia} onChange={(e) => setCompra({ ...compra, referencia: e.currentTarget.value })} />
              <TextInput label="Comentario" w={260} value={compra.comentario} onChange={(e) => setCompra({ ...compra, comentario: e.currentTarget.value })} />
            </Group>
          )} />
      )}
      {sel === "surtido" && (
        <FormDoc titulo="Surtido a producción" ruta="/api/inventarios/surtidos" tipos={["INSUMO", "EMPAQUE", "INTERMEDIO"]}
          ayuda="Pasa materia prima del almacén al área de producción (producción en proceso) de la misma sucursal, al costo del inventario. Si no indicas lote, sale primero el que caduca antes. Para surtir una orden de producción contra su estándar, usa Producción → Órdenes → Vale de surtido."
          listo={!!surtido.origen && !!surtido.destino} cuerpo={() => surtido} exito={(x) => `Se registró el vale ${x.folio} (salida ${x.salida}, entrada ${x.entrada}).`}
          encabezado={(
            <Group align="flex-end">
              <Select label="Sale de" w={260} data={datosAlmacen(o, (a) => a.mio && ["MP", "INS"].includes(a.tipo))} value={surtido.origen} onChange={(v) => setSurtido({ ...surtido, origen: v, destino: null })} />
              <Select label="Entra a" w={260} data={datosAlmacen(o, (a) => a.tipo === "PEP" && a.sucursal === sucursalDe(surtido.origen))} value={surtido.destino} onChange={(v) => setSurtido({ ...surtido, destino: v })} />
              <Select label="Plan (opcional)" w={200} clearable data={(o?.planes ?? []).map((p) => ({ value: p.id, label: `${p.folio} · ${fecha(p.fecha)}` }))} value={surtido.plan_id} onChange={(v) => setSurtido({ ...surtido, plan_id: v })} />
              <TextInput label="Comentario" w={240} value={surtido.comentario} onChange={(e) => setSurtido({ ...surtido, comentario: e.currentTarget.value })} />
            </Group>
          )} />
      )}
      {sel === "produccion" && (
        <FormDoc titulo="Entrada de producción terminada" ruta="/api/inventarios/produccion" tipos={tipoProd === "PEP" ? ["INTERMEDIO"] : ["SKU"]}
          ayuda="Solo si se activó en Configuración (desde la Fase 5 la producción entra al cerrar su orden): registra las piezas buenas que entran a producto terminado (o masas a producción en proceso), valuadas al costo estándar de hoy. Requiere receta activa y costo completo."
          listo={!!prod.almacen} cuerpo={() => prod} exito={(x) => `Se registró la entrada ${x.folio}.`}
          encabezado={(
            <Group align="flex-end">
              <Select label="Almacén" w={300} data={datosAlmacen(o, (a) => a.mio && ["PT", "PEP"].includes(a.tipo))} value={prod.almacen} onChange={(v) => setProd({ ...prod, almacen: v })} />
              <TextInput label="Comentario" w={260} value={prod.comentario} onChange={(e) => setProd({ ...prod, comentario: e.currentTarget.value })} />
            </Group>
          )} />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Existencias, kárdex y alertas
// ---------------------------------------------------------------------------
function Kardex({ almacen, articulo, cerrar }: { almacen: string; articulo: string; cerrar: () => void }) {
  const { puede } = useSesion();
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const q = `almacen=${almacen}&articulo=${articulo}${fechaIso(desde) ? `&desde=${fechaIso(desde)}` : ""}${fechaIso(hasta) ? `&hasta=${fechaIso(hasta)}` : ""}`;
  const k = useQuery({ queryKey: ["inv-kardex", q], queryFn: () => GET(`/api/inventarios/kardex?${q}`) });
  const costos = puede("datos.costos:ver");
  return (
    <Modal opened onClose={cerrar} size="90%" title={k.data ? `Kárdex · ${k.data.articulo.clave} ${k.data.articulo.nombre} en ${k.data.almacen.clave} (${k.data.articulo.unidad})` : "Kárdex"}>
      <Group align="flex-end" mb="sm">
        <TextInput label="Desde" placeholder="DD/MM/AAAA" w={130} value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput label="Hasta" placeholder="DD/MM/AAAA" w={130} value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        {puede("inventarios.existencias:exportar") && <Button variant="default" onClick={() => descargar(`/api/inventarios/kardex?${q}&formato=xlsx`, `kardex-${almacen}-${articulo}.xlsx`)}>Exportar a Excel</Button>}
      </Group>
      {k.error && <Alert color="red">{textoError(k.error)}</Alert>}
      {k.data && (
        <ScrollArea>
          <Table withTableBorder striped fz="xs">
            <Table.Thead><Table.Tr>
              <Table.Th>Fecha</Table.Th><Table.Th>Folio</Table.Th><Table.Th>Movimiento</Table.Th><Table.Th>Lote</Table.Th>
              <Table.Th ta="right">Entrada</Table.Th><Table.Th ta="right">Salida</Table.Th><Table.Th ta="right">Saldo</Table.Th>
              {costos && <><Table.Th ta="right">Costo unit.</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">Saldo valor</Table.Th></>}
              <Table.Th>Usuario</Table.Th><Table.Th>Nota</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              <Table.Tr><Table.Td colSpan={6}><b>Saldo inicial</b></Table.Td><Table.Td ta="right"><b>{cant(k.data.saldo_inicial.saldo_cantidad)}</b></Table.Td>{costos && <><Table.Td /><Table.Td /><Table.Td ta="right"><Pesos v={k.data.saldo_inicial.saldo_valor} /></Table.Td></>}<Table.Td colSpan={2} /></Table.Tr>
              {k.data.renglones.map((r: any) => (
                <Table.Tr key={r.consecutivo} style={{ opacity: r.cancelado ? 0.55 : 1 }}>
                  <Table.Td>{fecha(r.fecha_negocio)}</Table.Td><Table.Td>{r.folio}</Table.Td><Table.Td>{TIPO_MOV[r.tipo] ?? r.tipo}{r.cancelado && <Badge ml={4} size="xs" color="gray">cancelado</Badge>}</Table.Td><Table.Td>{r.lote}</Table.Td>
                  <Table.Td ta="right">{Number(r.cantidad) > 0 ? cant(r.cantidad) : ""}</Table.Td><Table.Td ta="right">{Number(r.cantidad) < 0 ? cant(-Number(r.cantidad)) : ""}</Table.Td><Table.Td ta="right">{cant(r.saldo_cantidad)}</Table.Td>
                  {costos && <><Table.Td ta="right"><Pesos v={r.costo_unitario} d={4} /></Table.Td><Table.Td ta="right"><Pesos v={r.importe} /></Table.Td><Table.Td ta="right"><Pesos v={r.saldo_valor} /></Table.Td></>}
                  <Table.Td>{r.usuario}</Table.Td><Table.Td>{[r.causa, r.referencia, r.comentario, r.cancela && `Cancela ${r.cancela}`].filter(Boolean).join(" · ")}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Modal>
  );
}

function Existencias() {
  const { puede } = useSesion();
  const op = useOpciones();
  const [f, setF] = useState({ almacen: null as string | null, tipo: null as string | null, buscar: "" });
  const [kardex, setKardex] = useState<{ almacen: string; articulo: string } | null>(null);
  const q = new URLSearchParams(Object.entries({ almacen: f.almacen ?? "", tipo: f.tipo ?? "", buscar: f.buscar }).filter(([, v]) => v)).toString();
  const r = useQuery({ queryKey: ["inv-existencias", q], queryFn: () => GET(`/api/inventarios/existencias?${q}`) });
  const filas: any[] = r.data?.existencias ?? [];
  const total = filas.reduce((s, x) => s + Number(x.valor ?? 0), 0);
  return (
    <Stack>
      <Group align="flex-end">
        <Select label="Almacén" w={260} clearable data={datosAlmacen(op.data, (a) => a.mio)} value={f.almacen} onChange={(v) => setF({ ...f, almacen: v })} />
        <Select label="Tipo" w={160} clearable data={[{ value: "INSUMO", label: "Insumos" }, { value: "EMPAQUE", label: "Empaques" }, { value: "INTERMEDIO", label: "Masas e intermedios" }, { value: "SKU", label: "Productos" }]} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} />
        <TextInput label="Buscar" w={200} value={f.buscar} onChange={(e) => setF({ ...f, buscar: e.currentTarget.value })} />
        {puede("inventarios.existencias:exportar") && <Button variant="default" onClick={() => descargar(`/api/inventarios/existencias?${q}&formato=xlsx`, "existencias.xlsx")}>Exportar a Excel</Button>}
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {r.data && !filas.length && <Text size="sm" c="dimmed">No hay existencias registradas con ese filtro. El inventario arranca con la carga "Inventario inicial" (Cargas masivas).</Text>}
      {!!filas.length && (
        <ScrollArea>
          <Table withTableBorder striped highlightOnHover fz="sm">
            <Table.Thead><Table.Tr>
              <Table.Th>Almacén</Table.Th><Table.Th>Artículo</Table.Th><Table.Th ta="right">Existencia</Table.Th><Table.Th ta="right">En tránsito</Table.Th>
              {r.data.ver_costos && <><Table.Th ta="right">Costo promedio</Table.Th><Table.Th ta="right">Valor</Table.Th></>}
              <Table.Th ta="right">Mín. / reorden / máx.</Table.Th><Table.Th>Lotes</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {filas.map((x) => (
                <Table.Tr key={`${x.almacen}-${x.articulo}`} style={{ cursor: "pointer" }} onClick={() => setKardex({ almacen: x.almacen, articulo: x.articulo })}>
                  <Table.Td>{x.almacen}</Table.Td>
                  <Table.Td>{x.articulo}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td>
                  <Table.Td ta="right"><b>{cant(x.cantidad)}</b> {x.unidad} {x.alerta && <Badge size="xs" color={x.alerta === "MINIMO" ? "red" : "orange"}>{x.alerta === "MINIMO" ? "bajo mínimo" : "reordenar"}</Badge>}</Table.Td>
                  <Table.Td ta="right">{Number(x.en_transito) ? cant(x.en_transito) : ""}</Table.Td>
                  {r.data.ver_costos && <><Table.Td ta="right"><Pesos v={x.costo_promedio} d={4} /></Table.Td><Table.Td ta="right"><Pesos v={x.valor} /></Table.Td></>}
                  <Table.Td ta="right"><Text size="xs">{[x.minimo, x.reorden, x.maximo].map((v) => (v === null ? "—" : cant(v))).join(" / ")}</Text></Table.Td>
                  <Table.Td>{x.lotes.map((l: any) => (
                    <Tooltip key={l.lote} label={l.caducidad ? `Caduca ${fecha(l.caducidad)}` : "Sin caducidad"}>
                      <Badge mr={4} size="xs" variant="light" color={l.estado === "CADUCADO" ? "red" : l.estado === "POR_CADUCAR" ? "orange" : "gray"}>{l.lote}: {cant(l.cantidad)}</Badge>
                    </Tooltip>
                  ))}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {r.data.ver_costos && <Text size="sm" ta="right" mt="xs">Valor total del inventario mostrado: <b><Pesos v={total} /></b></Text>}
        </ScrollArea>
      )}
      <Text size="xs" c="dimmed">Haz clic en un renglón para ver su kárdex (todas las entradas y salidas con su saldo).</Text>
      {kardex && <Kardex {...kardex} cerrar={() => setKardex(null)} />}
    </Stack>
  );
}

function Alertas() {
  const r = useQuery({ queryKey: ["inv-alertas"], queryFn: () => GET("/api/inventarios/alertas") });
  if (r.error) return <Alert color="red">{textoError(r.error)}</Alert>;
  if (!r.data) return null;
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }}>
      <Card withBorder>
        <Text fw={600} mb="xs">Bajo mínimo o en punto de reorden</Text>
        {!r.data.existencias.length ? <Text size="sm" c="dimmed">Sin alertas.</Text> : (
          <Table fz="sm" striped>
            <Table.Thead><Table.Tr><Table.Th>Almacén</Table.Th><Table.Th>Artículo</Table.Th><Table.Th ta="right">Existencia</Table.Th><Table.Th ta="right">Mín. / reorden</Table.Th><Table.Th ta="right">Pedir (hasta máx.)</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{r.data.existencias.map((x: any) => (
              <Table.Tr key={`${x.almacen}-${x.articulo}`}>
                <Table.Td>{x.almacen}</Table.Td><Table.Td>{x.articulo}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td>
                <Table.Td ta="right">{cant(x.cantidad)} {x.unidad} <Badge size="xs" color={x.nivel === "MINIMO" ? "red" : "orange"}>{x.nivel === "MINIMO" ? "bajo mínimo" : "reordenar"}</Badge></Table.Td>
                <Table.Td ta="right">{cant(x.minimo) || "—"} / {cant(x.reorden) || "—"}</Table.Td><Table.Td ta="right">{x.sugerido !== null ? `${cant(x.sugerido)} ${x.unidad}` : "—"}</Table.Td>
              </Table.Tr>
            ))}</Table.Tbody>
          </Table>
        )}
      </Card>
      <Card withBorder>
        <Text fw={600} mb="xs">Lotes caducados o por caducar (próximos {r.data.dias} días)</Text>
        {!r.data.caducidades.length ? <Text size="sm" c="dimmed">Sin alertas.</Text> : (
          <Table fz="sm" striped>
            <Table.Thead><Table.Tr><Table.Th>Almacén</Table.Th><Table.Th>Artículo</Table.Th><Table.Th>Lote</Table.Th><Table.Th>Caducidad</Table.Th><Table.Th ta="right">Cantidad</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{r.data.caducidades.map((x: any) => (
              <Table.Tr key={`${x.almacen}-${x.articulo}-${x.lote}`}>
                <Table.Td>{x.almacen}</Table.Td><Table.Td>{x.articulo}</Table.Td><Table.Td>{x.lote}</Table.Td>
                <Table.Td>{fecha(x.caducidad)} <Badge size="xs" color={x.estado === "CADUCADO" ? "red" : "orange"}>{x.estado === "CADUCADO" ? "caducado" : "por caducar"}</Badge></Table.Td>
                <Table.Td ta="right">{cant(x.cantidad)} {x.unidad}</Table.Td>
              </Table.Tr>
            ))}</Table.Tbody>
          </Table>
        )}
      </Card>
    </SimpleGrid>
  );
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------
function Motivo({ etiqueta, color = "red", accion, cargando }: { etiqueta: string; color?: string; accion: (motivo: string) => void; cargando: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  if (!abierto) return <Button variant="light" color={color} onClick={() => setAbierto(true)}>{etiqueta}</Button>;
  return (
    <Group align="flex-end">
      <TextInput label="Motivo" w={300} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
      <Button color={color} loading={cargando} disabled={motivo.trim().length < 3} onClick={() => accion(motivo)}>Confirmar</Button>
      <Button variant="subtle" onClick={() => setAbierto(false)}>No</Button>
    </Group>
  );
}

const PERMISO_CANCELAR: Record<string, string> = {
  INICIAL: "inventarios.ajustes:cancelar", ENTRADA_COMPRA: "compras.recepcion:cancelar", ENTRADA_PRODUCCION: "produccion.ordenes:cancelar",
  SURTIDO_SALIDA: "inventarios.surtido:cancelar", SURTIDO_ENTRADA: "inventarios.surtido:cancelar", MERMA: "inventarios.ajustes:cancelar",
  AJUSTE_ENTRADA: "inventarios.ajustes:cancelar", AJUSTE_SALIDA: "inventarios.ajustes:cancelar",
};

function DetalleMovimiento({ id, cerrar }: { id: string; cerrar: () => void }) {
  const { puede } = useSesion();
  const refrescar = useRefrescar();
  const r = useQuery({ queryKey: ["inv-doc", "mov", id], queryFn: () => GET(`/api/inventarios/movimientos/${id}`) });
  const cancelar = useMutation({ mutationFn: (motivo: string) => POST(`/api/inventarios/movimientos/${id}/cancelar`, { motivo }), onSuccess: refrescar });
  const m = r.data;
  return (
    <Modal opened onClose={cerrar} size="xl" title={m ? `${m.folio} · ${TIPO_MOV[m.tipo] ?? m.tipo}` : "Movimiento"}>
      {m && (
        <Stack>
          <Text size="sm">{m.almacen} · {m.almacen_nombre} · {fechaHora(m.fecha)} · {m.usuario} · método {m.metodo === "PEPS" ? "PEPS" : "costo promedio"}</Text>
          {(m.proveedor || m.referencia || m.comentario || m.plan) && <Text size="sm" c="dimmed">{[m.proveedor && `Proveedor ${m.proveedor}`, m.referencia, m.plan && `Plan ${m.plan}`, m.comentario].filter(Boolean).join(" · ")}</Text>}
          {m.cancela && <Alert color="gray">Este movimiento cancela a {m.cancela}.</Alert>}
          {m.cancelado_por && <Alert color="gray">Cancelado por {m.cancelado_por}.</Alert>}
          <Table fz="sm" withTableBorder striped>
            <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Lote</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Costo unit.</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{m.renglones.map((x: any, i: number) => (
              <Table.Tr key={i}><Table.Td>{x.articulo}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td><Table.Td>{x.lote}{x.caducidad && <Text size="xs" c="dimmed">cad. {fecha(x.caducidad)}</Text>}</Table.Td>
                <Table.Td ta="right">{cant(x.cantidad)} {x.unidad}</Table.Td><Table.Td ta="right"><Pesos v={x.costo_unitario} d={4} /></Table.Td><Table.Td ta="right"><Pesos v={x.importe} /></Table.Td></Table.Tr>
            ))}</Table.Tbody>
          </Table>
          {!m.cancelado_por && PERMISO_CANCELAR[m.tipo] && puede(PERMISO_CANCELAR[m.tipo]!) && (
            <Card withBorder>
              <Text size="xs" c="dimmed" mb="xs">Cancelar registra un movimiento inverso (nada se borra). Lo que entró sale de nuevo y lo que salió regresa con su mismo costo. Un vale de surtido o un ajuste de conteo se cancelan completos.</Text>
              <Motivo etiqueta="Cancelar movimiento" accion={(x) => cancelar.mutate(x)} cargando={cancelar.isPending} />
            </Card>
          )}
          {cancelar.error && <Alert color="red">{textoError(cancelar.error)}</Alert>}
          {cancelar.data && <Alert color="green">Cancelado con {cancelar.data.cancelaciones.join(", ")}.</Alert>}
        </Stack>
      )}
    </Modal>
  );
}

function Movimientos() {
  const op = useOpciones();
  const [f, setF] = useState({ almacen: null as string | null, tipo: null as string | null, desde: "", hasta: "" });
  const [ver, setVer] = useState<string | null>(null);
  const q = new URLSearchParams(Object.entries({ almacen: f.almacen ?? "", tipo: f.tipo ?? "", desde: fechaIso(f.desde) ?? "", hasta: fechaIso(f.hasta) ?? "" }).filter(([, v]) => v)).toString();
  const r = useQuery({ queryKey: ["inv-movimientos", q], queryFn: () => GET(`/api/inventarios/movimientos?${q}`) });
  return (
    <Stack>
      <Group align="flex-end">
        <Select label="Almacén" w={240} clearable data={datosAlmacen(op.data, (a) => a.mio)} value={f.almacen} onChange={(v) => setF({ ...f, almacen: v })} />
        <Select label="Tipo" w={220} clearable data={Object.entries(TIPO_MOV).map(([value, label]) => ({ value, label }))} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} />
        <TextInput label="Desde" placeholder="DD/MM/AAAA" w={120} value={f.desde} onChange={(e) => setF({ ...f, desde: e.currentTarget.value })} />
        <TextInput label="Hasta" placeholder="DD/MM/AAAA" w={120} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.currentTarget.value })} />
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      <ScrollArea>
        <Table withTableBorder striped highlightOnHover fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Almacén</Table.Th><Table.Th ta="right">Renglones</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Usuario</Table.Th><Table.Th>Nota</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(r.data?.movimientos ?? []).map((m: any) => (
            <Table.Tr key={m.id} style={{ cursor: "pointer", opacity: m.cancelado ? 0.55 : 1 }} onClick={() => setVer(m.id)}>
              <Table.Td>{m.folio}</Table.Td><Table.Td>{fechaHora(m.fecha)}</Table.Td><Table.Td>{TIPO_MOV[m.tipo] ?? m.tipo}{m.cancelado && <Badge ml={4} size="xs" color="gray">cancelado</Badge>}</Table.Td>
              <Table.Td>{m.almacen}</Table.Td><Table.Td ta="right">{m.renglones}</Table.Td><Table.Td ta="right"><Pesos v={m.importe} /></Table.Td><Table.Td>{m.usuario}</Table.Td>
              <Table.Td>{[m.referencia, m.comentario, m.cancela && `Cancela ${m.cancela}`].filter(Boolean).join(" · ")}</Table.Td>
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </ScrollArea>
      {ver && <DetalleMovimiento id={ver} cerrar={() => setVer(null)} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Traspasos
// ---------------------------------------------------------------------------
function DetalleTraspaso({ id, cerrar }: { id: string; cerrar: () => void }) {
  const { puede } = useSesion();
  const refrescar = useRefrescar();
  const r = useQuery({ queryKey: ["inv-doc", "tra", id], queryFn: () => GET(`/api/inventarios/traspasos/${id}`) });
  const [recibido, setRecibido] = useState<Record<string, string>>({});
  const [comentario, setComentario] = useState("");
  const recibir = useMutation({
    mutationFn: () => POST(`/api/inventarios/traspasos/${id}/recibir`, { comentario: comentario || null, recibidos: Object.entries(recibido).filter(([, v]) => v !== "").map(([renglon_id, cantidad]) => ({ renglon_id, cantidad })) }),
    onSuccess: refrescar,
  });
  const cancelar = useMutation({ mutationFn: (motivo: string) => POST(`/api/inventarios/traspasos/${id}/cancelar`, { motivo }), onSuccess: refrescar });
  const t = r.data;
  return (
    <Modal opened onClose={cerrar} size="xl" title={t ? `Traspaso ${t.folio}` : "Traspaso"}>
      {t && (
        <Stack>
          <Group><Estatus e={t.estatus} /><Text size="sm">{t.origen} → {t.destino} · enviado {fechaHora(t.enviado_en)} por {t.enviado_por}{t.recibido_en ? ` · recibido ${fechaHora(t.recibido_en)} por ${t.recibido_por}` : ""}</Text></Group>
          {(t.comentario || t.comentario_recepcion) && <Text size="sm" c="dimmed">{[t.comentario, t.comentario_recepcion && `Recepción: ${t.comentario_recepcion}`].filter(Boolean).join(" · ")}</Text>}
          <Table fz="sm" withTableBorder striped>
            <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Lote</Table.Th><Table.Th ta="right">Enviado</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Recibido</Table.Th><Table.Th ta="right">Faltante $</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{t.renglones.map((x: any) => (
              <Table.Tr key={x.id}>
                <Table.Td>{x.articulo}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td><Table.Td>{x.lote}</Table.Td>
                <Table.Td ta="right">{cant(x.cantidad_enviada)} {x.unidad}</Table.Td><Table.Td ta="right"><Pesos v={x.importe_enviado} /></Table.Td>
                <Table.Td>{t.estatus === "ENVIADO" && t.puedo_recibir
                  ? <TextInput size="xs" w={100} placeholder={cant(x.cantidad_enviada)} value={recibido[x.id] ?? ""} onChange={(e) => { const v = e.currentTarget.value; setRecibido((s) => ({ ...s, [x.id]: v })); }} />
                  : x.cantidad_recibida !== null ? cant(x.cantidad_recibida) : ""}</Table.Td>
                <Table.Td ta="right">{x.importe_faltante && Number(x.importe_faltante) ? <Text c="red" size="sm"><Pesos v={x.importe_faltante} /></Text> : ""}</Table.Td>
              </Table.Tr>
            ))}</Table.Tbody>
          </Table>
          {t.estatus === "ENVIADO" && t.puedo_recibir && puede("inventarios.traspasos:crear", "inventarios.traspasos:editar") && (
            <Card withBorder>
              <Text size="xs" c="dimmed" mb="xs">Escribe lo recibido solo si es distinto de lo enviado (vacío = llegó completo). Si falta algo, explica en el comentario.</Text>
              <Group align="flex-end">
                <TextInput label="Comentario" w={340} value={comentario} onChange={(e) => setComentario(e.currentTarget.value)} />
                <Button loading={recibir.isPending} onClick={() => recibir.mutate()}>Recibir</Button>
              </Group>
            </Card>
          )}
          {t.estatus === "ENVIADO" && t.puedo_cancelar && puede("inventarios.traspasos:cancelar") && <Motivo etiqueta="Cancelar traspaso (regresa al origen)" accion={(x) => cancelar.mutate(x)} cargando={cancelar.isPending} />}
          {(recibir.error || cancelar.error) && <Alert color="red">{textoError(recibir.error ?? cancelar.error)}</Alert>}
        </Stack>
      )}
    </Modal>
  );
}

function Traspasos() {
  const { puede } = useSesion();
  const op = useOpciones();
  const [estatus, setEstatus] = useState<string | null>("ENVIADO");
  const [ver, setVer] = useState<string | null>(null);
  const [enc, setEnc] = useState({ origen: null as string | null, destino: null as string | null, comentario: "" });
  const r = useQuery({ queryKey: ["inv-traspasos", estatus], queryFn: () => GET(`/api/inventarios/traspasos${estatus ? `?estatus=${estatus}` : ""}`) });
  return (
    <Stack>
      {puede("inventarios.traspasos:crear") && (
        <FormDoc titulo="Enviar traspaso" ruta="/api/inventarios/traspasos" tipos={["INSUMO", "EMPAQUE", "INTERMEDIO", "SKU"]}
          ayuda="La mercancía sale del origen al costo del inventario y queda en tránsito hasta que el almacén destino la recibe."
          listo={!!enc.origen && !!enc.destino} cuerpo={() => enc} exito={(x) => `Se envió el traspaso ${x.folio}.`}
          encabezado={(
            <Group align="flex-end">
              <Select label="Origen" w={280} data={datosAlmacen(op.data, (a) => a.mio)} value={enc.origen} onChange={(v) => setEnc({ ...enc, origen: v })} />
              <Select label="Destino" w={280} data={datosAlmacen(op.data, (a) => a.clave !== enc.origen)} value={enc.destino} onChange={(v) => setEnc({ ...enc, destino: v })} />
              <TextInput label="Comentario" w={240} value={enc.comentario} onChange={(e) => setEnc({ ...enc, comentario: e.currentTarget.value })} />
            </Group>
          )} />
      )}
      <Select w={200} label="Mostrar" clearable placeholder="Todos" value={estatus} onChange={setEstatus} data={[{ value: "ENVIADO", label: "En tránsito" }, { value: "RECIBIDO", label: "Recibidos" }, { value: "CANCELADO", label: "Cancelados" }]} />
      <Table withTableBorder striped highlightOnHover fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Estatus</Table.Th><Table.Th>Origen → destino</Table.Th><Table.Th>Enviado</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Faltante</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(r.data?.traspasos ?? []).map((t: any) => (
            <Table.Tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setVer(t.id)}>
              <Table.Td>{t.folio}</Table.Td><Table.Td><Estatus e={t.estatus} />{t.estatus === "ENVIADO" && t.puedo_recibir && <Badge ml={4} size="xs">por recibir</Badge>}</Table.Td>
              <Table.Td>{t.origen} → {t.destino}</Table.Td><Table.Td>{fechaHora(t.enviado_en)} · {t.enviado_por}</Table.Td><Table.Td ta="right"><Pesos v={t.importe} /></Table.Td>
              <Table.Td>{t.faltante && <Text c="red" size="sm"><Pesos v={t.faltante} /></Text>}</Table.Td>
            </Table.Tr>
          ))}
          {r.data && !r.data.traspasos.length && <Table.Tr><Table.Td colSpan={6}><Text size="sm" c="dimmed">Sin traspasos.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      {ver && <DetalleTraspaso id={ver} cerrar={() => setVer(null)} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Mermas
// ---------------------------------------------------------------------------
function DetalleMerma({ id, cerrar }: { id: string; cerrar: () => void }) {
  const { puede, yo } = useSesion();
  const refrescar = useRefrescar();
  const r = useQuery({ queryKey: ["inv-doc", "mer", id], queryFn: () => GET(`/api/inventarios/mermas/${id}`) });
  const autorizar = useMutation({ mutationFn: () => POST(`/api/inventarios/mermas/${id}/autorizar`), onSuccess: refrescar });
  const rechazar = useMutation({ mutationFn: (motivo: string) => POST(`/api/inventarios/mermas/${id}/rechazar`, { motivo }), onSuccess: refrescar });
  const m = r.data;
  const permisoAut = m?.almacen_tipo === "PT" ? "inventarios.merma_sucursal:autorizar" : "produccion.mermas:autorizar";
  const propia = m?.registrado_por_id === yo.usuario.id;
  return (
    <Modal opened onClose={cerrar} size="lg" title={m ? `Merma ${m.folio}` : "Merma"}>
      {m && (
        <Stack>
          <Group><Estatus e={m.estatus} /><Text size="sm">{m.almacen} · {m.causa_nombre} · {fechaHora(m.creado_en)} por {m.registrado_por}</Text></Group>
          {m.comentario && <Text size="sm" c="dimmed">{m.comentario}</Text>}
          <Table fz="sm" withTableBorder striped>
            <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Lote</Table.Th><Table.Th ta="right">Cantidad</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{m.renglones.map((x: any, i: number) => <Table.Tr key={i}><Table.Td>{x.articulo}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td><Table.Td>{x.lote ?? "por caducidad"}</Table.Td><Table.Td ta="right">{cant(x.cantidad)} {x.unidad}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
          {m.estatus === "APLICADA" && <Text size="sm">Aplicada con {m.movimiento} por {m.resuelto_por}: <b><Pesos v={m.importe} /></b></Text>}
          {m.motivo_rechazo && <Text size="sm" c="dimmed">Motivo: {m.motivo_rechazo}</Text>}
          {m.estatus === "POR_AUTORIZAR" && (
            <Group>
              {puede(permisoAut) && !propia && <Button color="green" loading={autorizar.isPending} onClick={() => autorizar.mutate()}>Autorizar y aplicar</Button>}
              {(puede(permisoAut) || propia) && <Motivo etiqueta={propia ? "Retirar merma" : "Rechazar"} accion={(x) => rechazar.mutate(x)} cargando={rechazar.isPending} />}
            </Group>
          )}
          {propia && m.estatus === "POR_AUTORIZAR" && <Text size="xs" c="dimmed">La registraste tú: la debe autorizar otra persona.</Text>}
          {(autorizar.error || rechazar.error) && <Alert color="red">{textoError(autorizar.error ?? rechazar.error)}</Alert>}
        </Stack>
      )}
    </Modal>
  );
}

function Mermas() {
  const { puede } = useSesion();
  const op = useOpciones();
  const [estatus, setEstatus] = useState<string | null>("POR_AUTORIZAR");
  const [ver, setVer] = useState<string | null>(null);
  const [enc, setEnc] = useState({ almacen: null as string | null, causa: null as string | null, comentario: "" });
  const r = useQuery({ queryKey: ["inv-mermas", estatus], queryFn: () => GET(`/api/inventarios/mermas${estatus ? `?estatus=${estatus}` : ""}`) });
  const tipoAlm = op.data?.almacenes.find((a) => a.clave === enc.almacen)?.tipo;
  const aplica = tipoAlm === "PT" ? "PT" : "MP";
  const puedeRegistrar = (a: { tipo: string }) => (a.tipo === "PT" ? puede("inventarios.merma_sucursal:crear") : puede("produccion.mermas:crear"));
  return (
    <Stack>
      {puede("inventarios.merma_sucursal:crear", "produccion.mermas:crear") && (
        <FormDoc titulo="Registrar merma" ruta="/api/inventarios/mermas" tipos={tipoAlm === "PT" ? ["SKU"] : ["INSUMO", "EMPAQUE", "INTERMEDIO", "SKU"]}
          ayuda="La merma queda pendiente hasta que la autoriza otra persona con permiso (según su límite). Al autorizarse sale del inventario a su costo."
          listo={!!enc.almacen && !!enc.causa} cuerpo={() => enc} exito={(x) => `Se registró la merma ${x.folio}; queda por autorizar.`}
          encabezado={(
            <Group align="flex-end">
              <Select label="Almacén" w={280} data={datosAlmacen(op.data, (a) => a.mio && puedeRegistrar(a))} value={enc.almacen} onChange={(v) => setEnc({ ...enc, almacen: v, causa: null })} />
              <Select label="Causa" w={260} data={(op.data?.causas ?? []).filter((c) => c.aplica === "TODOS" || c.aplica === aplica).map((c) => ({ value: c.clave, label: c.nombre }))} value={enc.causa} onChange={(v) => setEnc({ ...enc, causa: v })} />
              <TextInput label="Comentario" w={240} value={enc.comentario} onChange={(e) => setEnc({ ...enc, comentario: e.currentTarget.value })} />
            </Group>
          )} />
      )}
      <Select w={200} label="Mostrar" clearable placeholder="Todas" value={estatus} onChange={setEstatus} data={[{ value: "POR_AUTORIZAR", label: "Por autorizar" }, { value: "APLICADA", label: "Aplicadas" }, { value: "RECHAZADA", label: "Rechazadas" }, { value: "CANCELADA", label: "Canceladas" }]} />
      <Table withTableBorder striped highlightOnHover fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Estatus</Table.Th><Table.Th>Almacén</Table.Th><Table.Th>Causa</Table.Th><Table.Th>Registró</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(r.data?.mermas ?? []).map((m: any) => (
            <Table.Tr key={m.id} style={{ cursor: "pointer" }} onClick={() => setVer(m.id)}>
              <Table.Td>{m.folio}</Table.Td><Table.Td><Estatus e={m.estatus} /></Table.Td><Table.Td>{m.almacen}</Table.Td><Table.Td>{m.causa_nombre}</Table.Td>
              <Table.Td>{fechaHora(m.creado_en)} · {m.registrado_por}</Table.Td><Table.Td ta="right">{m.importe !== null && <Pesos v={m.importe} />}</Table.Td>
            </Table.Tr>
          ))}
          {r.data && !r.data.mermas.length && <Table.Tr><Table.Td colSpan={6}><Text size="sm" c="dimmed">Sin mermas.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      {ver && <DetalleMerma id={ver} cerrar={() => setVer(null)} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Conteos físicos
// ---------------------------------------------------------------------------
function DetalleConteo({ id, cerrar }: { id: string; cerrar: () => void }) {
  const { puede } = useSesion();
  const op = useOpciones();
  const refrescar = useRefrescar();
  const r = useQuery({ queryKey: ["inv-doc", "cnt", id], queryFn: () => GET(`/api/inventarios/conteos/${id}`) });
  const [fisico, setFisico] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState({ articulo: null as string | null, lote: "" });
  const llave = (x: { articulo: string; lote: string | null }) => `${x.articulo}|${x.lote ?? ""}`;
  const guardar = useMutation({
    mutationFn: (renglones: any[]) => PUT(`/api/inventarios/conteos/${id}`, { renglones }),
    onSuccess: () => { setFisico({}); refrescar(); },
  });
  const accion = useMutation({ mutationFn: (a: { ruta: string; cuerpo?: unknown }) => POST(`/api/inventarios/conteos/${id}/${a.ruta}`, a.cuerpo ?? {}), onSuccess: refrescar });
  const k = r.data;
  const cambios = () => Object.entries(fisico).map(([kk, v]) => { const [articulo, lote] = kk.split("|"); return { articulo, lote: lote || null, fisico: v }; });
  const art = op.data?.articulos.find((a) => a.clave === extra.articulo);
  return (
    <Modal opened onClose={cerrar} size="90%" title={k ? `Conteo ${k.folio} · ${k.almacen}` : "Conteo"}>
      {k && (
        <Stack>
          <Group><Estatus e={k.estatus} /><Text size="sm">Creado {fechaHora(k.creado_en)} por {k.creado_por}{k.resuelto_por ? ` · resuelto por ${k.resuelto_por}` : ""}</Text></Group>
          {k.estatus === "CAPTURA" && <Alert color="blue">Conteo a ciegas: cuenta lo que hay físicamente y escríbelo. El sistema no muestra lo que espera hasta que lo envías.</Alert>}
          {k.motivo_rechazo && <Text size="sm" c="dimmed">Motivo: {k.motivo_rechazo}</Text>}
          <ScrollArea>
            <Table fz="sm" withTableBorder striped>
              <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Lote</Table.Th><Table.Th>Físico</Table.Th>
                {k.estatus !== "CAPTURA" && <><Table.Th ta="right">Sistema</Table.Th><Table.Th ta="right">Diferencia</Table.Th><Table.Th ta="right">Costo unit.</Table.Th><Table.Th ta="right">Importe</Table.Th></>}
              </Table.Tr></Table.Thead>
              <Table.Tbody>{k.renglones.map((x: any) => (
                <Table.Tr key={llave(x)}>
                  <Table.Td>{x.articulo}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td><Table.Td>{x.lote}{x.caducidad && <Text size="xs" c="dimmed">cad. {fecha(x.caducidad)}</Text>}</Table.Td>
                  <Table.Td>{k.estatus === "CAPTURA"
                    ? <Group gap={4}><TextInput size="xs" w={100} placeholder={x.fisico === null ? "?" : cant(x.fisico)} value={fisico[llave(x)] ?? ""} onChange={(e) => { const v = e.currentTarget.value; setFisico((s) => ({ ...s, [llave(x)]: v })); }} /><Text size="xs">{x.unidad}</Text>{x.fisico !== null && !fisico[llave(x)] && <Badge size="xs" color="green" variant="light">{cant(x.fisico)}</Badge>}</Group>
                    : `${cant(x.fisico)} ${x.unidad}`}</Table.Td>
                  {k.estatus !== "CAPTURA" && <>
                    <Table.Td ta="right">{cant(x.teorico)}</Table.Td>
                    <Table.Td ta="right">{Number(x.diferencia) ? <Text size="sm" c={Number(x.diferencia) > 0 ? "green" : "red"} fw={600}>{Number(x.diferencia) > 0 ? "+" : ""}{cant(x.diferencia)}</Text> : "0"}</Table.Td>
                    <Table.Td ta="right"><Pesos v={x.costo_unitario} d={4} /></Table.Td><Table.Td ta="right"><Pesos v={x.importe} /></Table.Td>
                  </>}
                </Table.Tr>
              ))}</Table.Tbody>
            </Table>
          </ScrollArea>
          {k.estatus === "CAPTURA" && puede("inventarios.conteos:crear", "inventarios.conteos:editar") && (
            <Card withBorder>
              <Group align="flex-end">
                <Button variant="light" loading={guardar.isPending} disabled={!Object.keys(fisico).length} onClick={() => guardar.mutate(cambios())}>Guardar captura</Button>
                <Button loading={accion.isPending} onClick={() => accion.mutate({ ruta: "enviar" })}>Enviar a autorización</Button>
              </Group>
              <Group align="flex-end" mt="sm">
                <Select label="¿Encontraste otro artículo?" searchable w={300} data={(op.data?.articulos ?? []).map((a) => ({ value: a.clave, label: `${a.clave} · ${a.nombre}` }))} value={extra.articulo} onChange={(v) => setExtra({ articulo: v, lote: "" })} />
                {art?.maneja_lote && <TextInput label="Lote" w={160} value={extra.lote} onChange={(e) => setExtra({ ...extra, lote: e.currentTarget.value })} />}
                <Button variant="default" disabled={!extra.articulo} onClick={() => { guardar.mutate([{ articulo: extra.articulo, lote: extra.lote || null, fisico: null }]); setExtra({ articulo: null, lote: "" }); }}>Agregar al conteo</Button>
              </Group>
            </Card>
          )}
          {k.estatus === "POR_AUTORIZAR" && (
            <Card withBorder>
              <Text size="sm">Diferencia total (valor absoluto): <b><Pesos v={k.importe_diferencia} /></b>. Al autorizar se registran los ajustes (sobrantes y faltantes) en el kárdex.</Text>
              {puede("inventarios.ajustes:autorizar") && (
                <Group mt="sm">
                  <Button color="green" loading={accion.isPending} onClick={() => accion.mutate({ ruta: "autorizar" })}>Autorizar ajuste</Button>
                  <Motivo etiqueta="Rechazar" accion={(motivo) => accion.mutate({ ruta: "rechazar", cuerpo: { motivo } })} cargando={accion.isPending} />
                </Group>
              )}
            </Card>
          )}
          {k.estatus === "APLICADO" && (k.entrada || k.salida) && <Text size="sm">Ajustes: {[k.entrada, k.salida].filter(Boolean).join(", ")}</Text>}
          {["CAPTURA", "POR_AUTORIZAR"].includes(k.estatus) && puede("inventarios.conteos:crear", "inventarios.conteos:cancelar") && <Motivo etiqueta="Cancelar conteo" accion={(motivo) => accion.mutate({ ruta: "cancelar", cuerpo: { motivo } })} cargando={accion.isPending} />}
          {(guardar.error || accion.error) && <Alert color="red">{textoError(guardar.error ?? accion.error)}</Alert>}
          {accion.data?.estatus === "APLICADO" && <Alert color="green">No hubo diferencias: el conteo quedó aplicado sin ajustes.</Alert>}
        </Stack>
      )}
    </Modal>
  );
}

function Conteos() {
  const { puede } = useSesion();
  const op = useOpciones();
  const refrescar = useRefrescar();
  const [estatus, setEstatus] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ almacen: null as string | null, articulos: [] as string[], comentario: "" });
  const r = useQuery({ queryKey: ["inv-conteos", estatus], queryFn: () => GET(`/api/inventarios/conteos${estatus ? `?estatus=${estatus}` : ""}`) });
  const crear = useMutation({ mutationFn: () => POST("/api/inventarios/conteos", { ...nuevo, articulos: nuevo.articulos.length ? nuevo.articulos : undefined }), onSuccess: (x: any) => { refrescar(); setVer(x.id); } });
  return (
    <Stack>
      {puede("inventarios.conteos:crear") && (
        <Card withBorder>
          <Text fw={600}>Nuevo conteo físico</Text>
          <Text size="xs" c="dimmed" mb="sm">Sin artículos = todo lo que tiene existencia en el almacén (conteo general). Con artículos = conteo cíclico de esos artículos. Quien cuenta no puede autorizar el ajuste.</Text>
          <Group align="flex-end">
            <Select label="Almacén" w={280} data={datosAlmacen(op.data, (a) => a.mio)} value={nuevo.almacen} onChange={(v) => setNuevo({ ...nuevo, almacen: v })} />
            <MultiSelect label="Artículos (opcional)" w={360} searchable data={(op.data?.articulos ?? []).map((a) => ({ value: a.clave, label: a.clave }))} value={nuevo.articulos} onChange={(v) => setNuevo({ ...nuevo, articulos: v })} />
            <TextInput label="Comentario" w={220} value={nuevo.comentario} onChange={(e) => setNuevo({ ...nuevo, comentario: e.currentTarget.value })} />
            <Button loading={crear.isPending} disabled={!nuevo.almacen} onClick={() => crear.mutate()}>Crear conteo</Button>
          </Group>
          {crear.error && <Alert mt="xs" color="red">{textoError(crear.error)}</Alert>}
        </Card>
      )}
      <Select w={200} label="Mostrar" clearable placeholder="Todos" value={estatus} onChange={setEstatus} data={["CAPTURA", "POR_AUTORIZAR", "APLICADO", "RECHAZADO", "CANCELADO"].map((v) => ({ value: v, label: ESTATUS_TXT[v]! }))} />
      <Table withTableBorder striped highlightOnHover fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Estatus</Table.Th><Table.Th>Almacén</Table.Th><Table.Th>Creado</Table.Th><Table.Th ta="right">Renglones</Table.Th><Table.Th ta="right">Con diferencia</Table.Th><Table.Th ta="right">Diferencia $</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(r.data?.conteos ?? []).map((k: any) => (
            <Table.Tr key={k.id} style={{ cursor: "pointer" }} onClick={() => setVer(k.id)}>
              <Table.Td>{k.folio}</Table.Td><Table.Td><Estatus e={k.estatus} /></Table.Td><Table.Td>{k.almacen}</Table.Td><Table.Td>{fechaHora(k.creado_en)} · {k.creado_por}</Table.Td>
              <Table.Td ta="right">{k.renglones}</Table.Td><Table.Td ta="right">{k.estatus !== "CAPTURA" ? k.con_diferencia : ""}</Table.Td><Table.Td ta="right">{k.importe_diferencia !== null && <Pesos v={k.importe_diferencia} />}</Table.Td>
            </Table.Tr>
          ))}
          {r.data && !r.data.conteos.length && <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed">Sin conteos.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      {ver && <DetalleConteo id={ver} cerrar={() => setVer(null)} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
export function Inventarios() {
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const pestanas = [
    puede("inventarios.existencias:ver") && { v: "existencias", t: "Existencias" },
    puede("inventarios.existencias:ver") && { v: "alertas", t: "Alertas" },
    puede("compras.recepcion:crear", "inventarios.surtido:crear", "produccion.ordenes:crear") && { v: "registrar", t: "Entradas y surtidos" },
    puede("inventarios.existencias:ver") && { v: "movimientos", t: "Movimientos" },
    puede("inventarios.traspasos:ver") && { v: "traspasos", t: "Traspasos" },
    puede("produccion.mermas:ver", "inventarios.merma_sucursal:ver") && { v: "mermas", t: "Mermas" },
    puede("inventarios.conteos:ver") && { v: "conteos", t: "Conteos físicos" },
  ].filter(Boolean) as { v: string; t: string }[];
  const tab = params.get("tab") && pestanas.some((p) => p.v === params.get("tab")) ? params.get("tab")! : pestanas[0]?.v;
  return (
    <Stack>
      <Title order={2}>Inventarios</Title>
      <Tabs value={tab} onChange={(v) => setParams(v ? { tab: v } : {})} keepMounted={false}>
        <Tabs.List>{pestanas.map((p) => <Tabs.Tab key={p.v} value={p.v}>{p.t}</Tabs.Tab>)}</Tabs.List>
        <Tabs.Panel value="existencias" pt="md"><Existencias /></Tabs.Panel>
        <Tabs.Panel value="alertas" pt="md"><Alertas /></Tabs.Panel>
        <Tabs.Panel value="registrar" pt="md"><Operaciones /></Tabs.Panel>
        <Tabs.Panel value="movimientos" pt="md"><Movimientos /></Tabs.Panel>
        <Tabs.Panel value="traspasos" pt="md"><Traspasos /></Tabs.Panel>
        <Tabs.Panel value="mermas" pt="md"><Mermas /></Tabs.Panel>
        <Tabs.Panel value="conteos" pt="md"><Conteos /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
