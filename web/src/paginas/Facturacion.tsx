// Facturación (Fase 8). Las facturas se hacen y se timbran en el portal del SAT:
// aquí se capturan las solicitudes de factura de los tickets, se preparan los
// datos para el portal (individual y global diaria), se sube el XML descargado,
// se registran cancelaciones y se concilia lo vendido contra lo facturado.
// Los botones se muestran según permisos; el servidor valida de nuevo.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, FileButton, Group, List, Modal, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { descargar, GET, POST, textoError } from "../api";
import { fecha, fechaHora, fechaIso, numero } from "../formato";
import { useSesion } from "../sesion";

const $ = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : `$${numero(v, 2)}`);
const hoyIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
const primeroDeMes = () => `${hoyIso().slice(0, 8)}01`;
const COLOR: Record<string, string> = { PENDIENTE: "orange", FACTURADA: "green", CANCELADA: "gray", VIGENTE: "green", CANCELACION_POR_AUTORIZAR: "orange" };
const TEXTO: Record<string, string> = { PENDIENTE: "Pendiente", FACTURADA: "Facturada", CANCELADA: "Cancelada", VIGENTE: "Vigente", CANCELACION_POR_AUTORIZAR: "Cancelación por autorizar" };
const CLASE: Record<string, string> = { NOMINATIVA: "Individual", GLOBAL: "Global", EGRESO: "Nota de crédito" };
const Est = ({ e }: { e: string }) => <Badge color={COLOR[e] ?? "gray"} variant="light">{TEXTO[e] ?? e}</Badge>;
const useOpciones = () => useQuery({ queryKey: ["f-opciones"], queryFn: () => GET("/api/facturacion/opciones") });

function Exportar({ ruta, archivo }: { ruta: string; archivo: string }) {
  const { puede } = useSesion();
  const [err, setErr] = useState<string | null>(null);
  if (!puede("fiscal.cfdi:exportar")) return null;
  return <Stack gap={2}><Button variant="default" onClick={() => descargar(ruta, archivo).then(() => setErr(null)).catch((e) => setErr(textoError(e)))}>Exportar a Excel</Button>{err && <Text size="xs" c="red">{err}</Text>}</Stack>;
}

function Fecha({ valor, onChange, label = "Día" }: { valor: string; onChange: (v: string) => void; label?: string }) {
  const [t, setT] = useState(fecha(valor));
  return <TextInput label={label} w={130} value={t} placeholder="DD/MM/AAAA" onChange={(e) => { setT(e.currentTarget.value); const i = fechaIso(e.currentTarget.value); if (i) onChange(i); }} />;
}

// ---------------------------------------------------------------------------
// Datos para capturar en el portal del SAT
// ---------------------------------------------------------------------------
function DatosPortal({ d }: { d: any }) {
  return (
    <Stack gap="xs">
      <Alert color="blue" variant="light">Captura estos datos en el portal del SAT (Factura electrónica). Al terminar, descarga el XML y súbelo aquí.</Alert>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card withBorder p="xs">
          <Text fw={600} size="sm">Receptor</Text>
          <Text size="sm">RFC: <b>{d.receptor.rfc}</b></Text>
          <Text size="sm">Nombre: <b>{d.receptor.nombre}</b></Text>
          <Text size="sm">Régimen fiscal: {d.receptor.regimen_fiscal}{d.receptor.codigo_postal ? ` · C.P. ${d.receptor.codigo_postal}` : ""}</Text>
          <Text size="sm">Uso del CFDI: {d.receptor.uso_cfdi}{d.receptor.correo ? ` · ${d.receptor.correo}` : ""}</Text>
        </Card>
        <Card withBorder p="xs">
          <Text fw={600} size="sm">Comprobante</Text>
          <Text size="sm">Tipo: Ingreso · Método de pago: {d.metodo_pago} (una sola exhibición) · Forma de pago: <b>{d.forma_pago ?? "—"}</b></Text>
          {d.informacion_global && <Text size="sm">Información global: periodicidad <b>{d.informacion_global.periodicidad}</b> (diaria) · mes <b>{d.informacion_global.meses}</b> · año <b>{d.informacion_global.anio}</b></Text>}
          <Text size="sm">Subtotal {$(d.totales.base)} · IVA {$(d.totales.iva)}{Number(d.totales.ieps) ? ` · IEPS ${$(d.totales.ieps)}` : ""} · <b>Total {$(d.totales.total)}</b></Text>
          <Text size="xs" c="dimmed">La serie y el folio los asigna el portal del SAT. Sin retenciones (persona física).</Text>
        </Card>
      </SimpleGrid>
      {!!d.faltan_datos?.length && <Alert color="orange">Productos sin clave del SAT, unidad u objeto de impuesto en el catálogo: {d.faltan_datos.join(", ")}.</Alert>}
      <ScrollArea.Autosize mah={320}>
        <Table fz="xs" withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>No. identificación</Table.Th><Table.Th>Clave prod/serv</Table.Th><Table.Th>Cantidad</Table.Th><Table.Th>Clave unidad</Table.Th><Table.Th>Descripción</Table.Th><Table.Th ta="right">Valor unitario</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th>Objeto imp.</Table.Th><Table.Th>Impuestos</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{d.conceptos.map((x: any, i: number) => (
            <Table.Tr key={i}>
              <Table.Td>{x.no_identificacion}</Table.Td><Table.Td>{x.clave_prod_serv ?? "—"}</Table.Td><Table.Td>{numero(x.cantidad, 3).replace(/\.?0+$/, "")}</Table.Td><Table.Td>{x.clave_unidad ?? "—"}</Table.Td>
              <Table.Td>{x.descripcion}</Table.Td><Table.Td ta="right">{numero(x.valor_unitario, 6)}</Table.Td><Table.Td ta="right">{$(x.importe)}</Table.Td><Table.Td>{x.objeto_imp ?? "—"}</Table.Td>
              <Table.Td>{x.traslados.map((t: any) => `${t.impuesto} ${numero(Number(t.tasa) * 100, 2)}%: ${$(t.importe)}`).join(" · ")}</Table.Td>
            </Table.Tr>
          ))}</Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
      <Text size="sm">Impuestos por tasa: {d.impuestos.map((t: any) => `${t.impuesto} ${numero(Number(t.tasa) * 100, 2)}% sobre ${$(t.base)} = ${$(t.importe)}`).join(" · ") || "—"}</Text>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Subir el XML descargado del portal (revisar → registrar)
// ---------------------------------------------------------------------------
function SubirXml({ clase, solicitudes, fechaGlobal, sucursal, relacionado, alTerminar }: { clase: string; solicitudes?: string[]; fechaGlobal?: string; sucursal?: string | null; relacionado?: string; alTerminar?: () => void }) {
  const { puede } = useSesion();
  const op = useOpciones();
  const qc = useQueryClient();
  const [xml, setXml] = useState<string | null>(null);
  const [importe, setImporte] = useState("");
  const cuerpo = (x: string) => ({ clase, xml: x, solicitudes, fecha: fechaGlobal ?? null, sucursal: sucursal ?? null });
  const revisar = useMutation({ mutationFn: (x: string) => POST("/api/facturacion/xml/revisar", cuerpo(x)) });
  const registrar = useMutation({
    mutationFn: () => POST("/api/facturacion/xml", cuerpo(xml!)),
    onSuccess: () => { ["f-solicitudes", "f-facturas", "f-global", "f-conciliacion"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); alTerminar?.(); },
  });
  const prueba = useMutation({
    mutationFn: () => POST("/api/facturacion/xml/prueba", { clase, solicitudes, fecha: fechaGlobal ?? null, sucursal: sucursal ?? null, relacionado: relacionado ?? null, importe: importe || null }),
    onSuccess: (r: any) => { setXml(r.xml); revisar.mutate(r.xml); },
  });
  if (!puede("fiscal.cfdi:timbrar")) return null;
  const r = revisar.data;
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>Subir el XML descargado del portal del SAT ({CLASE[clase]})</Text>
        <Group>
          <FileButton accept=".xml,text/xml,application/xml" onChange={async (f) => { if (!f) return; const t = await f.text(); setXml(t); registrar.reset(); revisar.mutate(t); }}>
            {(p) => <Button {...p} variant="light">Elegir archivo XML</Button>}
          </FileButton>
          {op.data?.xml_prueba && (
            <Group gap="xs" align="flex-end">
              {clase === "EGRESO" && <TextInput size="xs" label="Importe de la nota" w={110} value={importe} onChange={(e) => setImporte(e.currentTarget.value)} />}
              <Button variant="subtle" color="grape" loading={prueba.isPending} onClick={() => { registrar.reset(); prueba.mutate(); }}>Generar XML de PRUEBA</Button>
            </Group>
          )}
        </Group>
        {op.data?.xml_prueba && <Text size="xs" c="dimmed">Ambiente de pruebas: el XML de PRUEBA imita al del portal para ensayar; no es una factura real.</Text>}
        {(revisar.error || prueba.error) && <Alert color="red">{textoError(revisar.error ?? prueba.error)}</Alert>}
        {r && (
          <Card withBorder p="xs" bg={r.se_puede_registrar ? "green.0" : "red.0"}>
            <Text size="sm">UUID <b>{r.uuid}</b> · {r.serie ?? ""}{r.folio ?? ""} · {fechaHora(r.fecha)} · receptor {r.receptor_rfc} {r.receptor_nombre ?? ""}</Text>
            <Text size="sm">Subtotal {$(r.subtotal)} · IVA {$(r.iva)} · <b>Total {$(r.total)}</b>{r.esperado ? ` · los tickets suman ${$(r.esperado.total)}` : ""}{r.tickets.length ? ` · ${r.tickets.length} ticket(s)` : ""}{r.relacionado ? ` · corrige ${r.relacionado}` : ""}</Text>
            {!!r.errores.length && <List size="sm" c="red" mt={4}>{r.errores.map((x: string, i: number) => <List.Item key={i}>{x}</List.Item>)}</List>}
            {!!r.avisos.length && <List size="sm" c="orange" mt={4}>{r.avisos.map((x: string, i: number) => <List.Item key={i}>{x}</List.Item>)}</List>}
            {r.se_puede_registrar && !registrar.data && <Button mt="xs" color="green" loading={registrar.isPending} onClick={() => registrar.mutate()}>Registrar factura</Button>}
          </Card>
        )}
        {registrar.error && <Alert color="red">{textoError(registrar.error)}</Alert>}
        {registrar.data && <Alert color="green">Factura registrada: {registrar.data.uuid}. Sus tickets quedaron como facturados.</Alert>}
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Solicitar factura de un ticket
// ---------------------------------------------------------------------------
const VACIO = { rfc: "", razon_social: "", regimen_fiscal: "", codigo_postal: "", uso_cfdi: "", correo: "" };
function Solicitar() {
  const op = useOpciones();
  const qc = useQueryClient();
  const [folio, setFolio] = useState("");
  const [buscar, setBuscar] = useState<string | null>(null);
  const [d, setD] = useState(VACIO);
  const t = useQuery({ queryKey: ["f-ticket", buscar], queryFn: () => GET(`/api/facturacion/tickets/${encodeURIComponent(buscar!)}`), enabled: !!buscar, retry: false });
  const cliente = useMutation({ mutationFn: () => GET(`/api/facturacion/clientes/${encodeURIComponent(d.rfc.trim().toUpperCase())}`), onSuccess: (r: any) => r.cliente && setD({ ...VACIO, ...Object.fromEntries(Object.entries(r.cliente).map(([k, v]) => [k, v ?? ""])) }) });
  const crear = useMutation({ mutationFn: () => POST("/api/facturacion/solicitudes", { venta: t.data.folio, ...d }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["f-solicitudes"] }); t.refetch(); } });
  const campo = (k: keyof typeof VACIO, label: string, extra: Record<string, unknown> = {}) => <TextInput label={label} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.currentTarget.value })} {...extra} />;
  const catalogo = (k: "regimen_fiscal" | "uso_cfdi", label: string, lista: any[] | undefined) => lista?.length
    ? <Select label={label} searchable data={lista.map((x) => ({ value: x.clave, label: `${x.clave} · ${x.descripcion}` }))} value={d[k] || null} onChange={(v) => setD({ ...d, [k]: v ?? "" })} />
    : campo(k, `${label} (clave)`, { placeholder: k === "uso_cfdi" ? "G03" : "612" });
  return (
    <Stack maw={760}>
      <Text size="sm" c="dimmed">Los datos se piden <b>el mismo día</b> de la compra (usa los de su constancia de situación fiscal) y la factura le llega al cliente <b>por correo al día siguiente</b>. Ese ticket ya no entra en la factura global.</Text>
      <Group align="flex-end">
        <TextInput label="Folio del ticket" w={260} value={folio} onChange={(e) => setFolio(e.currentTarget.value)} placeholder="CAJA-SUC1-1-000001" onKeyDown={(e) => e.key === "Enter" && setBuscar(folio.trim())} />
        <Button variant="default" onClick={() => { crear.reset(); setBuscar(folio.trim()); }}>Buscar</Button>
      </Group>
      {t.error && <Alert color="red">{textoError(t.error)}</Alert>}
      {t.data && (
        <Card withBorder>
          <Text fw={600}>{t.data.folio} · {fecha(t.data.fecha)} · {t.data.sucursal}</Text>
          <Text size="sm">{t.data.renglones.map((r: any) => `${numero(r.cantidad, 3).replace(/\.?0+$/, "")} ${r.descripcion}`).join(" · ")}</Text>
          <Text size="sm">Total a facturar <b>{$(t.data.neto.total)}</b>{Number(t.data.devuelto) ? ` (ya descontadas devoluciones por ${$(t.data.devuelto)})` : ""}</Text>
          {!t.data.se_puede_solicitar && <Alert mt="xs" color="orange">{t.data.motivo}</Alert>}
        </Card>
      )}
      {t.data?.se_puede_solicitar && (
        <Card withBorder>
          <Stack gap="xs">
            <Group align="flex-end">{campo("rfc", "RFC", { w: 200 })}<Button variant="subtle" loading={cliente.isPending} disabled={d.rfc.trim().length < 12} onClick={() => cliente.mutate()}>Traer datos guardados</Button></Group>
            {cliente.data && !cliente.data.cliente && <Text size="xs" c="dimmed">No hay datos guardados de ese RFC: captúralos.</Text>}
            {campo("razon_social", "Nombre o razón social (sin régimen societario, como en la constancia)")}
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              {catalogo("regimen_fiscal", "Régimen fiscal", op.data?.regimenes)}
              {campo("codigo_postal", "Código postal fiscal")}
              {catalogo("uso_cfdi", "Uso del CFDI", op.data?.usos)}
            </SimpleGrid>
            {campo("correo", "Correo del cliente (ahí le llega su factura al día siguiente)")}
            {crear.error && <Alert color="red">{textoError(crear.error)}</Alert>}
            <Button w={220} loading={crear.isPending} disabled={!d.rfc || !d.razon_social || !d.regimen_fiscal || !d.codigo_postal || !d.uso_cfdi || !d.correo.includes("@")} onClick={() => crear.mutate()}>Registrar solicitud</Button>
          </Stack>
        </Card>
      )}
      {crear.data && <Alert color="green">Solicitud <b>{crear.data.folio}</b> registrada para el ticket {crear.data.ticket} ({$(crear.data.total)}). La factura le llega al cliente por correo al día siguiente.</Alert>}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Solicitudes
// ---------------------------------------------------------------------------
function Solicitudes() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [estatus, setEstatus] = useState<string | null>("PENDIENTE");
  const [abierta, setAbierta] = useState<any>(null);
  const [motivo, setMotivo] = useState("");
  const l = useQuery({ queryKey: ["f-solicitudes", estatus], queryFn: () => GET(`/api/facturacion/solicitudes?desde=${primeroDeMes()}${estatus ? `&estatus=${estatus}` : ""}`) });
  const portal = useQuery({ queryKey: ["f-portal", abierta?.folio], queryFn: () => GET(`/api/facturacion/portal/individual?solicitudes=${abierta.folio}`), enabled: !!abierta && abierta.estatus === "PENDIENTE" });
  const cancelar = useMutation({ mutationFn: () => POST(`/api/facturacion/solicitudes/${abierta.folio}/cancelar`, { motivo }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["f-solicitudes"] }); setAbierta(null); } });
  const enviada = useMutation({ mutationFn: (folio: string) => POST(`/api/facturacion/solicitudes/${folio}/enviada`), onSuccess: () => qc.invalidateQueries({ queryKey: ["f-solicitudes"] }) });
  return (
    <Stack>
      <Group><Select label="Estatus" w={180} clearable data={[{ value: "PENDIENTE", label: "Por facturar" }, { value: "POR_ENVIAR", label: "Facturadas por enviar" }, { value: "FACTURADA", label: "Facturadas" }, { value: "CANCELADA", label: "Canceladas" }]} value={estatus} onChange={setEstatus} /></Group>
      {enviada.error && <Alert color="red">{textoError(enviada.error)}</Alert>}
      <Table striped withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Ticket</Table.Th><Table.Th>Día</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th>RFC</Table.Th><Table.Th>Nombre</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Estatus</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {l.data?.solicitudes.map((s: any) => (
            <Table.Tr key={s.id}>
              <Table.Td>{s.folio}</Table.Td><Table.Td>{s.ticket}</Table.Td><Table.Td>{fecha(s.fecha)}</Table.Td><Table.Td>{s.sucursal}</Table.Td><Table.Td>{s.rfc}</Table.Td><Table.Td>{s.razon_social}</Table.Td>
              <Table.Td ta="right">{$(s.total)}</Table.Td>
              <Table.Td>
                <Group gap={4}><Est e={s.estatus} />{s.estatus === "FACTURADA" && <Badge variant="light" color={s.enviada_en ? "teal" : "orange"}>{s.enviada_en ? "Enviada" : "Por enviar"}</Badge>}{s.atrasada && <Badge color="red">Atrasada</Badge>}</Group>
                {s.uuid && <Text size="xs" c="dimmed">{s.uuid}</Text>}
                {s.enviada_en && <Text size="xs" c="dimmed">Enviada {fechaHora(s.enviada_en)} por {s.envio}</Text>}
              </Table.Td>
              <Table.Td>
                {s.estatus === "FACTURADA" && !s.enviada_en ? (
                  <Group gap={4} wrap="nowrap">
                    <Button size="xs" variant="default" component="a" href={`mailto:${s.correo}?subject=${encodeURIComponent(`Factura de su compra ${s.ticket}`)}&body=${encodeURIComponent(`Le enviamos adjuntos el PDF y el XML de la factura de su compra del ${fecha(s.fecha)} (ticket ${s.ticket}).\nFolio fiscal: ${s.uuid}`)}`}>Correo</Button>
                    <Button size="xs" variant="light" color="teal" loading={enviada.isPending} onClick={() => enviada.mutate(s.folio)}>Marcar enviada</Button>
                  </Group>
                ) : <Button size="xs" variant="light" onClick={() => { setMotivo(""); setAbierta(s); }}>{s.estatus === "PENDIENTE" ? "Facturar" : "Ver"}</Button>}
              </Table.Td>
            </Table.Tr>
          ))}
          {l.data && !l.data.solicitudes.length && <Table.Tr><Table.Td colSpan={9}><Text c="dimmed" size="sm">Sin solicitudes.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Modal opened={!!abierta} onClose={() => setAbierta(null)} size="90%" title={abierta ? `Solicitud ${abierta.folio} · ticket ${abierta.ticket}` : ""}>
        {abierta && abierta.estatus !== "PENDIENTE" && <Text>Estatus: <Est e={abierta.estatus} /> {abierta.uuid ? `· UUID ${abierta.uuid}` : ""}</Text>}
        {portal.error && <Alert color="red">{textoError(portal.error)}</Alert>}
        {portal.data && (
          <Stack>
            <DatosPortal d={portal.data} />
            <SubirXml clase="NOMINATIVA" solicitudes={[abierta.folio]} />
            {puede("fiscal.cfdi:crear") && (
              <Group align="flex-end">
                <TextInput label="Motivo para cancelar la solicitud" w={320} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
                <Button color="red" variant="light" disabled={motivo.trim().length < 3} loading={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar solicitud</Button>
              </Group>
            )}
            {cancelar.error && <Alert color="red">{textoError(cancelar.error)}</Alert>}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Factura global diaria
// ---------------------------------------------------------------------------
function Global() {
  const op = useOpciones();
  const [dia, setDia] = useState(hoyIso());
  const [suc, setSuc] = useState<string | null>(null);
  const sucursal = suc ?? (op.data && !op.data.todas ? op.data.sucursales[0]?.clave : null) ?? null;
  const q = `fecha=${dia}${sucursal ? `&sucursal=${sucursal}` : ""}`;
  const g = useQuery({ queryKey: ["f-global", q], queryFn: () => GET(`/api/facturacion/portal/global?${q}`), enabled: !!op.data });
  return (
    <Stack>
      <Text size="sm" c="dimmed">La factura global se hace <b>cada día</b> con los tickets que no se facturaron aparte. Los tickets con solicitud de factura pendiente no se incluyen.</Text>
      <Group align="flex-end">
        <Fecha valor={dia} onChange={setDia} />
        <Select label="Sucursal" w={200} clearable={op.data?.todas} placeholder={op.data?.todas ? "Todas" : undefined} data={op.data?.sucursales.map((s: any) => ({ value: s.clave, label: s.nombre })) ?? []} value={sucursal} onChange={setSuc} />
        <Exportar ruta={`/api/facturacion/portal/global?${q}&formato=xlsx`} archivo={`global-${dia}.xlsx`} />
      </Group>
      {g.error && <Alert color="red">{textoError(g.error)}</Alert>}
      {g.data && (
        <>
          <Text size="sm">{g.data.tickets} tickets por facturar · {g.data.ya_facturados} ya facturados · {g.data.devueltos} devueltos completos</Text>
          {!!g.data.globales_registradas.length && <Alert color="green">Ya hay factura global registrada de este día: {g.data.globales_registradas.map((x: any) => `${x.uuid_cfdi} (${$(x.total)})`).join(", ")}.</Alert>}
          {!!g.data.con_solicitud.length && <Alert color="orange">Se facturan aparte (tienen solicitud): {g.data.con_solicitud.map((x: any) => `${x.folio} (${x.solicitud})`).join(", ")}.</Alert>}
          {g.data.tickets > 0 && <DatosPortal d={g.data} />}
          {g.data.tickets > 0 && <SubirXml clase="GLOBAL" fechaGlobal={dia} sucursal={sucursal} />}
        </>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Facturas registradas
// ---------------------------------------------------------------------------
function DetalleFactura({ id, cerrar }: { id: string; cerrar: () => void }) {
  const { puede } = useSesion();
  const op = useOpciones();
  const qc = useQueryClient();
  const r = useQuery({ queryKey: ["f-factura", id], queryFn: () => GET(`/api/facturacion/facturas/${id}`) });
  const [c, setC] = useState({ motivo_sat: "02", uuid_sustitucion: "", nota: "" });
  const refrescar = () => { r.refetch(); qc.invalidateQueries({ queryKey: ["f-facturas"] }); qc.invalidateQueries({ queryKey: ["f-conciliacion"] }); };
  const cancelar = useMutation({ mutationFn: () => POST(`/api/facturacion/facturas/${id}/cancelar`, c), onSuccess: refrescar });
  const resolver = useMutation({ mutationFn: (que: string) => POST(`/api/facturacion/facturas/${id}/${que}`, { nota: c.nota || null }), onSuccess: refrescar });
  const [err, setErr] = useState<string | null>(null);
  if (!r.data) return <Text>Cargando…</Text>;
  const f = r.data.cfdi;
  return (
    <Stack>
      <Group gap="xs"><Title order={4}>{f.uuid_cfdi}</Title><Est e={f.estatus} /><Badge variant="outline">{CLASE[f.clase]}</Badge></Group>
      <Text size="sm">{f.serie ?? ""}{f.folio ?? ""} · emitida {fechaHora(f.fecha_emision)} · día {fecha(f.fecha_negocio)} · {f.receptor_rfc} {f.receptor_nombre ?? ""} · registró {f.registro}</Text>
      <Text size="sm">Subtotal {$(f.subtotal)} · IVA {$(f.iva)}{Number(f.ieps) ? ` · IEPS ${$(f.ieps)}` : ""} · <b>Total {$(f.total)}</b> · forma de pago {f.forma_pago ?? "—"} · {f.metodo_pago ?? ""}</Text>
      {f.cancelacion_motivo_sat && <Text size="sm" c="orange">Cancelación: {f.cancelacion_motivo_sat} {f.cancelacion_motivo_texto}{f.cancelacion_uuid_sustitucion ? ` · sustituye ${f.cancelacion_uuid_sustitucion}` : ""} · {f.cancelacion_nota} · registró {f.cancelacion_solicito}{f.cancelacion_autorizo ? ` · autorizó ${f.cancelacion_autorizo}` : ""}</Text>}
      <Button variant="default" w={180} onClick={() => descargar(`/api/facturacion/facturas/${id}/xml`, `${f.uuid_cfdi}.xml`).then(() => setErr(null)).catch((e) => setErr(textoError(e)))}>Descargar XML</Button>
      {err && <Text size="xs" c="red">{err}</Text>}
      {!!r.data.tickets.length && (
        <ScrollArea.Autosize mah={240}>
          <Table fz="xs" withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Ticket</Table.Th><Table.Th>Día</Table.Th><Table.Th ta="right">Facturado</Table.Th><Table.Th ta="right">Neto actual</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{r.data.tickets.map((x: any) => <Table.Tr key={x.folio} c={x.vigente ? undefined : "dimmed"}><Table.Td>{x.folio}</Table.Td><Table.Td>{fecha(x.fecha)}</Table.Td><Table.Td ta="right">{$(x.total)}</Table.Td><Table.Td ta="right" c={Number(x.neto_actual) < Number(x.total) ? "orange" : undefined}>{$(x.neto_actual)}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
      {!!r.data.notas.length && <Text size="sm">Notas de crédito: {r.data.notas.map((n: any) => `${n.uuid} ${$(n.total)} (${TEXTO[n.estatus]})`).join(" · ")}</Text>}
      {f.estatus === "VIGENTE" && f.clase !== "EGRESO" && <SubirXml clase="EGRESO" relacionado={f.uuid_cfdi} alTerminar={refrescar} />}
      {f.estatus === "VIGENTE" && puede("fiscal.cfdi:cancelar") && (
        <Card withBorder>
          <Text fw={600} size="sm">Registrar la cancelación (ya hecha en el portal del SAT)</Text>
          <Group align="flex-end">
            <Select label="Motivo del SAT" w={360} data={op.data?.motivos_cancelacion.map((m: any) => ({ value: m.clave, label: `${m.clave} · ${m.descripcion}` })) ?? []} value={c.motivo_sat} onChange={(v) => setC({ ...c, motivo_sat: v ?? "02" })} />
            {c.motivo_sat === "01" && <TextInput label="UUID que la sustituye" w={320} value={c.uuid_sustitucion} onChange={(e) => setC({ ...c, uuid_sustitucion: e.currentTarget.value })} />}
            <TextInput label="Nota" w={260} value={c.nota} onChange={(e) => setC({ ...c, nota: e.currentTarget.value })} />
            <Button color="red" variant="light" loading={cancelar.isPending} disabled={c.nota.trim().length < 3} onClick={() => cancelar.mutate()}>Registrar cancelación</Button>
          </Group>
        </Card>
      )}
      {f.estatus === "CANCELACION_POR_AUTORIZAR" && puede("fiscal.cfdi:autorizar") && (
        <Group align="flex-end">
          <TextInput label="Nota (para rechazar)" w={280} value={c.nota} onChange={(e) => setC({ ...c, nota: e.currentTarget.value })} />
          <Button color="green" loading={resolver.isPending} onClick={() => resolver.mutate("autorizar-cancelacion")}>Autorizar cancelación</Button>
          <Button color="red" variant="light" loading={resolver.isPending} onClick={() => resolver.mutate("rechazar-cancelacion")}>Rechazar</Button>
        </Group>
      )}
      {(cancelar.error || resolver.error) && <Alert color="red">{textoError(cancelar.error ?? resolver.error)}</Alert>}
      {resolver.data?.solicitudes_pendientes?.length > 0 && <Alert color="blue">Las solicitudes {resolver.data.solicitudes_pendientes.join(", ")} volvieron a pendientes: se facturan otra vez.</Alert>}
      <Button variant="default" w={120} onClick={cerrar}>Cerrar</Button>
    </Stack>
  );
}

function Facturas() {
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso(), clase: null as string | null, estatus: null as string | null });
  const [abierta, setAbierta] = useState<string | null>(null);
  const q = `desde=${p.desde}&hasta=${p.hasta}${p.clase ? `&clase=${p.clase}` : ""}${p.estatus ? `&estatus=${p.estatus}` : ""}`;
  const l = useQuery({ queryKey: ["f-facturas", q], queryFn: () => GET(`/api/facturacion/facturas?${q}`) });
  return (
    <Stack>
      <Group align="flex-end">
        <Fecha label="Desde" valor={p.desde} onChange={(v) => setP({ ...p, desde: v })} />
        <Fecha label="Hasta" valor={p.hasta} onChange={(v) => setP({ ...p, hasta: v })} />
        <Select label="Clase" w={170} clearable data={Object.entries(CLASE).map(([value, label]) => ({ value, label }))} value={p.clase} onChange={(v) => setP({ ...p, clase: v })} />
        <Select label="Estatus" w={220} clearable data={["VIGENTE", "CANCELACION_POR_AUTORIZAR", "CANCELADA"].map((v) => ({ value: v, label: TEXTO[v]! }))} value={p.estatus} onChange={(v) => setP({ ...p, estatus: v })} />
        <Exportar ruta={`/api/facturacion/facturas?${q}&formato=xlsx`} archivo={`facturas-${p.desde}-${p.hasta}.xlsx`} />
      </Group>
      <Table striped withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Día</Table.Th><Table.Th>Clase</Table.Th><Table.Th>UUID</Table.Th><Table.Th>Serie/folio</Table.Th><Table.Th>Receptor</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th>Tickets</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Estatus</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {l.data?.facturas.map((f: any) => (
            <Table.Tr key={f.id} style={{ cursor: "pointer" }} onClick={() => setAbierta(f.id)}>
              <Table.Td>{fecha(f.fecha_negocio)}</Table.Td><Table.Td>{CLASE[f.clase]}</Table.Td><Table.Td><Text size="xs">{f.uuid}</Text></Table.Td><Table.Td>{f.serie ?? ""}{f.folio ?? ""}</Table.Td>
              <Table.Td>{f.receptor_rfc}<Text size="xs" c="dimmed">{f.receptor_nombre}</Text></Table.Td><Table.Td>{f.sucursal ?? "Todas"}</Table.Td><Table.Td>{f.tickets}</Table.Td>
              <Table.Td ta="right">{f.clase === "EGRESO" ? "-" : ""}{$(f.total)}</Table.Td><Table.Td><Est e={f.estatus} /></Table.Td>
            </Table.Tr>
          ))}
          {l.data && !l.data.facturas.length && <Table.Tr><Table.Td colSpan={9}><Text c="dimmed" size="sm">Sin facturas registradas en el periodo.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Modal opened={!!abierta} onClose={() => setAbierta(null)} size="xl" title="Factura">{abierta && <DetalleFactura id={abierta} cerrar={() => setAbierta(null)} />}</Modal>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Conciliación vendido contra facturado
// ---------------------------------------------------------------------------
function Conciliacion() {
  const [p, setP] = useState({ desde: primeroDeMes(), hasta: hoyIso() });
  const q = `desde=${p.desde}&hasta=${p.hasta}`;
  const r = useQuery({ queryKey: ["f-conciliacion", q], queryFn: () => GET(`/api/facturacion/conciliacion?${q}`) });
  const d = r.data;
  return (
    <Stack>
      <Group align="flex-end">
        <Fecha label="Desde" valor={p.desde} onChange={(v) => setP({ ...p, desde: v })} />
        <Fecha label="Hasta" valor={p.hasta} onChange={(v) => setP({ ...p, hasta: v })} />
        <Exportar ruta={`/api/facturacion/conciliacion?${q}&formato=xlsx`} archivo={`conciliacion-fiscal-${p.desde}-${p.hasta}.xlsx`} />
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {d && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            {[["Vendido (neto)", d.totales.vendido], ["Facturas individuales", d.totales.individual], ["Facturas globales", d.totales.global], ["Sin facturar", d.totales.importe_sin_facturar]].map(([t, v]) => (
              <Card key={t} withBorder p="xs"><Text size="xs" c="dimmed">{t}</Text><Text fw={700}>{$(v)}</Text></Card>
            ))}
          </SimpleGrid>
          {!!d.alertas.dias_sin_global.length && <Alert color="red" title="Días con tickets sin facturar">{d.alertas.dias_sin_global.map((x: any) => `${fecha(x.fecha)} ${x.sucursal}: ${x.tickets} tickets, ${$(x.importe)}`).join(" · ")}. Falta su factura global.</Alert>}
          {!!d.alertas.solicitudes_atrasadas.length && <Alert color="red" title="Facturas que ya debieron llegar al cliente">{d.alertas.solicitudes_atrasadas.map((x: any) => `${x.folio} (ticket ${x.ticket} del ${fecha(x.fecha)}, ${x.correo}): ${x.estatus === "PENDIENTE" ? "falta facturar" : "falta enviar"}`).join(" · ")}</Alert>}
          {!!d.alertas.devoluciones_sin_nota.length && <Alert color="orange" title="Devoluciones de tickets ya facturados">{d.alertas.devoluciones_sin_nota.map((x: any) => `${x.folio}: ${$(x.por_acreditar)} (factura ${x.uuid})`).join(" · ")}. Haz la nota de crédito en el portal del SAT y súbela en la factura.</Alert>}
          {!!d.alertas.cancelaciones_por_autorizar.length && <Alert color="orange" title="Cancelaciones por autorizar">{d.alertas.cancelaciones_por_autorizar.map((x: any) => `${x.uuid} (${$(x.total)}, registró ${x.solicito})`).join(" · ")}</Alert>}
          <Table striped withTableBorder fz="sm">
            <Table.Thead><Table.Tr><Table.Th>Día</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th>Tickets</Table.Th><Table.Th ta="right">Vendido</Table.Th><Table.Th ta="right">Individual</Table.Th><Table.Th ta="right">Global</Table.Th><Table.Th ta="right">Sin facturar</Table.Th><Table.Th>Solicitudes pendientes</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{d.dias.map((x: any) => (
              <Table.Tr key={x.fecha + x.sucursal}>
                <Table.Td>{fecha(x.fecha)}</Table.Td><Table.Td>{x.sucursal}</Table.Td><Table.Td>{x.tickets}</Table.Td><Table.Td ta="right">{$(x.vendido)}</Table.Td><Table.Td ta="right">{$(x.individual)}</Table.Td><Table.Td ta="right">{$(x.global)}</Table.Td>
                <Table.Td ta="right" c={x.sin_facturar && !x.pendiente_del_dia ? "red" : undefined}>{x.sin_facturar ? `${$(x.importe_sin_facturar)} (${x.sin_facturar})` : "—"}</Table.Td><Table.Td>{x.solicitudes_pendientes || "—"}</Table.Td>
              </Table.Tr>
            ))}</Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}

export function Facturacion() {
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const pestanas = [
    { v: "solicitar", t: "Solicitar factura", ok: puede("fiscal.cfdi:crear") },
    { v: "solicitudes", t: "Solicitudes", ok: true },
    { v: "global", t: "Factura global diaria", ok: true },
    { v: "facturas", t: "Facturas registradas", ok: true },
    { v: "conciliacion", t: "Vendido vs. facturado", ok: true },
  ].filter((p) => p.ok);
  const tab = pestanas.some((p) => p.v === params.get("tab")) ? params.get("tab")! : pestanas[0]?.v;
  return (
    <Stack>
      <Title order={2}>Facturación</Title>
      <Tabs value={tab} onChange={(v) => setParams(v ? { tab: v } : {})} keepMounted={false}>
        <Tabs.List>{pestanas.map((p) => <Tabs.Tab key={p.v} value={p.v}>{p.t}</Tabs.Tab>)}</Tabs.List>
        <Tabs.Panel value="solicitar" pt="md"><Solicitar /></Tabs.Panel>
        <Tabs.Panel value="solicitudes" pt="md"><Solicitudes /></Tabs.Panel>
        <Tabs.Panel value="global" pt="md"><Global /></Tabs.Panel>
        <Tabs.Panel value="facturas" pt="md"><Facturas /></Tabs.Panel>
        <Tabs.Panel value="conciliacion" pt="md"><Conciliacion /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
