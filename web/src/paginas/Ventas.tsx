// Oficina: ventas por fecha y sucursal (con exportación), tickets, cortes de
// caja con su arqueo y pedidos. Solo lectura; la operación es en la caja.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PasswordInput, SegmentedControl, Textarea } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Group, Modal, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { descargar, GET, POST, PUT, textoError } from "../api";
import { fecha, fechaHora, fechaIso, numero } from "../formato";
import { impresoraNavegador } from "../impresion";
import { useSesion } from "../sesion";

const $ = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : `${Number(v) < 0 ? "-" : ""}$${numero(Math.abs(Number(v)), 2)}`);
const hoy = () => fecha(new Date());

function TicketModal({ id, cerrar }: { id: string; cerrar: () => void }) {
  const t = useQuery({ queryKey: ["ticket", id], queryFn: () => GET(`/api/pos/ventas/${id}`) });
  return (
    <Modal opened onClose={cerrar} title={t.data ? `Venta ${t.data.folio}` : "Venta"} size="lg">
      {t.data && (
        <Stack>
          <Text size="sm">{t.data.sucursal} · {t.data.caja} · {fechaHora(t.data.fecha)} · {t.data.cajero}{t.data.pedido ? ` · pedido ${t.data.pedido}` : ""}</Text>
          <Table fz="sm" withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Producto</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Precio</Table.Th><Table.Th ta="right">Desc.</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">Devuelto</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{t.data.renglones.map((r: any) => <Table.Tr key={r.orden}><Table.Td>{r.nombre}</Table.Td><Table.Td ta="right">{Number(r.cantidad)}</Table.Td><Table.Td ta="right">{$(r.precio)}</Table.Td><Table.Td ta="right">{Number(r.descuento) ? $(r.descuento) : ""}</Table.Td><Table.Td ta="right">{$(r.importe)}</Table.Td><Table.Td ta="right">{Number(r.cantidad_devuelta) || ""}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
          <Text size="sm">Subtotal {$(t.data.subtotal)} · IEPS {$(t.data.ieps)} · IVA {$(t.data.iva)} · <b>Total {$(t.data.total)}</b>{Number(t.data.devuelto) ? ` · devuelto ${$(t.data.devuelto)}` : ""}</Text>
          <Text size="sm">Pagos: {t.data.pagos.map((p: any) => `${p.forma} ${$(p.importe)}${p.referencia ? ` (${p.referencia})` : ""}`).join(" · ")} · cambio {$(t.data.cambio)}</Text>
          <Button variant="default" w={180} onClick={() => impresoraNavegador.imprimir(t.data)}>Reimprimir ticket</Button>
        </Stack>
      )}
    </Modal>
  );
}

function ListaVentas() {
  const { puede } = useSesion();
  const [f, setF] = useState({ desde: hoy(), hasta: hoy(), sucursal: "" });
  const [ver, setVer] = useState<string | null>(null);
  const q = `desde=${fechaIso(f.desde) ?? ""}&hasta=${fechaIso(f.hasta) ?? ""}${f.sucursal ? `&sucursal=${f.sucursal}` : ""}`;
  const r = useQuery({ queryKey: ["ventas", q], queryFn: () => GET(`/api/pos/ventas?${q}`), enabled: !!fechaIso(f.desde) && !!fechaIso(f.hasta) });
  const ventas: any[] = r.data?.ventas ?? [];
  const suma = (k: string) => ventas.reduce((s, v) => s + Number(v[k] ?? 0), 0);
  return (
    <Stack>
      <Group align="flex-end">
        <TextInput label="Desde" w={130} value={f.desde} onChange={(e) => setF({ ...f, desde: e.currentTarget.value })} />
        <TextInput label="Hasta" w={130} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.currentTarget.value })} />
        <TextInput label="Sucursal (clave)" w={140} value={f.sucursal} onChange={(e) => setF({ ...f, sucursal: e.currentTarget.value.toUpperCase() })} />
        {puede("pos.ventas:exportar") && <Button variant="default" onClick={() => descargar(`/api/pos/ventas?${q}&formato=xlsx`, "ventas.xlsx")}>Exportar a Excel</Button>}
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      <SimpleGrid cols={{ base: 2, md: 5 }}>
        <Card withBorder><Text size="xs">Tickets</Text><Text fw={700}>{ventas.length}</Text></Card>
        <Card withBorder><Text size="xs">Ventas (con impuestos)</Text><Text fw={700}>{$(suma("total"))}</Text></Card>
        <Card withBorder><Text size="xs">Devoluciones</Text><Text fw={700}>{$(suma("devuelto"))}</Text></Card>
        <Card withBorder><Text size="xs">Venta neta sin impuestos</Text><Text fw={700}>{$(suma("subtotal"))}</Text></Card>
        {puede("datos.costos:ver") && <Card withBorder><Text size="xs">Costo de lo vendido</Text><Text fw={700}>{$(suma("costo"))}</Text></Card>}
      </SimpleGrid>
      <ScrollArea>
        <Table withTableBorder striped highlightOnHover fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th>Cajero</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th ta="right">Devuelto</Table.Th><Table.Th>Estatus</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{ventas.map((v) => (
            <Table.Tr key={v.id} style={{ cursor: "pointer" }} onClick={() => setVer(v.id)}>
              <Table.Td>{v.folio}{v.pedido && <Badge ml={4} size="xs">{v.pedido}</Badge>}</Table.Td><Table.Td>{fechaHora(v.fecha)}</Table.Td><Table.Td>{v.sucursal} · {v.caja}</Table.Td><Table.Td>{v.cajero}</Table.Td>
              <Table.Td ta="right">{$(v.total)}</Table.Td><Table.Td ta="right">{Number(v.devuelto) ? $(v.devuelto) : ""}</Table.Td><Table.Td>{v.estatus === "PAGADA" ? "" : <Badge color="orange" size="xs">{v.estatus === "DEVUELTA" ? "devuelta" : "dev. parcial"}</Badge>}</Table.Td>
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </ScrollArea>
      {ver && <TicketModal id={ver} cerrar={() => setVer(null)} />}
    </Stack>
  );
}

function Cortes() {
  const r = useQuery({ queryKey: ["cortes"], queryFn: () => GET("/api/pos/cortes") });
  const [ver, setVer] = useState<string | null>(null);
  const d = useQuery({ queryKey: ["corte", ver], queryFn: () => GET(`/api/pos/cortes/${ver}`), enabled: !!ver });
  return (
    <Stack>
      <Table withTableBorder striped highlightOnHover fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Caja</Table.Th><Table.Th>Turno</Table.Th><Table.Th ta="right">Esperado</Table.Th><Table.Th ta="right">Contado</Table.Th><Table.Th ta="right">Diferencia</Table.Th><Table.Th>Hizo / autorizó</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.cortes ?? []).map((k: any) => (
          <Table.Tr key={k.id} style={{ cursor: "pointer" }} onClick={() => setVer(k.id)}>
            <Table.Td>{fechaHora(k.creado_en)}</Table.Td><Table.Td><Badge color={k.tipo === "Z" ? "red" : "blue"} variant="light">{k.tipo}</Badge></Table.Td><Table.Td>{k.sucursal} · {k.caja}</Table.Td><Table.Td>{k.turno}</Table.Td>
            <Table.Td ta="right">{$(k.esperado_efectivo)}</Table.Td><Table.Td ta="right">{$(k.contado_efectivo)}</Table.Td>
            <Table.Td ta="right">{k.diferencia !== null && <Text size="sm" c={Number(k.diferencia) === 0 ? "green" : "red"} fw={600}>{$(k.diferencia)}</Text>}</Table.Td>
            <Table.Td>{k.usuario}{k.autorizo ? ` / ${k.autorizo}` : ""}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
      <Modal opened={!!ver} onClose={() => setVer(null)} title="Corte" size="lg">
        {d.data && (
          <Stack>
            <Text size="sm">{d.data.sucursal} · {d.data.caja} · {d.data.turno} · corte {d.data.tipo} · {fechaHora(d.data.creado_en)}</Text>
            <Table fz="sm">
              <Table.Tbody>
                <Table.Tr><Table.Td>Fondo</Table.Td><Table.Td ta="right">{$(d.data.resumen.fondo)}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>Ventas ({d.data.resumen.ventas} tickets)</Table.Td><Table.Td ta="right">{$(d.data.resumen.total)}</Table.Td></Table.Tr>
                {d.data.resumen.por_forma.map((f: any) => <Table.Tr key={f.clave}><Table.Td>· {f.nombre}</Table.Td><Table.Td ta="right">{$(f.importe)}</Table.Td></Table.Tr>)}
                <Table.Tr><Table.Td>Anticipos de pedidos</Table.Td><Table.Td ta="right">{$(d.data.resumen.anticipos)}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>Retiros / ingresos</Table.Td><Table.Td ta="right">{$(d.data.resumen.retiros)} / {$(d.data.resumen.ingresos)}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>Devoluciones de venta / de anticipos</Table.Td><Table.Td ta="right">{$(d.data.resumen.devoluciones)} / {$(d.data.resumen.devoluciones_anticipo)}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td><b>Efectivo esperado</b></Table.Td><Table.Td ta="right"><b>{$(d.data.esperado_efectivo)}</b></Table.Td></Table.Tr>
                {d.data.tipo === "Z" && <Table.Tr><Table.Td><b>Contado / diferencia</b></Table.Td><Table.Td ta="right"><b>{$(d.data.contado_efectivo)} / {$(d.data.diferencia)}</b></Table.Td></Table.Tr>}
              </Table.Tbody>
            </Table>
            {!!d.data.denominaciones.length && <Text size="sm">Arqueo: {d.data.denominaciones.map((x: any) => `${x.cantidad} × ${$(x.valor)}`).join(" · ")}</Text>}
            {d.data.comentario && <Alert color="yellow">{d.data.comentario}</Alert>}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function PedidoOficina({ alTerminar }: { alTerminar: () => void }) {
  const est = useQuery({ queryKey: ["pos-estado-oficina"], queryFn: () => GET("/api/pos/estado") });
  const [d, setD] = useState({ sucursal: null as string | null, origen: "WHATSAPP", cliente_nombre: "", telefono: "", fecha: "", notas: "" });
  const [rs, setRs] = useState<{ articulo: string | null; cantidad: string; especificaciones: string }[]>([{ articulo: null, cantidad: "1", especificaciones: "" }]);
  const [aut, setAut] = useState({ usuario: "", pin: "" });
  const prods = useQuery({ queryKey: ["pos-prod-oficina", d.sucursal], queryFn: () => GET(`/api/pos/productos?sucursal=${d.sucursal}`), enabled: !!d.sucursal });
  const lista: any[] = (prods.data?.productos ?? []).filter((p: any) => p.precio);
  const total = rs.reduce((s, r) => s + Number(lista.find((p) => p.clave === r.articulo)?.precio ?? 0) * Number(r.cantidad || 0), 0);
  const m = useMutation({
    mutationFn: () => POST("/api/pos/pedidos", {
      sucursal: d.sucursal, origen: d.origen, cliente_nombre: d.cliente_nombre, telefono: d.telefono || null, fecha_entrega: fechaIso(d.fecha), notas: d.notas || null,
      renglones: rs.filter((r) => r.articulo && Number(r.cantidad) > 0).map((r) => ({ articulo: r.articulo, cantidad: r.cantidad, especificaciones: r.especificaciones || null })),
      autorizacion: aut,
    }),
    onSuccess: (x: any) => { setOk(`Pedido ${x.folio} registrado por $${numero(x.total, 2)}. El cliente paga o abona en la sucursal.`); setRs([{ articulo: null, cantidad: "1", especificaciones: "" }]); setD({ ...d, cliente_nombre: "", telefono: "", fecha: "", notas: "" }); setAut({ usuario: "", pin: "" }); alTerminar(); },
  });
  const [ok, setOk] = useState<string | null>(null);
  return (
    <Card withBorder>
      <Text fw={600}>Nuevo pedido por teléfono o WhatsApp</Text>
      <Text size="xs" c="dimmed" mb="sm">Se registra sin anticipo, con la autorización (usuario y PIN) del contador o el contralor. El anticipo, los abonos y la entrega se cobran en la caja de la sucursal.</Text>
      <Stack>
        <Group align="flex-end">
          <SegmentedControl value={d.origen} onChange={(v) => setD({ ...d, origen: v })} data={[{ value: "WHATSAPP", label: "WhatsApp" }, { value: "TELEFONO", label: "Teléfono" }]} />
          <Select label="Sucursal que entrega" w={220} data={(est.data?.sucursales ?? []).map((x: any) => ({ value: x.clave, label: x.nombre }))} value={d.sucursal} onChange={(v) => setD({ ...d, sucursal: v })} />
          <TextInput label="Cliente" w={220} value={d.cliente_nombre} onChange={(e) => setD({ ...d, cliente_nombre: e.currentTarget.value })} />
          <TextInput label="Teléfono" w={150} value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.currentTarget.value })} />
          <TextInput label="Fecha de entrega" placeholder="DD/MM/AAAA" w={140} value={d.fecha} error={d.fecha && !fechaIso(d.fecha) ? "No válida" : undefined} onChange={(e) => setD({ ...d, fecha: e.currentTarget.value })} />
        </Group>
        {rs.map((r, i) => (
          <Group key={i} align="flex-end">
            <Select label={i === 0 ? "Producto" : undefined} searchable w={320} disabled={!d.sucursal} data={lista.map((p) => ({ value: p.clave, label: `${p.nombre} · $${numero(p.precio, 2)}` }))} value={r.articulo} onChange={(v) => setRs(rs.map((x, j) => (j === i ? { ...x, articulo: v } : x)))} />
            <TextInput label={i === 0 ? "Cantidad" : undefined} w={90} value={r.cantidad} onChange={(e) => { const v = e.currentTarget.value; setRs(rs.map((x, j) => (j === i ? { ...x, cantidad: v } : x))); }} />
            <TextInput label={i === 0 ? "Especificaciones" : undefined} w={280} value={r.especificaciones} onChange={(e) => { const v = e.currentTarget.value; setRs(rs.map((x, j) => (j === i ? { ...x, especificaciones: v } : x))); }} />
          </Group>
        ))}
        <Button variant="default" w={180} onClick={() => setRs([...rs, { articulo: null, cantidad: "1", especificaciones: "" }])}>Agregar producto</Button>
        <Textarea label="Notas (decoración, texto, etc.)" value={d.notas} onChange={(e) => setD({ ...d, notas: e.currentTarget.value })} />
        <Text fw={700}>Total: ${numero(total, 2)}</Text>
        <Group grow>
          <TextInput label="Autoriza (usuario del contador o contralor)" value={aut.usuario} onChange={(e) => setAut({ ...aut, usuario: e.currentTarget.value })} autoComplete="off" />
          <PasswordInput label="PIN" value={aut.pin} onChange={(e) => setAut({ ...aut, pin: e.currentTarget.value.replace(/\D/g, "") })} autoComplete="off" />
        </Group>
        {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
        {ok && <Alert color="green">{ok}</Alert>}
        <Button loading={m.isPending} disabled={!d.sucursal || !d.cliente_nombre || !fechaIso(d.fecha) || !total || !aut.usuario || aut.pin.length < 4} onClick={() => { setOk(null); m.mutate(); }}>Registrar pedido</Button>
      </Stack>
    </Card>
  );
}

function ListaPedidos() {
  const [estatus, setEstatus] = useState<string | null>("REGISTRADO");
  const { puede } = useSesion();
  const r = useQuery({ queryKey: ["pedidos", estatus], queryFn: () => GET(`/api/pos/pedidos${estatus ? `?estatus=${estatus}` : ""}`) });
  return (
    <Stack>
      {puede("pos.pedidos:crear") && <PedidoOficina alTerminar={() => r.refetch()} />}
      <Select w={200} label="Mostrar" clearable placeholder="Todos" value={estatus} onChange={setEstatus} data={[{ value: "REGISTRADO", label: "Por entregar" }, { value: "ENTREGADO", label: "Entregados" }, { value: "CANCELADO", label: "Cancelados" }]} />
      <Table withTableBorder striped fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Entrega</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Productos</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th ta="right">Anticipo</Table.Th><Table.Th>Estatus</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.pedidos ?? []).map((p: any) => (
          <Table.Tr key={p.id}>
            <Table.Td>{p.folio}</Table.Td><Table.Td>{fecha(p.fecha_entrega)}</Table.Td><Table.Td>{p.sucursal}</Table.Td><Table.Td>{p.cliente_nombre}<Text size="xs" c="dimmed">{p.telefono}{p.origen && p.origen !== "MOSTRADOR" ? ` · ${p.origen === "WHATSAPP" ? "WhatsApp" : "Teléfono"}` : ""}</Text></Table.Td>
            <Table.Td>{p.renglones.map((x: any) => <Text key={x.articulo} size="xs">{Number(x.cantidad)} × {x.nombre}</Text>)}</Table.Td>
            <Table.Td ta="right">{$(p.total)}</Table.Td><Table.Td ta="right">{$(p.anticipado)}</Table.Td>
            <Table.Td>{p.estatus === "REGISTRADO" ? <Badge>por entregar</Badge> : p.estatus === "ENTREGADO" ? <Badge color="green">entregado {p.venta}</Badge> : <Badge color="gray">cancelado{p.destino_anticipo ? ` · anticipo ${p.destino_anticipo.toLowerCase()}` : ""}</Badge>}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Ofertas de fin del día (P37): las capturan el contador o el contralor
// ---------------------------------------------------------------------------
function Ofertas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ofertas"], queryFn: () => GET("/api/ofertas") });
  const [f, setF] = useState({ alcance: "TODOS", articulo: null as string | null, familia: null as string | null, sucursal: null as string | null, descuento_pct: "", hora_desde: "" });
  const [edit, setEdit] = useState<Record<string, { descuento_pct: string; hora_desde: string }>>({});
  const listo = () => { qc.invalidateQueries({ queryKey: ["ofertas"] }); };
  const alta = useMutation({
    mutationFn: () => POST_PUT({ articulo: f.alcance === "PRODUCTO" ? f.articulo : null, familia: f.alcance === "FAMILIA" ? f.familia : null, sucursal: f.sucursal, descuento_pct: f.descuento_pct, hora_desde: f.hora_desde }),
    onSuccess: () => { setF({ ...f, descuento_pct: "", hora_desde: "" }); listo(); },
  });
  const cambio = useMutation({ mutationFn: (x: any) => POST_PUT(x), onSuccess: () => { setEdit({}); listo(); } });
  const d = q.data;
  if (!d) return q.error ? <Alert color="red">{textoError(q.error)}</Alert> : null;
  return (
    <Stack>
      <Text size="sm" c="dimmed">El pan se vende con descuento antes de terminar el día. Desde la hora indicada, la caja aplica la oferta sola (sin pedir PIN) y el ticket muestra el descuento. Si hay varias, gana la más específica: producto, luego familia, luego todos; y la de la sucursal sobre la de todas. Los pedidos conservan su precio pactado.</Text>
      {d.puede_editar && (
        <Card withBorder>
          <Group align="flex-end">
            <Select label="Aplica a" w={170} data={[{ value: "TODOS", label: "Todos los productos" }, { value: "FAMILIA", label: "Una familia" }, { value: "PRODUCTO", label: "Un producto" }]} value={f.alcance} onChange={(v) => setF({ ...f, alcance: v ?? "TODOS" })} />
            {f.alcance === "FAMILIA" && <Select label="Familia" w={220} searchable data={d.familias.map((x: any) => ({ value: x.clave, label: x.nombre }))} value={f.familia} onChange={(v) => setF({ ...f, familia: v })} />}
            {f.alcance === "PRODUCTO" && <Select label="Producto" w={260} searchable data={d.productos.map((x: any) => ({ value: x.clave, label: x.nombre }))} value={f.articulo} onChange={(v) => setF({ ...f, articulo: v })} />}
            <Select label="Sucursal" w={170} clearable placeholder="Todas" data={d.sucursales.map((x: any) => ({ value: x.clave, label: x.nombre }))} value={f.sucursal} onChange={(v) => setF({ ...f, sucursal: v })} />
            <TextInput label="Descuento %" w={110} value={f.descuento_pct} onChange={(e) => setF({ ...f, descuento_pct: e.currentTarget.value })} />
            <TextInput label="Desde (HH:MM)" w={120} placeholder="18:00" value={f.hora_desde} onChange={(e) => setF({ ...f, hora_desde: e.currentTarget.value })} />
            <Button loading={alta.isPending} disabled={!f.descuento_pct || !f.hora_desde} onClick={() => alta.mutate()}>Guardar oferta</Button>
          </Group>
          {alta.error && <Alert mt="xs" color="red">{textoError(alta.error)}</Alert>}
        </Card>
      )}
      {cambio.error && <Alert color="red">{textoError(cambio.error)}</Alert>}
      <Table striped withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Aplica a</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th>Descuento</Table.Th><Table.Th>Desde</Table.Th><Table.Th>Estatus</Table.Th><Table.Th>Capturó</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {d.ofertas.map((o: any) => {
            const e = edit[o.id];
            return (
              <Table.Tr key={o.id} c={o.activo ? undefined : "dimmed"}>
                <Table.Td>{o.articulo ? o.articulo_nombre : o.familia ? `Familia ${o.familia_nombre}` : "Todos los productos"}</Table.Td>
                <Table.Td>{o.sucursal ?? "Todas"}</Table.Td>
                <Table.Td>{e ? <TextInput size="xs" w={80} value={e.descuento_pct} onChange={(x) => setEdit({ [o.id]: { ...e, descuento_pct: x.currentTarget.value } })} /> : `${Number(o.descuento_pct)}%`}</Table.Td>
                <Table.Td>{e ? <TextInput size="xs" w={80} value={e.hora_desde} onChange={(x) => setEdit({ [o.id]: { ...e, hora_desde: x.currentTarget.value } })} /> : o.hora_desde}</Table.Td>
                <Table.Td>{o.activo ? <Badge color="green" variant="light">Activa</Badge> : <Badge color="gray" variant="light">Desactivada</Badge>}</Table.Td>
                <Table.Td>{o.capturo}</Table.Td>
                <Table.Td>{d.puede_editar && o.activo && (e
                  ? <Group gap={4}><Button size="xs" loading={cambio.isPending} onClick={() => cambio.mutate({ id: o.id, ...e, activo: true })}>Guardar</Button><Button size="xs" variant="subtle" onClick={() => setEdit({})}>Cancelar</Button></Group>
                  : <Group gap={4}><Button size="xs" variant="light" onClick={() => setEdit({ [o.id]: { descuento_pct: Number(o.descuento_pct).toString(), hora_desde: o.hora_desde } })}>Cambiar</Button>
                      <Button size="xs" variant="subtle" color="red" loading={cambio.isPending} onClick={() => cambio.mutate({ id: o.id, descuento_pct: Number(o.descuento_pct).toString(), hora_desde: o.hora_desde, activo: false })}>Desactivar</Button></Group>)}</Table.Td>
              </Table.Tr>
            );
          })}
          {!d.ofertas.length && <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed">Sin ofertas capturadas.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
const POST_PUT = (cuerpo: unknown) => PUT("/api/ofertas", cuerpo);

export function Ventas() {
  const { puede } = useSesion();
  return (
    <Stack>
      <Title order={2}>Ventas y cortes</Title>
      <Tabs defaultValue={puede("pos.ventas:ver") ? "ventas" : puede("pos.caja:ver") ? "cortes" : "ofertas"} keepMounted={false}>
        <Tabs.List>
          {puede("pos.ventas:ver") && <Tabs.Tab value="ventas">Ventas</Tabs.Tab>}
          {puede("pos.caja:ver") && <Tabs.Tab value="cortes">Cortes de caja</Tabs.Tab>}
          {puede("pos.pedidos:ver") && <Tabs.Tab value="pedidos">Pedidos</Tabs.Tab>}
          {puede("pos.descuentos:ver") && <Tabs.Tab value="ofertas">Ofertas de fin del día</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="ventas" pt="md"><ListaVentas /></Tabs.Panel>
        <Tabs.Panel value="cortes" pt="md"><Cortes /></Tabs.Panel>
        <Tabs.Panel value="pedidos" pt="md"><ListaPedidos /></Tabs.Panel>
        <Tabs.Panel value="ofertas" pt="md"><Ofertas /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
