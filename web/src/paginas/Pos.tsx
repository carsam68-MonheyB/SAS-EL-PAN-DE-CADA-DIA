// Punto de venta táctil (Fase 6): pantalla completa para la caja. Botones por
// familia y búsqueda, carrito, cobro con varias formas de pago, ticket, cambio
// de cajero con PIN, retiros, devoluciones, pedidos con anticipo y cortes.
// Todo lo valida el servidor; lo que requiere supervisor pide usuario y PIN.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon, Alert, Badge, Box, Button, Card, Center, Checkbox, Divider, Group, Loader, Modal, NumberInput, PasswordInput, ScrollArea,
  SegmentedControl, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Textarea, Title, UnstyledButton,
} from "@mantine/core";
import { GET, POST, textoError } from "../api";
import { fecha, fechaHora, fechaIso, numero } from "../formato";
import { impresoraNavegador } from "../impresion";
import { cola, copia, esErrorDeRed, folioLocal, type VentaPendiente } from "../sinConexion";
import { useSesion } from "../sesion";

const $ = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : `${Number(v) < 0 ? "-" : ""}$${numero(Math.abs(Number(v)), 2)}`);
const n = (v: string) => Number((v || "0").replaceAll(",", "")) || 0;
const cent = (x: number) => Math.round(x * 100) / 100;
const uuid = () => crypto.randomUUID();

interface Producto { clave: string; nombre: string; unidad: string; familia: string; familia_nombre: string; precio: string | null; existencia: string; tiene_iva: boolean; codigo_barras: string | null }
interface Linea { clave: string; nombre: string; unidad: string; precio: number; cantidad: string; descuento: string }
interface Pago { forma: string; importe: string; referencia: string }
interface Aut { usuario: string; pin: string }

// ---------------------------------------------------------------------------
// Autorización de supervisor (usuario + PIN)
// ---------------------------------------------------------------------------
function CamposAut({ aut, setAut, leyenda }: { aut: Aut; setAut: (a: Aut) => void; leyenda: string }) {
  return (
    <Card withBorder bg="var(--mantine-color-yellow-0)">
      <Text size="sm" fw={600}>{leyenda}</Text>
      <Group grow mt={4}>
        <TextInput label="Usuario del encargado" value={aut.usuario} onChange={(e) => setAut({ ...aut, usuario: e.currentTarget.value })} autoComplete="off" />
        <PasswordInput label="PIN" value={aut.pin} onChange={(e) => setAut({ ...aut, pin: e.currentTarget.value.replace(/\D/g, "") })} autoComplete="off" />
      </Group>
    </Card>
  );
}
const autOk = (a: Aut) => a.usuario.trim() && a.pin.length >= 4;
const autVacia = (): Aut => ({ usuario: "", pin: "" });

// ---------------------------------------------------------------------------
// Cobro
// ---------------------------------------------------------------------------
function Cobro({ total, formas, onCobrar, cargando, error, cerrar, titulo = "Cobrar" }: {
  total: number; formas: any[]; onCobrar: (pagos: Pago[]) => void; cargando: boolean; error: unknown; cerrar: () => void; titulo?: string;
}) {
  const efectivo = formas.find((f) => f.es_efectivo)?.clave ?? "01";
  const [pagos, setPagos] = useState<Pago[]>([{ forma: efectivo, importe: "", referencia: "" }]);
  const recibido = pagos.reduce((s, p) => s + n(p.importe), 0);
  const falta = cent(total - recibido);
  const cambio = cent(recibido - total);
  const setP = (i: number, c: Partial<Pago>) => setPagos(pagos.map((p, j) => (j === i ? { ...p, ...c } : p)));
  const rapidos = [total, ...[20, 50, 100, 200, 500].filter((b) => b > total)].slice(0, 5);
  return (
    <Modal opened onClose={cerrar} title={titulo} size="lg" centered>
      <Stack>
        <Group justify="space-between"><Text size="xl">Total a cobrar</Text><Text size="2rem" fw={800}>{$(total)}</Text></Group>
        {pagos.map((p, i) => {
          const f = formas.find((x) => x.clave === p.forma);
          return (
            <Card key={i} withBorder>
              <SegmentedControl fullWidth value={p.forma} onChange={(v) => setP(i, { forma: v })} data={formas.map((x) => ({ value: x.clave, label: x.nombre }))} />
              <Group mt="xs" grow align="flex-end">
                <TextInput size="lg" label="Importe" placeholder="0.00" value={p.importe} onChange={(e) => setP(i, { importe: e.currentTarget.value })} />
                {f?.requiere_referencia && <TextInput size="lg" label="Referencia o autorización del voucher" description="Nunca el número de la tarjeta" value={p.referencia} onChange={(e) => setP(i, { referencia: e.currentTarget.value })} />}
              </Group>
              {f?.es_efectivo && (
                <Group mt="xs" gap="xs">{rapidos.map((b) => <Button key={b} variant="light" onClick={() => setP(i, { importe: String(b) })}>{b === total ? "Exacto" : $(b)}</Button>)}</Group>
              )}
              {pagos.length > 1 && <Button variant="subtle" color="red" size="xs" mt="xs" onClick={() => setPagos(pagos.filter((_, j) => j !== i))}>Quitar este pago</Button>}
            </Card>
          );
        })}
        {falta > 0 && recibido > 0 && <Button variant="default" onClick={() => setPagos([...pagos, { forma: formas.find((x) => !x.es_efectivo)?.clave ?? efectivo, importe: String(falta), referencia: "" }])}>Agregar otra forma de pago (faltan {$(falta)})</Button>}
        <Group justify="space-between">
          <Text size="lg">{falta > 0 ? "Falta" : "Cambio"}</Text>
          <Text size="1.8rem" fw={800} c={falta > 0 ? "red" : "green"}>{$(falta > 0 ? falta : cambio)}</Text>
        </Group>
        {!!error && <Alert color="red">{textoError(error)}</Alert>}
        <Button size="xl" color="green" loading={cargando} disabled={falta > 0} onClick={() => onCobrar(pagos.filter((p) => n(p.importe) > 0).map((p) => ({ ...p, importe: p.importe.replaceAll(",", "") })))}>Cobrar e imprimir ticket</Button>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ventanas de operación
// ---------------------------------------------------------------------------
function Efectivo({ cerrar, alTerminar }: { cerrar: () => void; alTerminar: () => void }) {
  const [tipo, setTipo] = useState<"RETIRO" | "INGRESO">("RETIRO");
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState("");
  const [aut, setAut] = useState(autVacia());
  const m = useMutation({ mutationFn: () => POST("/api/pos/efectivo", { tipo, importe, motivo, autorizacion: aut }), onSuccess: () => { impresoraNavegador.imprimir({ titulo: tipo === "RETIRO" ? "RETIRO DE EFECTIVO" : "INGRESO DE EFECTIVO", lineas: [["Importe", $(importe)], ["Motivo", motivo], ["Autorizó", aut.usuario]] }); alTerminar(); cerrar(); } });
  return (
    <Modal opened onClose={cerrar} title="Retiro o ingreso de efectivo" size="md" centered>
      <Stack>
        <SegmentedControl value={tipo} onChange={(v) => setTipo(v as any)} data={[{ value: "RETIRO", label: "Retiro (sangría)" }, { value: "INGRESO", label: "Ingreso (cambio)" }]} />
        <TextInput size="lg" label="Importe" value={importe} onChange={(e) => setImporte(e.currentTarget.value)} />
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <CamposAut aut={aut} setAut={setAut} leyenda="Lo autoriza un encargado" />
        {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
        <Button size="lg" loading={m.isPending} disabled={!n(importe) || motivo.trim().length < 3 || !autOk(aut)} onClick={() => m.mutate()}>Registrar</Button>
      </Stack>
    </Modal>
  );
}

function Devolucion({ formas, cerrar, alTerminar }: { formas: any[]; cerrar: () => void; alTerminar: () => void }) {
  const [folio, setFolio] = useState("");
  const [buscar, setBuscar] = useState<string | null>(null);
  const v = useQuery({ queryKey: ["pos-ticket", buscar], queryFn: () => GET(`/api/pos/ventas/${encodeURIComponent(buscar!)}`), enabled: !!buscar });
  const [cant, setCant] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState("");
  const [regresa, setRegresa] = useState(true);
  const [forma, setForma] = useState("01");
  const [aut, setAut] = useState(autVacia());
  const m = useMutation({
    mutationFn: () => POST("/api/pos/devoluciones", { venta: buscar, motivo, regresa_inventario: regresa, forma, renglones: Object.entries(cant).filter(([, x]) => n(x) > 0).map(([orden, cantidad]) => ({ orden: Number(orden), cantidad })), autorizacion: aut }),
    onSuccess: (x: any) => { impresoraNavegador.imprimir({ titulo: `DEVOLUCIÓN ${x.folio}`, lineas: [["Venta", x.venta], ["Importe devuelto", $(x.importe)], ["Motivo", motivo]] }); alTerminar(); cerrar(); },
  });
  const total = (v.data?.renglones ?? []).reduce((s: number, r: any) => s + (n(cant[r.orden] ?? "") / Number(r.cantidad)) * Number(r.importe), 0);
  return (
    <Modal opened onClose={cerrar} title="Devolución" size="xl" centered>
      <Stack>
        <Group align="flex-end"><TextInput label="Folio del ticket" value={folio} onChange={(e) => setFolio(e.currentTarget.value.toUpperCase())} /><Button onClick={() => setBuscar(folio.trim())}>Buscar</Button></Group>
        {v.error && <Alert color="red">{textoError(v.error)}</Alert>}
        {v.data && (
          <>
            <Text size="sm">{v.data.folio} · {fechaHora(v.data.fecha)} · total {$(v.data.total)}{Number(v.data.devuelto) ? ` · ya devuelto ${$(v.data.devuelto)}` : ""}</Text>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Producto</Table.Th><Table.Th>Vendido</Table.Th><Table.Th>Ya devuelto</Table.Th><Table.Th>Importe</Table.Th><Table.Th>Devolver</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{v.data.renglones.map((r: any) => (
                <Table.Tr key={r.orden}><Table.Td>{r.nombre}</Table.Td><Table.Td>{Number(r.cantidad)}</Table.Td><Table.Td>{Number(r.cantidad_devuelta) || ""}</Table.Td><Table.Td>{$(r.importe)}</Table.Td>
                  <Table.Td><TextInput w={90} value={cant[r.orden] ?? ""} onChange={(e) => { const x = e.currentTarget.value; setCant((s) => ({ ...s, [r.orden]: x })); }} /></Table.Td></Table.Tr>
              ))}</Table.Tbody>
            </Table>
            <Text fw={700}>A devolver (aprox.): {$(cent(total))}</Text>
            <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
            <Group>
              <Checkbox label="El producto regresa a la vitrina (está en buen estado)" checked={regresa} onChange={(e) => setRegresa(e.currentTarget.checked)} />
              <Select label="Se devuelve en" w={200} value={forma} onChange={(x) => setForma(x ?? "01")} data={formas.map((f) => ({ value: f.clave, label: f.nombre }))} />
            </Group>
            <CamposAut aut={aut} setAut={setAut} leyenda="La autoriza un encargado (no quien hizo la venta)" />
            {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
            <Button size="lg" color="orange" loading={m.isPending} disabled={!total || motivo.trim().length < 3 || !autOk(aut)} onClick={() => m.mutate()}>Registrar devolución</Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}

function Corte({ estado, cerrar, alTerminar }: { estado: any; cerrar: () => void; alTerminar: () => void }) {
  const [tipo, setTipo] = useState<"X" | "Z">("X");
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [comentario, setComentario] = useState("");
  const [aut, setAut] = useState(autVacia());
  const r = estado.turno.resumen;
  const contado = estado.denominaciones.reduce((s: number, d: any) => s + Number(d.valor) * (conteo[d.valor] ?? 0), 0);
  const dif = cent(contado - Number(r.efectivo_esperado));
  const cierraSolo = estado.cajero.permisos.includes("pos.caja:cerrar");
  const m = useMutation({
    mutationFn: () => POST("/api/pos/cortes", tipo === "X" ? { tipo } : { tipo, comentario: comentario || null, denominaciones: Object.entries(conteo).map(([valor, cantidad]) => ({ valor, cantidad })), autorizacion: autOk(aut) ? aut : null }),
    onSuccess: (x: any) => {
      const s = x.resumen;
      impresoraNavegador.imprimir({ titulo: `CORTE ${tipo} · ${x.turno}`, lineas: [
        ["Ventas", `${s.ventas} · ${$(s.total)}`], ...s.por_forma.map((f: any) => [f.nombre, $(f.importe)] as [string, string]),
        ["Fondo", $(s.fondo)], ["Anticipos", $(s.anticipos)], ["Retiros", $(s.retiros)], ["Devoluciones", $(s.devoluciones)],
        ["Efectivo esperado", $(s.efectivo_esperado)], ...(tipo === "Z" ? [["Contado", $(x.contado)], ["Diferencia", $(x.diferencia)]] as [string, string][] : []),
      ] });
      alTerminar(); cerrar();
    },
  });
  return (
    <Modal opened onClose={cerrar} title="Corte de caja" size="xl" centered>
      <Stack>
        <SegmentedControl value={tipo} onChange={(v) => setTipo(v as any)} data={[{ value: "X", label: "Corte X (parcial, no cierra)" }, { value: "Z", label: "Corte Z (cierre del turno)" }]} />
        <SimpleGrid cols={3}>
          <Card withBorder><Text size="xs">Ventas</Text><Text fw={700}>{r.ventas} · {$(r.total)}</Text></Card>
          <Card withBorder><Text size="xs">Retiros / devoluciones</Text><Text fw={700}>{$(r.retiros)} / {$(r.devoluciones)}</Text></Card>
          <Card withBorder><Text size="xs">Efectivo esperado</Text><Text fw={700}>{$(r.efectivo_esperado)}</Text></Card>
        </SimpleGrid>
        {tipo === "Z" && (
          <>
            <Text size="sm">Cuenta el efectivo de la caja (incluido el fondo):</Text>
            <SimpleGrid cols={{ base: 3, md: 6 }}>
              {estado.denominaciones.map((d: any) => (
                <NumberInput key={d.valor} label={$(d.valor)} min={0} allowDecimal={false} value={conteo[d.valor] ?? 0} onChange={(v) => setConteo((s) => ({ ...s, [d.valor]: Number(v) || 0 }))} />
              ))}
            </SimpleGrid>
            <Group justify="space-between"><Text>Contado: <b>{$(contado)}</b></Text><Text c={dif === 0 ? "green" : "red"} fw={700}>Diferencia: {$(dif)}</Text></Group>
            {dif !== 0 && <Textarea label="Explica la diferencia" value={comentario} onChange={(e) => setComentario(e.currentTarget.value)} />}
            {(!cierraSolo || dif !== 0) && <CamposAut aut={aut} setAut={setAut} leyenda="El cierre lo autoriza un encargado" />}
          </>
        )}
        {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
        <Button size="lg" color={tipo === "Z" ? "red" : "blue"} loading={m.isPending} onClick={() => m.mutate()}>{tipo === "Z" ? "Cerrar turno e imprimir corte" : "Imprimir corte X"}</Button>
      </Stack>
    </Modal>
  );
}

function CambioCajero({ cerrar, alTerminar }: { cerrar: () => void; alTerminar: () => void }) {
  const [a, setA] = useState(autVacia());
  const m = useMutation({ mutationFn: () => POST("/api/auth/cajero", a), onSuccess: () => { alTerminar(); cerrar(); } });
  return (
    <Modal opened onClose={cerrar} title="Cambio de cajero" size="sm" centered>
      <Stack>
        <TextInput label="Usuario" value={a.usuario} onChange={(e) => setA({ ...a, usuario: e.currentTarget.value })} autoComplete="off" />
        <PasswordInput label="PIN" value={a.pin} onChange={(e) => setA({ ...a, pin: e.currentTarget.value.replace(/\D/g, "") })} />
        {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
        <Button size="lg" loading={m.isPending} disabled={!autOk(a)} onClick={() => m.mutate()}>Entrar a la caja</Button>
      </Stack>
    </Modal>
  );
}

function Pedidos({ estado, productos, cerrar, alTerminar }: { estado: any; productos: Producto[]; cerrar: () => void; alTerminar: () => void }) {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ["pos-pedidos"], queryFn: () => GET("/api/pos/pedidos?estatus=REGISTRADO") });
  const [nuevo, setNuevo] = useState({ cliente_nombre: "", telefono: "", fecha: "", notas: "", anticipo: "", forma: "01" });
  const [renglones, setRenglones] = useState<{ articulo: string | null; cantidad: string; especificaciones: string }[]>([{ articulo: null, cantidad: "1", especificaciones: "" }]);
  const [accion, setAccion] = useState<{ tipo: "abonar" | "entregar" | "cancelar"; p: any } | null>(null);
  const [abono, setAbono] = useState({ importe: "", forma: "01" });
  const [cancel, setCancel] = useState({ destino: "DEVUELTO", motivo: "" });
  const [aut, setAut] = useState(autVacia());
  const [autSin, setAutSin] = useState(autVacia());
  const refrescar = () => { qc.invalidateQueries({ queryKey: ["pos-pedidos"] }); alTerminar(); };
  const crear = useMutation({
    mutationFn: () => POST("/api/pos/pedidos", {
      cliente_nombre: nuevo.cliente_nombre, telefono: nuevo.telefono || null, fecha_entrega: fechaIso(nuevo.fecha), notas: nuevo.notas || null,
      renglones: renglones.filter((r) => r.articulo && n(r.cantidad) > 0).map((r) => ({ articulo: r.articulo, cantidad: r.cantidad, especificaciones: r.especificaciones || null })),
      anticipo: n(nuevo.anticipo) > 0 ? { forma: nuevo.forma, importe: nuevo.anticipo } : null,
      autorizacion: n(nuevo.anticipo) > 0 ? null : autSin,
    }),
    onSuccess: (x: any) => { impresoraNavegador.imprimir({ titulo: `PEDIDO ${x.folio}`, lineas: [["Cliente", nuevo.cliente_nombre], ["Entrega", nuevo.fecha], ["Total", $(x.total)], ["Anticipo", $(x.anticipo?.importe ?? 0)], ["Saldo", $(n(x.total) - n(x.anticipo?.importe ?? "0"))]] }); setNuevo({ cliente_nombre: "", telefono: "", fecha: "", notas: "", anticipo: "", forma: "01" }); setRenglones([{ articulo: null, cantidad: "1", especificaciones: "" }]); refrescar(); },
  });
  const abonar = useMutation({ mutationFn: () => POST(`/api/pos/pedidos/${accion!.p.id}/abonar`, { forma: abono.forma, importe: abono.importe }), onSuccess: () => { setAccion(null); refrescar(); } });
  const cancelar = useMutation({ mutationFn: () => POST(`/api/pos/pedidos/${accion!.p.id}/cancelar`, { ...cancel, autorizacion: aut }), onSuccess: () => { setAccion(null); refrescar(); } });
  const entregar = useMutation({
    mutationFn: (pagos: Pago[]) => POST(`/api/pos/pedidos/${accion!.p.id}/entregar`, { venta_id: uuid(), pagos }),
    onSuccess: async (x: any) => { impresoraNavegador.imprimir(await GET(`/api/pos/ventas/${x.id}`)); setAccion(null); refrescar(); },
  });
  const opciones = productos.filter((p) => p.precio).map((p) => ({ value: p.clave, label: `${p.nombre} · ${$(p.precio)}` }));
  const total = renglones.reduce((s, r) => s + n(productos.find((p) => p.clave === r.articulo)?.precio ?? "0") * n(r.cantidad), 0);
  return (
    <Modal opened onClose={cerrar} title="Pedidos" size="90%" centered>
      <Tabs defaultValue="lista">
        <Tabs.List><Tabs.Tab value="lista">Por entregar</Tabs.Tab><Tabs.Tab value="nuevo">Nuevo pedido</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="lista" pt="md">
          <Table striped>
            <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Entrega</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Productos</Table.Th><Table.Th>Total</Table.Th><Table.Th>Anticipo</Table.Th><Table.Th>Saldo</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>{(lista.data?.pedidos ?? []).filter((p: any) => p.sucursal === estado.caja.sucursal).map((p: any) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.folio}</Table.Td><Table.Td>{fecha(p.fecha_entrega)}</Table.Td><Table.Td>{p.cliente_nombre}<Text size="xs" c="dimmed">{p.telefono}</Text></Table.Td>
                <Table.Td>{p.renglones.map((r: any) => <Text key={r.articulo} size="xs">{Number(r.cantidad)} × {r.nombre}{r.especificaciones ? ` (${r.especificaciones})` : ""}</Text>)}{p.notas && <Text size="xs" c="dimmed">{p.notas}</Text>}</Table.Td>
                <Table.Td>{$(p.total)}</Table.Td><Table.Td>{$(p.anticipado)}</Table.Td><Table.Td fw={700}>{$(p.saldo)}</Table.Td>
                <Table.Td><Group gap={4} wrap="nowrap">
                  <Button size="xs" color="green" onClick={() => setAccion({ tipo: "entregar", p })}>Entregar</Button>
                  <Button size="xs" variant="light" onClick={() => setAccion({ tipo: "abonar", p })}>Abonar</Button>
                  <Button size="xs" variant="light" color="red" onClick={() => setAccion({ tipo: "cancelar", p })}>Cancelar</Button>
                </Group></Table.Td>
              </Table.Tr>
            ))}</Table.Tbody>
          </Table>
          {lista.data && !lista.data.pedidos.length && <Text c="dimmed" size="sm">No hay pedidos por entregar.</Text>}
        </Tabs.Panel>
        <Tabs.Panel value="nuevo" pt="md">
          <Stack>
            <Group grow>
              <TextInput label="Cliente" value={nuevo.cliente_nombre} onChange={(e) => setNuevo({ ...nuevo, cliente_nombre: e.currentTarget.value })} />
              <TextInput label="Teléfono" value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.currentTarget.value })} />
              <TextInput label="Fecha de entrega" placeholder="DD/MM/AAAA" value={nuevo.fecha} error={nuevo.fecha && !fechaIso(nuevo.fecha) ? "No válida" : undefined} onChange={(e) => setNuevo({ ...nuevo, fecha: e.currentTarget.value })} />
            </Group>
            {renglones.map((r, i) => (
              <Group key={i} align="flex-end">
                <Select label={i === 0 ? "Producto" : undefined} searchable w={320} data={opciones} value={r.articulo} onChange={(v) => setRenglones(renglones.map((x, j) => (j === i ? { ...x, articulo: v } : x)))} />
                <TextInput label={i === 0 ? "Cantidad" : undefined} w={90} value={r.cantidad} onChange={(e) => { const v = e.currentTarget.value; setRenglones(renglones.map((x, j) => (j === i ? { ...x, cantidad: v } : x))); }} />
                <TextInput label={i === 0 ? "Especificaciones" : undefined} w={280} value={r.especificaciones} onChange={(e) => { const v = e.currentTarget.value; setRenglones(renglones.map((x, j) => (j === i ? { ...x, especificaciones: v } : x))); }} />
              </Group>
            ))}
            <Button variant="default" w={180} onClick={() => setRenglones([...renglones, { articulo: null, cantidad: "1", especificaciones: "" }])}>Agregar producto</Button>
            <Textarea label="Notas (decoración, texto, etc.)" value={nuevo.notas} onChange={(e) => setNuevo({ ...nuevo, notas: e.currentTarget.value })} />
            <Group align="flex-end">
              <Text fw={700} size="lg">Total: {$(cent(total))}</Text>
              <TextInput label="Anticipo" w={130} value={nuevo.anticipo} onChange={(e) => setNuevo({ ...nuevo, anticipo: e.currentTarget.value })} />
              <Select label="Forma de pago" w={200} value={nuevo.forma} onChange={(v) => setNuevo({ ...nuevo, forma: v ?? "01" })} data={estado.formas.filter((f: any) => !f.requiere_referencia).map((f: any) => ({ value: f.clave, label: f.nombre }))} />
            </Group>
            {!n(nuevo.anticipo) && <CamposAut aut={autSin} setAut={setAutSin} leyenda="Sin anticipo: lo autoriza el contador o el contralor" />}
            {crear.error && <Alert color="red">{textoError(crear.error)}</Alert>}
            <Button size="lg" loading={crear.isPending} disabled={!nuevo.cliente_nombre || !fechaIso(nuevo.fecha) || !total || (!n(nuevo.anticipo) && !autOk(autSin))} onClick={() => crear.mutate()}>Registrar pedido</Button>
          </Stack>
        </Tabs.Panel>
      </Tabs>
      {accion?.tipo === "abonar" && (
        <Modal opened onClose={() => setAccion(null)} title={`Abono a ${accion.p.folio} (saldo ${$(accion.p.saldo)})`} centered>
          <Stack>
            <TextInput size="lg" label="Importe" value={abono.importe} onChange={(e) => setAbono({ ...abono, importe: e.currentTarget.value })} />
            <Select label="Forma de pago" value={abono.forma} onChange={(v) => setAbono({ ...abono, forma: v ?? "01" })} data={estado.formas.filter((f: any) => !f.requiere_referencia).map((f: any) => ({ value: f.clave, label: f.nombre }))} />
            {abonar.error && <Alert color="red">{textoError(abonar.error)}</Alert>}
            <Button loading={abonar.isPending} disabled={!n(abono.importe)} onClick={() => abonar.mutate()}>Registrar abono</Button>
          </Stack>
        </Modal>
      )}
      {accion?.tipo === "entregar" && <Cobro titulo={`Entrega de ${accion.p.folio}: saldo por cobrar`} total={n(accion.p.saldo)} formas={estado.formas} onCobrar={(p) => entregar.mutate(p)} cargando={entregar.isPending} error={entregar.error} cerrar={() => setAccion(null)} />}
      {accion?.tipo === "cancelar" && (
        <Modal opened onClose={() => setAccion(null)} title={`Cancelar ${accion.p.folio}`} centered>
          <Stack>
            {n(accion.p.anticipado) > 0 && <SegmentedControl value={cancel.destino} onChange={(v) => setCancel({ ...cancel, destino: v })} data={[{ value: "DEVUELTO", label: `Devolver anticipo (${$(accion.p.anticipado)})` }, { value: "RETENIDO", label: "Se retiene el anticipo" }]} />}
            <TextInput label="Motivo" value={cancel.motivo} onChange={(e) => setCancel({ ...cancel, motivo: e.currentTarget.value })} />
            <CamposAut aut={aut} setAut={setAut} leyenda="La cancelación la autoriza un encargado" />
            {cancelar.error && <Alert color="red">{textoError(cancelar.error)}</Alert>}
            <Button color="red" loading={cancelar.isPending} disabled={cancel.motivo.trim().length < 3 || !autOk(aut)} onClick={() => cancelar.mutate()}>Cancelar pedido</Button>
          </Stack>
        </Modal>
      )}
    </Modal>
  );
}

function VentasTurno({ cerrar }: { cerrar: () => void }) {
  const v = useQuery({ queryKey: ["pos-ventas-turno"], queryFn: () => GET("/api/pos/ventas?turno=actual") });
  return (
    <Modal opened onClose={cerrar} title="Ventas del turno" size="lg" centered>
      <Table striped>
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Hora</Table.Th><Table.Th>Total</Table.Th><Table.Th>Cajero</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>{(v.data?.ventas ?? []).map((x: any) => (
          <Table.Tr key={x.id}><Table.Td>{x.folio}{x.estatus !== "PAGADA" && <Badge ml={4} size="xs" color="orange">{x.estatus === "DEVUELTA" ? "devuelta" : "dev. parcial"}</Badge>}{x.pedido && <Badge ml={4} size="xs">{x.pedido}</Badge>}</Table.Td>
            <Table.Td>{fechaHora(x.fecha).slice(-5)}</Table.Td><Table.Td>{$(x.total)}</Table.Td><Table.Td>{x.cajero}</Table.Td>
            <Table.Td><Button size="xs" variant="light" onClick={async () => impresoraNavegador.imprimir(await GET(`/api/pos/ventas/${x.id}`))}>Reimprimir</Button></Table.Td></Table.Tr>
        ))}</Table.Tbody>
      </Table>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------
export function Pos() {
  const { yo, recargar } = useSesion();
  const qc = useQueryClient();
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [pendientes, setPendientes] = useState<VentaPendiente[]>(cola.leer());
  // Con internet se guarda una copia; sin internet se trabaja con la última copia (P43).
  const conCopia = (clave: string, ruta: string) => async () => {
    try {
      const d = await GET(ruta);
      copia.guardar(clave, d);
      setEnLinea(true);
      return d;
    } catch (e) {
      const c = copia.leer<any>(clave);
      if (esErrorDeRed(e) && c) { setEnLinea(false); return c.datos; }
      throw e;
    }
  };
  const estado = useQuery({ queryKey: ["pos-estado"], queryFn: conCopia("estado", "/api/pos/estado") });
  const enCaja = estado.data && !estado.data.sin_caja;
  const productos = useQuery<{ productos: Producto[] }>({ queryKey: ["pos-productos"], queryFn: conCopia("productos", "/api/pos/productos"), enabled: !!enCaja });
  const [familia, setFamilia] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [carrito, setCarrito] = useState<Linea[]>([]);
  const [ventana, setVentana] = useState<string | null>(null);
  const [descuentoDe, setDescuentoDe] = useState<number | null>(null);
  const [aut, setAut] = useState(autVacia());
  const [aviso, setAviso] = useState<string | null>(null);
  const [fondo, setFondo] = useState("");
  const [ventaId, setVentaId] = useState(uuid());
  const refrescar = () => { qc.invalidateQueries({ queryKey: ["pos-estado"] }); qc.invalidateQueries({ queryKey: ["pos-productos"] }); };
  const usarCaja = useMutation({ mutationFn: (id: string) => POST("/api/auth/caja", { caja_id: id }), onSuccess: () => { recargar(); refrescar(); } });
  const abrir = useMutation({ mutationFn: () => POST("/api/pos/turno", { fondo: fondo || "0" }), onSuccess: refrescar });
  const hayDescuento = carrito.some((l) => n(l.descuento) > 0);
  const ventaSinConexion = (pagos: Pago[]) => {
    // Sin internet: no se autorizan descuentos y se cuida la existencia con la última copia.
    if (hayDescuento) throw new Error("Sin conexión no se pueden autorizar descuentos. Quita el descuento o espera a que regrese el internet.");
    const prods = (productos.data?.productos ?? []) as Producto[];
    for (const l of carrito) {
      const p = prods.find((x) => x.clave === l.clave);
      if (!p || n(p.existencia) < n(l.cantidad)) throw new Error(`Sin existencia suficiente de ${l.nombre}: no se puede vender.`);
    }
    const recibido = pagos.reduce((s, p) => s + n(p.importe), 0);
    const e0 = estado.data;
    const folio = folioLocal(e0.caja.clave);
    const fecha = new Date().toISOString();
    const cuerpo = { id: ventaId, renglones: carrito.map((l) => ({ articulo: l.clave, cantidad: l.cantidad, descuento: null })), pagos, sin_conexion: { fecha_caja: fecha, folio_local: folio } };
    cola.agregar({ id: ventaId, cuerpo, folio_local: folio, total, fecha });
    const nuevos = prods.map((p) => { const l = carrito.find((x) => x.clave === p.clave); return l ? { ...p, existencia: String(n(p.existencia) - n(l.cantidad)) } : p; });
    qc.setQueryData(["pos-productos"], { productos: nuevos });
    copia.guardar("productos", { productos: nuevos });
    impresoraNavegador.imprimir({
      folio, fecha, sucursal: e0.caja.sucursal_nombre, caja: e0.caja.nombre, cajero: e0.cajero.nombre, provisional: true,
      renglones: carrito.map((l) => ({ nombre: l.nombre, cantidad: l.cantidad, unidad: l.unidad, precio: String(l.precio), descuento: "0", importe: String(cent(l.precio * n(l.cantidad))) })),
      subtotal: String(total), ieps: "0", iva: "0", descuento: "0", total: String(total),
      pagos: pagos.map((p) => ({ forma: e0.formas.find((f: any) => f.clave === p.forma)?.nombre ?? p.forma, importe: p.importe, referencia: p.referencia || null })),
      recibido: String(recibido), cambio: String(cent(recibido - total)),
    });
    setPendientes(cola.leer());
    return { folio, cambio: String(cent(recibido - total)), sin_conexion: true };
  };
  const cobrar = useMutation({
    mutationFn: async (pagos: Pago[]) => {
      if (!enLinea) return ventaSinConexion(pagos);
      try {
        return await POST("/api/pos/ventas", { id: ventaId, renglones: carrito.map((l) => ({ articulo: l.clave, cantidad: l.cantidad, descuento: l.descuento || null })), pagos, autorizacion: hayDescuento ? aut : null });
      } catch (e) {
        if (!esErrorDeRed(e)) throw e;
        setEnLinea(false);
        return ventaSinConexion(pagos);
      }
    },
    onSuccess: async (x: any) => {
      if (!x.sin_conexion) impresoraNavegador.imprimir(await GET(`/api/pos/ventas/${x.id}`));
      setAviso(x.sin_conexion ? `Venta ${x.folio} guardada SIN CONEXIÓN · cambio ${$(x.cambio)}` : `Venta ${x.folio} · cambio ${$(x.cambio)}`);
      setCarrito([]); setAut(autVacia()); setVentana(null); setVentaId(uuid());
      if (!x.sin_conexion) refrescar();
    },
  });
  // Envía las ventas guardadas sin conexión en cuanto haya internet (el servidor no las duplica).
  const sincronizar = async () => {
    for (const v of cola.leer()) {
      try {
        await POST("/api/pos/ventas", v.cuerpo);
        cola.quitar(v.id);
        setEnLinea(true);
      } catch (e) {
        if (esErrorDeRed(e)) { setEnLinea(false); break; }
        cola.marcar(v.id, textoError(e));
      }
    }
    setPendientes(cola.leer());
    refrescar();
  };
  useEffect(() => {
    const arriba = () => { setEnLinea(true); sincronizar(); };
    const abajo = () => setEnLinea(false);
    window.addEventListener("online", arriba);
    window.addEventListener("offline", abajo);
    const t = setInterval(() => { if (cola.leer().length) sincronizar(); }, 20000);
    return () => { window.removeEventListener("online", arriba); window.removeEventListener("offline", abajo); clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (aviso) { const t = setTimeout(() => setAviso(null), 6000); return () => clearTimeout(t); } }, [aviso]);
  const lista = productos.data?.productos ?? [];
  const familias = useMemo(() => [...new Map(lista.map((p) => [p.familia, p.familia_nombre])).entries()], [lista]);
  const visibles = lista.filter((p) => (buscar ? `${p.clave} ${p.nombre} ${p.codigo_barras ?? ""}`.toLowerCase().includes(buscar.toLowerCase()) : !familia || p.familia === familia));
  const total = cent(carrito.reduce((s, l) => s + cent(l.precio * n(l.cantidad)) - n(l.descuento), 0));
  const agregar = (p: Producto) => {
    if (!p.precio) return;
    setCarrito((c) => {
      const i = c.findIndex((l) => l.clave === p.clave);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, cantidad: String(n(l.cantidad) + 1) } : l));
      return [...c, { clave: p.clave, nombre: p.nombre, unidad: p.unidad, precio: Number(p.precio), cantidad: "1", descuento: "" }];
    });
  };
  const setLinea = (i: number, c: Partial<Linea>) => setCarrito((x) => x.map((l, j) => (j === i ? { ...l, ...c } : l)));

  if (estado.isLoading) return <Center h="100vh"><Loader /></Center>;
  if (estado.error) return <Center h="100vh"><Alert color="red">{textoError(estado.error)}</Alert></Center>;
  const e = estado.data;
  if (e.sin_caja) {
    return (
      <Center h="100vh"><Card withBorder w={480}>
        <Title order={3}>Punto de venta</Title>
        <Text size="sm" c="dimmed" mb="md">Esta computadora todavía no está en una caja. Elige la caja de esta sucursal.</Text>
        {!e.puede_abrir && <Alert color="yellow">Tu puesto no puede abrir una caja.</Alert>}
        <Stack>{e.cajas.map((c: any) => <Button key={c.id} size="lg" variant="light" disabled={!e.puede_abrir} loading={usarCaja.isPending} onClick={() => usarCaja.mutate(c.id)}>{c.nombre} · {c.sucursal}</Button>)}</Stack>
        {usarCaja.error && <Alert mt="sm" color="red">{textoError(usarCaja.error)}</Alert>}
        <Button mt="md" variant="subtle" component="a" href="/">Volver al sistema</Button>
      </Card></Center>
    );
  }
  const cabecera = (
    <Group justify="space-between" px="md" py={6} bg="var(--mantine-color-orange-6)" c="white">
      <Group gap="xs"><Text fw={800}>{e.caja.nombre}</Text><Text size="sm">{e.caja.nombre.includes(e.caja.sucursal_nombre) ? "" : `· ${e.caja.sucursal_nombre} `}· Cajero: <b>{e.cajero.nombre}</b>{e.turno ? ` · ${e.turno.folio}` : ""}</Text>{yo.ambiente && <Badge color="yellow">{yo.ambiente}</Badge>}</Group>
      <Group gap={6}>
        <Button size="xs" variant="white" onClick={() => setVentana("cajero")}>Cambiar cajero</Button>
        {e.turno && <>
          <Button size="xs" variant="white" disabled={!enLinea} onClick={() => setVentana("pedidos")}>Pedidos</Button>
          <Button size="xs" variant="white" disabled={!enLinea} onClick={() => setVentana("devolucion")}>Devolución</Button>
          <Button size="xs" variant="white" disabled={!enLinea} onClick={() => setVentana("efectivo")}>Retiro / ingreso</Button>
          <Button size="xs" variant="white" disabled={!enLinea} onClick={() => setVentana("ventas")}>Ventas del turno</Button>
          <Button size="xs" variant="white" color="red" disabled={!enLinea || pendientes.length > 0} onClick={() => setVentana("corte")}>Corte</Button>
        </>}
        <Button size="xs" variant="subtle" c="white" component="a" href="/">Salir</Button>
      </Group>
    </Group>
  );
  const avisoConexion = (!enLinea || pendientes.length > 0) && (
    <Group px="md" py={6} bg={enLinea ? "var(--mantine-color-yellow-2)" : "var(--mantine-color-red-7)"} c={enLinea ? "dark" : "white"} justify="space-between">
      <Text size="sm" fw={600}>
        {enLinea ? "Hay ventas hechas sin conexión por enviar." : "SIN CONEXIÓN: puedes seguir vendiendo; las ventas se guardan en esta computadora y se envían solas al volver el internet. Devoluciones, retiros, pedidos, descuentos y cortes esperan a la conexión."}
        {pendientes.length > 0 && ` Pendientes: ${pendientes.length}${pendientes.some((v) => v.error) ? ` (${pendientes.filter((v) => v.error).length} con problema: avisa al encargado)` : ""}.`}
      </Text>
      {pendientes.length > 0 && <Group gap={6}><Button size="xs" variant="white" onClick={() => setVentana("pendientes")}>Ver</Button><Button size="xs" variant="white" onClick={() => sincronizar()}>Enviar ahora</Button></Group>}
    </Group>
  );
  if (!e.turno) {
    return (
      <Box>{cabecera}<Center h="80vh"><Card withBorder w={420}>
        <Title order={3}>Abrir turno</Title>
        <Text size="sm" c="dimmed" mb="sm">Cuenta el fondo de caja con el que empiezas.</Text>
        <TextInput size="xl" label="Fondo inicial" placeholder={e.caja.fondo_sugerido ?? "0.00"} value={fondo} onChange={(x) => setFondo(x.currentTarget.value)} />
        {abrir.error && <Alert mt="sm" color="red">{textoError(abrir.error)}</Alert>}
        <Button mt="md" size="lg" fullWidth loading={abrir.isPending} onClick={() => abrir.mutate()}>Abrir turno</Button>
      </Card></Center>
      {ventana === "cajero" && <CambioCajero cerrar={() => setVentana(null)} alTerminar={() => { recargar(); refrescar(); }} />}</Box>
    );
  }
  return (
    <Box h="100vh" style={{ display: "flex", flexDirection: "column" }}>
      {cabecera}
      {avisoConexion}
      <Box style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Stack p="sm" style={{ flex: 1, minWidth: 0 }} gap="xs">
          <Group>
            <TextInput placeholder="Buscar producto o código" size="md" style={{ flex: 1 }} value={buscar} onChange={(x) => setBuscar(x.currentTarget.value)} />
            {buscar && <Button variant="subtle" onClick={() => setBuscar("")}>Limpiar</Button>}
          </Group>
          <Group gap={6}>
            <Button size="md" variant={!familia ? "filled" : "light"} onClick={() => setFamilia(null)}>Todos</Button>
            {familias.map(([k, nombre]) => <Button key={k} size="md" variant={familia === k ? "filled" : "light"} onClick={() => setFamilia(k)}>{nombre}</Button>)}
          </Group>
          <ScrollArea style={{ flex: 1 }}>
            <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="xs">
              {visibles.map((p) => {
                const sin = !p.precio || n(p.existencia) <= 0;
                return (
                  <UnstyledButton key={p.clave} onClick={() => agregar(p)} disabled={!p.precio} style={{ opacity: sin ? 0.5 : 1 }}>
                    <Card withBorder h={110} p="xs" bg={sin ? "var(--mantine-color-gray-1)" : "var(--mantine-color-orange-0)"}>
                      <Text fw={700} lineClamp={2}>{p.nombre}</Text>
                      <Text size="lg" fw={800} c="orange.8">{p.precio ? $(p.precio) : "Sin precio"}</Text>
                      <Text size="xs" c={n(p.existencia) > 0 ? "dimmed" : "red"}>Hay {Number(p.existencia)} {p.unidad}</Text>
                    </Card>
                  </UnstyledButton>
                );
              })}
            </SimpleGrid>
          </ScrollArea>
        </Stack>
        <Stack w={420} p="sm" gap="xs" style={{ borderLeft: "1px solid var(--mantine-color-gray-3)" }}>
          <ScrollArea style={{ flex: 1 }}>
            {!carrito.length && <Text c="dimmed" ta="center" mt="xl">Toca los productos para agregarlos.</Text>}
            {carrito.map((l, i) => (
              <Card key={l.clave} withBorder p="xs" mb={6}>
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={600} lineClamp={1}>{l.nombre}</Text>
                  <Text fw={700}>{$(cent(l.precio * n(l.cantidad)) - n(l.descuento))}</Text>
                </Group>
                <Group gap={6} mt={4}>
                  <ActionIcon size="lg" variant="light" onClick={() => n(l.cantidad) <= 1 ? setCarrito(carrito.filter((_, j) => j !== i)) : setLinea(i, { cantidad: String(n(l.cantidad) - 1) })}>−</ActionIcon>
                  <TextInput w={70} size="sm" value={l.cantidad} onChange={(x) => setLinea(i, { cantidad: x.currentTarget.value })} />
                  <ActionIcon size="lg" variant="light" onClick={() => setLinea(i, { cantidad: String(n(l.cantidad) + 1) })}>+</ActionIcon>
                  <Text size="xs" c="dimmed">× {$(l.precio)}</Text>
                  <Button size="compact-xs" variant="subtle" onClick={() => setDescuentoDe(i)}>{n(l.descuento) ? `Desc. ${$(l.descuento)}` : "Descuento"}</Button>
                  <ActionIcon ml="auto" color="red" variant="subtle" onClick={() => setCarrito(carrito.filter((_, j) => j !== i))}>✕</ActionIcon>
                </Group>
              </Card>
            ))}
          </ScrollArea>
          {aviso && <Alert color="green" py={6}>{aviso}</Alert>}
          <Divider />
          <Group justify="space-between"><Text size="xl">Total</Text><Text size="2.2rem" fw={800}>{$(total)}</Text></Group>
          {hayDescuento && <CamposAut aut={aut} setAut={setAut} leyenda="El descuento lo autoriza el contador o el contralor" />}
          <Group grow>
            <Button size="lg" variant="default" disabled={!carrito.length} onClick={() => setCarrito([])}>Cancelar</Button>
            <Button size="xl" color="green" disabled={!carrito.length || (hayDescuento && !autOk(aut))} onClick={() => { cobrar.reset(); setVentana("cobrar"); }}>Cobrar</Button>
          </Group>
        </Stack>
      </Box>
      {descuentoDe !== null && carrito[descuentoDe] && (
        <Modal opened onClose={() => setDescuentoDe(null)} title={`Descuento en ${carrito[descuentoDe]!.nombre}`} size="sm" centered>
          <Stack>
            <TextInput size="lg" label="Descuento en pesos" value={carrito[descuentoDe]!.descuento} onChange={(x) => setLinea(descuentoDe, { descuento: x.currentTarget.value })} />
            <Text size="xs" c="dimmed">Lo tendrá que autorizar el contador o el contralor con su PIN al cobrar.</Text>
            <Button onClick={() => setDescuentoDe(null)}>Listo</Button>
          </Stack>
        </Modal>
      )}
      {ventana === "cobrar" && <Cobro total={total} formas={e.formas} onCobrar={(p) => cobrar.mutate(p)} cargando={cobrar.isPending} error={cobrar.error} cerrar={() => setVentana(null)} />}
      {ventana === "cajero" && <CambioCajero cerrar={() => setVentana(null)} alTerminar={() => { recargar(); refrescar(); }} />}
      {ventana === "efectivo" && <Efectivo cerrar={() => setVentana(null)} alTerminar={refrescar} />}
      {ventana === "devolucion" && <Devolucion formas={e.formas} cerrar={() => setVentana(null)} alTerminar={refrescar} />}
      {ventana === "corte" && <Corte estado={e} cerrar={() => setVentana(null)} alTerminar={refrescar} />}
      {ventana === "pedidos" && <Pedidos estado={e} productos={lista} cerrar={() => setVentana(null)} alTerminar={refrescar} />}
      {ventana === "ventas" && <VentasTurno cerrar={() => setVentana(null)} />}
      {ventana === "pendientes" && (
        <Modal opened onClose={() => setVentana(null)} title="Ventas hechas sin conexión" size="lg" centered>
          <Text size="sm" mb="sm">Se envían solas al volver el internet. Si una tiene problema (por ejemplo, el sistema ya no tiene existencia porque se registró una merma), el encargado debe corregir el inventario y luego presionar "Enviar ahora". No se borran: la venta ya ocurrió.</Text>
          <Table>
            <Table.Thead><Table.Tr><Table.Th>Folio provisional</Table.Th><Table.Th>Hora</Table.Th><Table.Th>Total</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{pendientes.map((v) => <Table.Tr key={v.id}><Table.Td>{v.folio_local}</Table.Td><Table.Td>{fechaHora(v.fecha)}</Table.Td><Table.Td>{$(v.total)}</Table.Td><Table.Td>{v.error ? <Text size="xs" c="red">{v.error}</Text> : "Por enviar"}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        </Modal>
      )}
    </Box>
  );
}
