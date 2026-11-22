// Contabilidad (Fase 7): pólizas automáticas y manuales, reglas de
// contabilización, balanza, auxiliares, libro diario, estados financieros,
// conciliación del inventario contra el kárdex y cierre de periodo. Los botones
// se muestran según permisos; el servidor valida de nuevo.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Badge, Button, Card, Group, Modal, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from "@mantine/core";
import { descargar, GET, POST, PUT, textoError } from "../api";
import { fecha, fechaHora, fechaIso, numero } from "../formato";
import { useSesion } from "../sesion";

const $ = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  const x = Number(Number(v).toFixed(2));
  return `${x < 0 ? "-" : ""}$${numero(Math.abs(x), 2)}`;
};
const hoyIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
const primeroDeMes = () => `${hoyIso().slice(0, 8)}01`;
const COLOR: Record<string, string> = { APLICADA: "green", POR_AUTORIZAR: "orange", RECHAZADA: "red", CANCELADA: "gray" };
const TIPO: Record<string, string> = { I: "Ingreso", E: "Egreso", D: "Diario" };
const ORIGEN: Record<string, string> = {
  MANUAL: "Manual", MOVIMIENTO: "Inventario", ORDEN_PRODUCCION: "Producción", VENTA: "Venta", DEVOLUCION: "Devolución", MOVIMIENTO_CAJA: "Caja",
  CORTE: "Corte Z", PEDIDO_RETENIDO: "Pedido cancelado", FACTURA_PROVEEDOR: "Factura de proveedor", PAGO_PROVEEDOR: "Pago a proveedor", TRASPASO_FALTANTE: "Faltante de traspaso",
};
const Est = ({ e }: { e: string }) => <Badge color={COLOR[e] ?? "gray"} variant="light">{e === "POR_AUTORIZAR" ? "Por autorizar" : e.charAt(0) + e.slice(1).toLowerCase()}</Badge>;

function Periodo({ desde, hasta, onChange, sinDesde }: { desde: string; hasta: string; onChange: (d: string, h: string) => void; sinDesde?: boolean }) {
  const [d, setD] = useState(fecha(desde));
  const [h, setH] = useState(fecha(hasta));
  return (
    <Group align="flex-end">
      {!sinDesde && <TextInput label="Desde" w={130} value={d} onChange={(e) => setD(e.currentTarget.value)} placeholder="DD/MM/AAAA" />}
      <TextInput label={sinDesde ? "Al" : "Hasta"} w={130} value={h} onChange={(e) => setH(e.currentTarget.value)} placeholder="DD/MM/AAAA" />
      <Button variant="default" onClick={() => { const a = sinDesde ? desde : fechaIso(d); const b = fechaIso(h); if (a && b) onChange(a, b); }}>Consultar</Button>
    </Group>
  );
}

function Exportar({ ruta, archivo }: { ruta: string; archivo: string }) {
  const { puede } = useSesion();
  const [err, setErr] = useState<string | null>(null);
  if (!puede("contabilidad.reportes:exportar", "contabilidad.polizas:exportar")) return null;
  return <Stack gap={2}><Button variant="default" onClick={() => descargar(ruta, archivo).then(() => setErr(null)).catch((e) => setErr(textoError(e)))}>Exportar a Excel</Button>{err && <Text size="xs" c="red">{err}</Text>}</Stack>;
}

// ---------------------------------------------------------------------------
// Pólizas
// ---------------------------------------------------------------------------
function Generar() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const previa = useQuery({ queryKey: ["k-previa"], queryFn: () => GET("/api/contabilidad/contabilizar") });
  const m = useMutation({ mutationFn: () => POST("/api/contabilidad/contabilizar"), onSuccess: () => { qc.invalidateQueries({ queryKey: ["k-polizas"] }); qc.invalidateQueries({ queryKey: ["k-previa"] }); } });
  const p = previa.data;
  return (
    <Card withBorder>
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fw={600}>Pólizas automáticas</Text>
          <Text size="sm" c="dimmed">Ventas, devoluciones, caja, inventarios, producción, facturas y pagos a proveedores se contabilizan con las reglas. Un documento se contabiliza una sola vez.</Text>
          {p && <Text size="sm" mt={4}>Por contabilizar: <b>{p.generadas}</b> documentos{p.pendientes.length ? <> · <Text span c="orange" fw={600}>{p.pendientes.length} pendientes</Text></> : ""}</Text>}
        </div>
        {puede("contabilidad.polizas:crear") && <Button loading={m.isPending} onClick={() => m.mutate()}>Generar pólizas</Button>}
      </Group>
      {m.error && <Alert mt="xs" color="red">{textoError(m.error)}</Alert>}
      {m.data && <Alert mt="xs" color="green">Se generaron {m.data.generadas} pólizas.</Alert>}
      {!!p?.pendientes.length && (
        <ScrollArea.Autosize mah={220} mt="xs">
          <Table fz="xs" withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Documento</Table.Th><Table.Th>Por qué está pendiente</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{p.pendientes.map((x: any, i: number) => <Table.Tr key={i}><Table.Td>{fecha(x.fecha)}</Table.Td><Table.Td>{x.concepto}</Table.Td><Table.Td c="orange">{x.motivo}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
    </Card>
  );
}

function DetallePoliza({ id, cerrar }: { id: string; cerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const r = useQuery({ queryKey: ["k-poliza", id], queryFn: () => GET(`/api/contabilidad/polizas/${id}`) });
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: (que: string) => POST(`/api/contabilidad/polizas/${id}/${que}`, { motivo: motivo || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["k-polizas"] }); r.refetch(); },
  });
  if (!r.data) return <Text>Cargando…</Text>;
  const p = r.data.poliza;
  const t = (k: "cargo" | "abono") => r.data.partidas.reduce((s: number, x: any) => s + Number(x[k]), 0);
  return (
    <Stack>
      <Group gap="xs"><Title order={3}>{p.folio}</Title><Est e={p.estatus} /><Badge variant="outline">{TIPO[p.tipo]}</Badge></Group>
      <Text>{p.concepto}</Text>
      <Text size="sm" c="dimmed">{fecha(p.fecha)} · {ORIGEN[p.origen] ?? p.origen}{p.origen_folio ? ` ${p.origen_folio}` : ""} · registró {p.registro}{p.autorizo ? ` · ${p.estatus === "RECHAZADA" ? "rechazó" : "autorizó"} ${p.autorizo}` : ""}{p.cancelo ? ` · canceló ${p.cancelo}` : ""}{p.motivo ? ` · ${p.motivo}` : ""}</Text>
      <Table withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th><Table.Th>Concepto</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th ta="right">Cargo</Table.Th><Table.Th ta="right">Abono</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {r.data.partidas.map((x: any) => <Table.Tr key={x.orden}><Table.Td>{x.cuenta}<Text size="xs" c="dimmed">{x.cuenta_nombre}</Text></Table.Td><Table.Td>{x.concepto}</Table.Td><Table.Td>{x.sucursal}</Table.Td><Table.Td ta="right">{Number(x.cargo) ? $(x.cargo) : ""}</Table.Td><Table.Td ta="right">{Number(x.abono) ? $(x.abono) : ""}</Table.Td></Table.Tr>)}
          <Table.Tr fw={700}><Table.Td colSpan={3}>Sumas iguales</Table.Td><Table.Td ta="right">{$(t("cargo"))}</Table.Td><Table.Td ta="right">{$(t("abono"))}</Table.Td></Table.Tr>
        </Table.Tbody>
      </Table>
      {p.periodo_estatus === "ABIERTO" && p.origen === "MANUAL" && ["POR_AUTORIZAR", "APLICADA"].includes(p.estatus) && (
        <Group align="flex-end">
          <TextInput label="Motivo (para rechazar o cancelar)" w={320} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
          {p.estatus === "POR_AUTORIZAR" && puede("contabilidad.polizas:autorizar") && <>
            <Button color="green" loading={m.isPending} onClick={() => m.mutate("autorizar")}>Autorizar</Button>
            <Button color="red" variant="light" loading={m.isPending} onClick={() => m.mutate("rechazar")}>Rechazar</Button>
          </>}
          {puede("contabilidad.polizas:cancelar") && <Button color="red" variant="subtle" loading={m.isPending} onClick={() => m.mutate("cancelar")}>Cancelar póliza</Button>}
        </Group>
      )}
      {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
      <Button variant="default" w={120} onClick={cerrar}>Cerrar</Button>
    </Stack>
  );
}

function Polizas() {
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso() });
  const [f, setF] = useState({ tipo: null as string | null, estatus: null as string | null, origen: null as string | null });
  const qs = new URLSearchParams({ desde: p.desde, hasta: p.hasta, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string> });
  const r = useQuery({ queryKey: ["k-polizas", qs.toString()], queryFn: () => GET(`/api/contabilidad/polizas?${qs}`) });
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <Stack>
      <Generar />
      <Group justify="space-between" align="flex-end">
        <Group align="flex-end">
          <Periodo desde={p.desde} hasta={p.hasta} onChange={(desde, hasta) => setP({ desde, hasta })} />
          <Select label="Tipo" w={120} clearable data={Object.entries(TIPO).map(([value, label]) => ({ value, label }))} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} />
          <Select label="Estatus" w={150} clearable data={[{ value: "APLICADA", label: "Aplicada" }, { value: "POR_AUTORIZAR", label: "Por autorizar" }, { value: "RECHAZADA", label: "Rechazada" }, { value: "CANCELADA", label: "Cancelada" }]} value={f.estatus} onChange={(v) => setF({ ...f, estatus: v })} />
          <Select label="Origen" w={190} clearable data={Object.entries(ORIGEN).map(([value, label]) => ({ value, label }))} value={f.origen} onChange={(v) => setF({ ...f, origen: v })} />
        </Group>
        <Exportar ruta={`/api/contabilidad/polizas?${qs}&formato=xlsx`} archivo={`polizas-${p.desde}-${p.hasta}.xlsx`} />
      </Group>
      <ScrollArea>
        <Table withTableBorder striped highlightOnHover fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Concepto</Table.Th><Table.Th>Origen</Table.Th><Table.Th>Estatus</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(r.data?.polizas ?? []).map((x: any) => (
            <Table.Tr key={x.id} style={{ cursor: "pointer" }} onClick={() => setAbierta(x.id)}>
              <Table.Td style={{ whiteSpace: "nowrap" }}>{x.folio}</Table.Td><Table.Td>{fecha(x.fecha)}</Table.Td><Table.Td>{x.concepto}</Table.Td>
              <Table.Td>{ORIGEN[x.origen] ?? x.origen}</Table.Td><Table.Td><Est e={x.estatus} /></Table.Td><Table.Td ta="right">{$(x.total)}</Table.Td>
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </ScrollArea>
      <Modal opened={!!abierta} onClose={() => setAbierta(null)} size="xl" title="Póliza">{abierta && <DetallePoliza id={abierta} cerrar={() => setAbierta(null)} />}</Modal>
    </Stack>
  );
}

function NuevaPoliza() {
  const qc = useQueryClient();
  const reglas = useQuery({ queryKey: ["k-reglas"], queryFn: () => GET("/api/contabilidad/reglas") });
  const vacia = () => ({ cuenta: null as string | null, cargo: "", abono: "", concepto: "" });
  const [x, setX] = useState({ tipo: "D", fecha: fecha(hoyIso()), concepto: "" });
  const [ps, setPs] = useState([vacia(), vacia()]);
  const m = useMutation({
    mutationFn: () => POST("/api/contabilidad/polizas", { tipo: x.tipo, fecha: fechaIso(x.fecha), concepto: x.concepto, partidas: ps.filter((p) => p.cuenta).map((p) => ({ ...p, cargo: p.cargo || null, abono: p.abono || null, concepto: p.concepto || null })) }),
    onSuccess: () => { setPs([vacia(), vacia()]); setX({ ...x, concepto: "" }); qc.invalidateQueries({ queryKey: ["k-polizas"] }); },
  });
  const suma = (k: "cargo" | "abono") => ps.reduce((s, p) => s + (Number(p[k].replaceAll(",", "")) || 0), 0);
  const cuentas = (reglas.data?.cuentas ?? []).map((c: any) => ({ value: c.clave, label: `${c.clave} · ${c.nombre}` }));
  const cambia = (i: number, k: string, v: string | null) => setPs(ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <Card withBorder>
      <Text fw={600}>Póliza manual</Text>
      <Text size="xs" c="dimmed" mb="sm">Para la apertura (saldos iniciales), provisiones, depreciaciones o reclasificaciones. Queda por autorizar: la autoriza el contralor (quien la captura no puede).</Text>
      <Group align="flex-end">
        <Select label="Tipo" w={120} data={Object.entries(TIPO).map(([value, label]) => ({ value, label }))} value={x.tipo} onChange={(v) => setX({ ...x, tipo: v ?? "D" })} />
        <TextInput label="Fecha" w={130} value={x.fecha} onChange={(e) => setX({ ...x, fecha: e.currentTarget.value })} />
        <TextInput label="Concepto" w={420} value={x.concepto} onChange={(e) => setX({ ...x, concepto: e.currentTarget.value })} />
      </Group>
      <Stack gap={6} mt="sm">
        {ps.map((p, i) => (
          <Group key={i} align="flex-end">
            <Select label={i === 0 ? "Cuenta" : undefined} searchable w={340} data={cuentas} value={p.cuenta} onChange={(v) => cambia(i, "cuenta", v)} />
            <TextInput label={i === 0 ? "Cargo" : undefined} w={130} value={p.cargo} onChange={(e) => cambia(i, "cargo", e.currentTarget.value)} />
            <TextInput label={i === 0 ? "Abono" : undefined} w={130} value={p.abono} onChange={(e) => cambia(i, "abono", e.currentTarget.value)} />
            <TextInput label={i === 0 ? "Concepto de la partida" : undefined} w={260} value={p.concepto} onChange={(e) => cambia(i, "concepto", e.currentTarget.value)} />
            {ps.length > 2 && <ActionIcon variant="subtle" color="red" mb={4} onClick={() => setPs(ps.filter((_, j) => j !== i))}>✕</ActionIcon>}
          </Group>
        ))}
        <Group>
          <Button variant="default" size="xs" onClick={() => setPs([...ps, vacia()])}>Agregar partida</Button>
          <Text size="sm">Cargos {$(suma("cargo"))} · Abonos {$(suma("abono"))} {Math.abs(suma("cargo") - suma("abono")) < 0.005 && suma("cargo") > 0 ? <Text span c="green">✔ cuadra</Text> : <Text span c="orange">diferencia {$(suma("cargo") - suma("abono"))}</Text>}</Text>
        </Group>
        {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
        {m.data && <Alert color="green">Póliza {m.data.folio} registrada: queda por autorizar.</Alert>}
        <Button w={180} loading={m.isPending} onClick={() => m.mutate()}>Registrar póliza</Button>
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------
function Reglas() {
  const r = useQuery({ queryKey: ["k-reglas"], queryFn: () => GET("/api/contabilidad/reglas") });
  const qc = useQueryClient();
  const [nueva, setNueva] = useState<{ concepto: string; sucursal: string | null; cuenta: string | null } | null>(null);
  const m = useMutation({ mutationFn: (d: any) => PUT("/api/contabilidad/reglas", d), onSuccess: () => { setNueva(null); qc.invalidateQueries({ queryKey: ["k-reglas"] }); qc.invalidateQueries({ queryKey: ["k-previa"] }); } });
  const cuentas = (r.data?.cuentas ?? []).map((c: any) => ({ value: c.clave, label: `${c.clave} · ${c.nombre}` }));
  const editar = r.data?.puede_editar;
  const faltan = (r.data?.conceptos ?? []).filter((k: any) => !k.reglas.some((x: any) => x.activo && !x.sucursal)).length;
  return (
    <Stack>
      <Text size="sm" c="dimmed">Cada operación genera conceptos (caja, ventas, IVA, inventario…). Aquí se dice a qué cuenta va cada uno; una regla de sucursal tiene preferencia sobre la general. Las cuentas las define el negocio con su contador. También se cargan por layout (Cargas masivas → Reglas de contabilización).</Text>
      {faltan > 0 && <Alert color="orange">{faltan} conceptos no tienen cuenta general: lo que los use queda pendiente de contabilizar.</Alert>}
      {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
      <Table withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Grupo</Table.Th><Table.Th>Concepto</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th>Cuenta</Table.Th>{editar && <Table.Th />}</Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.conceptos ?? []).flatMap((k: any) => {
          const filas = k.reglas.filter((x: any) => x.activo);
          const base = filas.length ? filas : [{ sucursal: null, cuenta: null }];
          return base.map((x: any, i: number) => (
            <Table.Tr key={`${k.clave}-${x.sucursal}`}>
              <Table.Td>{i === 0 ? k.grupo : ""}</Table.Td>
              <Table.Td>{i === 0 && <>{k.nombre}<Text size="xs" c="dimmed">{k.clave} · {k.descripcion}</Text></>}</Table.Td>
              <Table.Td>{x.sucursal ?? "Todas"}</Table.Td>
              <Table.Td>{editar ? <Select w={300} searchable clearable data={cuentas} value={x.cuenta} placeholder="Sin cuenta" onChange={(v) => m.mutate({ concepto: k.clave, sucursal: x.sucursal, cuenta: v })} /> : x.cuenta ? `${x.cuenta} · ${x.cuenta_nombre}` : <Text c="orange" size="sm">Sin cuenta</Text>}</Table.Td>
              {editar && <Table.Td>{i === 0 && <Button size="xs" variant="subtle" onClick={() => setNueva({ concepto: k.clave, sucursal: null, cuenta: null })}>+ por sucursal</Button>}</Table.Td>}
            </Table.Tr>
          ));
        })}</Table.Tbody>
      </Table>
      <Modal opened={!!nueva} onClose={() => setNueva(null)} title={`Regla por sucursal: ${nueva?.concepto}`} centered>
        {nueva && <Stack>
          <Select label="Sucursal" data={(r.data?.sucursales ?? []).map((s: any) => ({ value: s.clave, label: `${s.clave} · ${s.nombre}` }))} value={nueva.sucursal} onChange={(v) => setNueva({ ...nueva, sucursal: v })} />
          <Select label="Cuenta" searchable data={cuentas} value={nueva.cuenta} onChange={(v) => setNueva({ ...nueva, cuenta: v })} />
          <Button disabled={!nueva.sucursal || !nueva.cuenta} loading={m.isPending} onClick={() => m.mutate(nueva)}>Guardar</Button>
        </Stack>}
      </Modal>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------
function Balanza() {
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso() });
  const r = useQuery({ queryKey: ["k-balanza", p], queryFn: () => GET(`/api/contabilidad/balanza?desde=${p.desde}&hasta=${p.hasta}`) });
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Periodo desde={p.desde} hasta={p.hasta} onChange={(desde, hasta) => setP({ desde, hasta })} />
        <Exportar ruta={`/api/contabilidad/balanza?desde=${p.desde}&hasta=${p.hasta}&formato=xlsx`} archivo={`balanza-${p.desde}-${p.hasta}.xlsx`} />
      </Group>
      {r.data && <Text size="sm" c={r.data.cuadra ? "green" : "red"}>{r.data.cuadra ? "✔ La balanza cuadra" : "✖ La balanza no cuadra"}: cargos {$(r.data.totales.cargos)} · abonos {$(r.data.totales.abonos)}</Text>}
      <ScrollArea>
        <Table withTableBorder striped fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Cuenta</Table.Th><Table.Th>Nombre</Table.Th><Table.Th ta="right">Saldo inicial</Table.Th><Table.Th ta="right">Cargos</Table.Th><Table.Th ta="right">Abonos</Table.Th><Table.Th ta="right">Saldo final</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(r.data?.renglones ?? []).map((x: any) => (
            <Table.Tr key={x.clave} fw={x.nivel === 1 ? 700 : undefined}>
              <Table.Td pl={(x.nivel - 1) * 16 + 8}>{x.clave}</Table.Td><Table.Td>{x.nombre}</Table.Td>
              <Table.Td ta="right">{$(x.inicial)}</Table.Td><Table.Td ta="right">{$(x.cargos)}</Table.Td><Table.Td ta="right">{$(x.abonos)}</Table.Td><Table.Td ta="right">{$(x.final)}</Table.Td>
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}

function Auxiliar() {
  const reglas = useQuery({ queryKey: ["k-reglas"], queryFn: () => GET("/api/contabilidad/reglas") });
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso() });
  const [cuenta, setCuenta] = useState<string | null>(null);
  const r = useQuery({ queryKey: ["k-aux", p, cuenta], enabled: !!cuenta, queryFn: () => GET(`/api/contabilidad/auxiliar?cuenta=${encodeURIComponent(cuenta!)}&desde=${p.desde}&hasta=${p.hasta}`) });
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group align="flex-end">
          <Select label="Cuenta" searchable w={340} data={(reglas.data?.cuentas ?? []).map((c: any) => ({ value: c.clave, label: `${c.clave} · ${c.nombre}` }))} value={cuenta} onChange={setCuenta} />
          <Periodo desde={p.desde} hasta={p.hasta} onChange={(desde, hasta) => setP({ desde, hasta })} />
        </Group>
        {cuenta && <Exportar ruta={`/api/contabilidad/auxiliar?cuenta=${encodeURIComponent(cuenta)}&desde=${p.desde}&hasta=${p.hasta}&formato=xlsx`} archivo={`auxiliar-${cuenta}.xlsx`} />}
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {r.data && <>
        <Text size="sm">{r.data.cuenta} · {r.data.nombre} · saldo inicial {$(r.data.inicial)} · saldo final <b>{$(r.data.final)}</b></Text>
        <Table withTableBorder striped fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Póliza</Table.Th><Table.Th>Documento</Table.Th><Table.Th>Concepto</Table.Th><Table.Th ta="right">Cargo</Table.Th><Table.Th ta="right">Abono</Table.Th><Table.Th ta="right">Saldo</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{r.data.movimientos.map((x: any, i: number) => <Table.Tr key={i}><Table.Td>{fecha(x.fecha)}</Table.Td><Table.Td>{x.folio}</Table.Td><Table.Td>{x.origen_folio}</Table.Td><Table.Td>{x.concepto}</Table.Td><Table.Td ta="right">{Number(x.cargo) ? $(x.cargo) : ""}</Table.Td><Table.Td ta="right">{Number(x.abono) ? $(x.abono) : ""}</Table.Td><Table.Td ta="right">{$(x.saldo)}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      </>}
    </Stack>
  );
}

function Diario() {
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso() });
  const r = useQuery({ queryKey: ["k-diario", p], queryFn: () => GET(`/api/contabilidad/diario?desde=${p.desde}&hasta=${p.hasta}`) });
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Periodo desde={p.desde} hasta={p.hasta} onChange={(desde, hasta) => setP({ desde, hasta })} />
        <Exportar ruta={`/api/contabilidad/diario?desde=${p.desde}&hasta=${p.hasta}&formato=xlsx`} archivo={`diario-${p.desde}-${p.hasta}.xlsx`} />
      </Group>
      {(r.data?.polizas ?? []).map((pz: any) => (
        <Card key={pz.id} withBorder p="xs">
          <Text size="sm" fw={600}>{pz.folio} · {fecha(pz.fecha)} · {pz.concepto}</Text>
          <Table fz="xs"><Table.Tbody>{pz.partidas.map((x: any, i: number) => <Table.Tr key={i}><Table.Td w={120}>{x.cuenta}</Table.Td><Table.Td>{x.cuenta_nombre}</Table.Td><Table.Td ta="right" w={120}>{Number(x.cargo) ? $(x.cargo) : ""}</Table.Td><Table.Td ta="right" w={120}>{Number(x.abono) ? $(x.abono) : ""}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
        </Card>
      ))}
    </Stack>
  );
}

function Estados() {
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso() });
  const r = useQuery({ queryKey: ["k-estados", p], queryFn: () => GET(`/api/contabilidad/estados?desde=${p.desde}&hasta=${p.hasta}`) });
  const bloque = (titulo: string, xs: any[], total?: string) => (
    <>
      <Table.Tr fw={600}><Table.Td colSpan={2}>{titulo}</Table.Td></Table.Tr>
      {xs.map((x) => <Table.Tr key={x.clave}><Table.Td pl="lg">{x.clave} · {x.nombre}</Table.Td><Table.Td ta="right">{$(x.importe)}</Table.Td></Table.Tr>)}
      {total !== undefined && <Table.Tr fw={700} bg="gray.0"><Table.Td>Total {titulo.toLowerCase()}</Table.Td><Table.Td ta="right">{$(total)}</Table.Td></Table.Tr>}
    </>
  );
  const d = r.data;
  return (
    <Stack>
      <Periodo desde={p.desde} hasta={p.hasta} onChange={(desde, hasta) => setP({ desde, hasta })} />
      <Text size="xs" c="dimmed">Las cuentas se clasifican por el primer dígito de su código agrupador del SAT (o de la cuenta): 1 activo, 2 pasivo, 3 capital, 4 ingresos, 5 costos, 6 gastos, 7 otros.</Text>
      {d && <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Text fw={700} ta="center">Estado de resultados</Text>
          <Text size="sm" c="dimmed" ta="center" mb="xs">Del {fecha(d.desde)} al {fecha(d.hasta)}</Text>
          <Table fz="sm"><Table.Tbody>
            {bloque("Ingresos", d.resultados.ingresos, d.resultados.totales.ingresos)}
            {bloque("Costos", d.resultados.costos, d.resultados.totales.costos)}
            <Table.Tr fw={700}><Table.Td>Utilidad bruta</Table.Td><Table.Td ta="right">{$(d.resultados.totales.utilidadBruta)}</Table.Td></Table.Tr>
            {bloque("Gastos", d.resultados.gastos, d.resultados.totales.gastos)}
            {!!d.resultados.otros.length && bloque("Otros ingresos y gastos", d.resultados.otros, d.resultados.totales.otros)}
            <Table.Tr fw={700} bg="gray.1"><Table.Td>Utilidad (pérdida) del periodo</Table.Td><Table.Td ta="right">{$(d.resultados.totales.neta)}</Table.Td></Table.Tr>
          </Table.Tbody></Table>
        </Card>
        <Card withBorder>
          <Text fw={700} ta="center">Balance general</Text>
          <Text size="sm" c="dimmed" ta="center" mb="xs">Al {fecha(d.hasta)}</Text>
          <Table fz="sm"><Table.Tbody>
            {bloque("Activo", d.balance.activo, d.balance.totales.activo)}
            {bloque("Pasivo", d.balance.pasivo, d.balance.totales.pasivo)}
            {bloque("Capital", d.balance.capital)}
            <Table.Tr><Table.Td pl="lg">Resultados de ejercicios anteriores</Table.Td><Table.Td ta="right">{$(d.balance.anteriores)}</Table.Td></Table.Tr>
            <Table.Tr><Table.Td pl="lg">Resultado del ejercicio</Table.Td><Table.Td ta="right">{$(d.balance.resultado_ejercicio)}</Table.Td></Table.Tr>
            <Table.Tr fw={700} bg="gray.0"><Table.Td>Total capital</Table.Td><Table.Td ta="right">{$(d.balance.totales.capital)}</Table.Td></Table.Tr>
            <Table.Tr fw={700} bg="gray.1"><Table.Td>Pasivo más capital</Table.Td><Table.Td ta="right">{$(d.balance.totales.pasivoMasCapital)}</Table.Td></Table.Tr>
          </Table.Tbody></Table>
          <Text size="sm" mt="xs" c={d.balance.cuadra ? "green" : "red"}>{d.balance.cuadra ? "✔ Activo = pasivo + capital" : `✖ Diferencia ${$(d.balance.diferencia)}`}</Text>
        </Card>
      </SimpleGrid>}
    </Stack>
  );
}

function Conciliacion() {
  const [hasta, setHasta] = useState(hoyIso());
  const r = useQuery({ queryKey: ["k-conc", hasta], queryFn: () => GET(`/api/contabilidad/conciliacion?hasta=${hasta}`) });
  return (
    <Stack maw={900}>
      <Periodo desde={hasta} hasta={hasta} sinDesde onChange={(_, h) => setHasta(h)} />
      <Text size="sm" c="dimmed">Compara el valor del inventario en el kárdex con el saldo de sus cuentas contables (las de las reglas INV_MP, INV_PEP e INV_PT). Una diferencia de centavos es redondeo; una mayor indica documentos sin contabilizar o pólizas manuales en esas cuentas.</Text>
      <Table withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Inventario</Table.Th><Table.Th>Cuentas</Table.Th><Table.Th ta="right">Kárdex</Table.Th><Table.Th ta="right">Contabilidad</Table.Th><Table.Th ta="right">Diferencia</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.grupos ?? []).map((g: any) => (
          <Table.Tr key={g.grupo}>
            <Table.Td>{g.nombre}</Table.Td><Table.Td>{g.cuentas.join(", ") || <Text span c="orange" size="sm">sin regla</Text>}</Table.Td>
            <Table.Td ta="right">{$(g.kardex)}</Table.Td><Table.Td ta="right">{$(g.contable)}</Table.Td><Table.Td ta="right">{$(g.diferencia)}</Table.Td>
            <Table.Td c={g.cuadra ? "green" : "red"}>{g.cuadra ? (g.redondeo ? "✔ (redondeo)" : "✔") : "✖"}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
    </Stack>
  );
}

function Periodos() {
  const r = useQuery({ queryKey: ["k-periodos"], queryFn: () => GET("/api/contabilidad/periodos") });
  const qc = useQueryClient();
  const [reabrir, setReabrir] = useState<{ k: string; motivo: string } | null>(null);
  const m = useMutation({
    mutationFn: (x: { k: string; que: string; motivo?: string }) => POST(`/api/contabilidad/periodos/${x.k}/${x.que}`, x.motivo ? { motivo: x.motivo } : {}),
    onSuccess: () => { setReabrir(null); qc.invalidateQueries(); },
  });
  const nombre = (p: any) => `${String(p.mes).padStart(2, "0")}/${p.ejercicio}`;
  return (
    <Stack maw={900}>
      <Text size="sm" c="dimmed">Al cerrar un mes se generan las pólizas pendientes y se revisa que no quede nada sin contabilizar ni pólizas manuales sin autorizar, y que la balanza cuadre. En un mes cerrado no entra ninguna póliza. Se cierra en orden; se reabre (con motivo) solo el último cerrado.</Text>
      {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
      <Table withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Periodo</Table.Th><Table.Th>Estatus</Table.Th><Table.Th ta="right">Pólizas</Table.Th><Table.Th ta="right">Por autorizar</Table.Th><Table.Th>Cierre</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.periodos ?? []).map((p: any) => {
          const k = `${p.ejercicio}-${String(p.mes).padStart(2, "0")}`;
          return (
            <Table.Tr key={k}>
              <Table.Td>{nombre(p)}</Table.Td><Table.Td><Badge color={p.estatus === "CERRADO" ? "gray" : "green"} variant="light">{p.estatus === "CERRADO" ? "Cerrado" : "Abierto"}</Badge></Table.Td>
              <Table.Td ta="right">{p.polizas}</Table.Td><Table.Td ta="right">{p.por_autorizar || ""}</Table.Td>
              <Table.Td><Text size="xs">{p.cerrado_en ? `${p.cerro} · ${fechaHora(p.cerrado_en)}` : ""}{p.reabierto_en ? ` · reabrió ${p.reabrio}: ${p.motivo_reapertura}` : ""}</Text></Table.Td>
              <Table.Td>{r.data.puede_cerrar && (p.estatus === "ABIERTO"
                ? <Button size="xs" loading={m.isPending} onClick={() => m.mutate({ k, que: "cerrar" })}>Cerrar periodo</Button>
                : <Button size="xs" variant="subtle" color="red" onClick={() => setReabrir({ k, motivo: "" })}>Reabrir</Button>)}</Table.Td>
            </Table.Tr>
          );
        })}</Table.Tbody>
      </Table>
      <Modal opened={!!reabrir} onClose={() => setReabrir(null)} title="Reabrir periodo" centered>
        {reabrir && <Stack>
          <Textarea label="Motivo" value={reabrir.motivo} onChange={(e) => setReabrir({ ...reabrir, motivo: e.currentTarget.value })} />
          <Button color="red" loading={m.isPending} onClick={() => m.mutate({ k: reabrir.k, que: "reabrir", motivo: reabrir.motivo })}>Reabrir</Button>
        </Stack>}
      </Modal>
    </Stack>
  );
}

export function Contabilidad() {
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const pestanas = [
    { v: "polizas", t: "Pólizas", ok: puede("contabilidad.polizas:ver") },
    { v: "nueva", t: "Póliza manual", ok: puede("contabilidad.polizas:crear") },
    { v: "reglas", t: "Reglas de contabilización", ok: puede("contabilidad.catalogo:ver") },
    { v: "balanza", t: "Balanza", ok: puede("contabilidad.reportes:ver") },
    { v: "auxiliar", t: "Auxiliares", ok: puede("contabilidad.reportes:ver") },
    { v: "diario", t: "Libro diario", ok: puede("contabilidad.reportes:ver") },
    { v: "estados", t: "Estados financieros", ok: puede("contabilidad.reportes:ver") },
    { v: "conciliacion", t: "Conciliación de inventario", ok: puede("contabilidad.reportes:ver") },
    { v: "periodos", t: "Cierre de periodo", ok: puede("contabilidad.cierre:ver") },
  ].filter((p) => p.ok);
  const tab = pestanas.some((p) => p.v === params.get("tab")) ? params.get("tab")! : pestanas[0]?.v;
  return (
    <Stack>
      <Title order={2}>Contabilidad</Title>
      <Tabs value={tab} onChange={(v) => setParams(v ? { tab: v } : {})} keepMounted={false}>
        <Tabs.List>{pestanas.map((p) => <Tabs.Tab key={p.v} value={p.v}>{p.t}</Tabs.Tab>)}</Tabs.List>
        <Tabs.Panel value="polizas" pt="md"><Polizas /></Tabs.Panel>
        <Tabs.Panel value="nueva" pt="md"><NuevaPoliza /></Tabs.Panel>
        <Tabs.Panel value="reglas" pt="md"><Reglas /></Tabs.Panel>
        <Tabs.Panel value="balanza" pt="md"><Balanza /></Tabs.Panel>
        <Tabs.Panel value="auxiliar" pt="md"><Auxiliar /></Tabs.Panel>
        <Tabs.Panel value="diario" pt="md"><Diario /></Tabs.Panel>
        <Tabs.Panel value="estados" pt="md"><Estados /></Tabs.Panel>
        <Tabs.Panel value="conciliacion" pt="md"><Conciliacion /></Tabs.Panel>
        <Tabs.Panel value="periodos" pt="md"><Periodos /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
