// Oficina: ventas por fecha y sucursal (con exportación), tickets, cortes de
// caja con su arqueo y pedidos. Solo lectura; la operación es en la caja.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Group, Modal, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { descargar, GET, textoError } from "../api";
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

function ListaPedidos() {
  const [estatus, setEstatus] = useState<string | null>("REGISTRADO");
  const r = useQuery({ queryKey: ["pedidos", estatus], queryFn: () => GET(`/api/pos/pedidos${estatus ? `?estatus=${estatus}` : ""}`) });
  return (
    <Stack>
      <Select w={200} label="Mostrar" clearable placeholder="Todos" value={estatus} onChange={setEstatus} data={[{ value: "REGISTRADO", label: "Por entregar" }, { value: "ENTREGADO", label: "Entregados" }, { value: "CANCELADO", label: "Cancelados" }]} />
      <Table withTableBorder striped fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Entrega</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Productos</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th ta="right">Anticipo</Table.Th><Table.Th>Estatus</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.pedidos ?? []).map((p: any) => (
          <Table.Tr key={p.id}>
            <Table.Td>{p.folio}</Table.Td><Table.Td>{fecha(p.fecha_entrega)}</Table.Td><Table.Td>{p.sucursal}</Table.Td><Table.Td>{p.cliente_nombre}<Text size="xs" c="dimmed">{p.telefono}</Text></Table.Td>
            <Table.Td>{p.renglones.map((x: any) => <Text key={x.articulo} size="xs">{Number(x.cantidad)} × {x.nombre}</Text>)}</Table.Td>
            <Table.Td ta="right">{$(p.total)}</Table.Td><Table.Td ta="right">{$(p.anticipado)}</Table.Td>
            <Table.Td>{p.estatus === "REGISTRADO" ? <Badge>por entregar</Badge> : p.estatus === "ENTREGADO" ? <Badge color="green">entregado {p.venta}</Badge> : <Badge color="gray">cancelado{p.destino_anticipo ? ` · anticipo ${p.destino_anticipo.toLowerCase()}` : ""}</Badge>}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
    </Stack>
  );
}

export function Ventas() {
  const { puede } = useSesion();
  return (
    <Stack>
      <Title order={2}>Ventas y cortes</Title>
      <Tabs defaultValue={puede("pos.ventas:ver") ? "ventas" : "cortes"} keepMounted={false}>
        <Tabs.List>
          {puede("pos.ventas:ver") && <Tabs.Tab value="ventas">Ventas</Tabs.Tab>}
          {puede("pos.caja:ver") && <Tabs.Tab value="cortes">Cortes de caja</Tabs.Tab>}
          {puede("pos.pedidos:ver") && <Tabs.Tab value="pedidos">Pedidos</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="ventas" pt="md"><ListaVentas /></Tabs.Panel>
        <Tabs.Panel value="cortes" pt="md"><Cortes /></Tabs.Panel>
        <Tabs.Panel value="pedidos" pt="md"><ListaPedidos /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
