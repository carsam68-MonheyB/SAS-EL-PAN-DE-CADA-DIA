// Compras (Fase 4): autorizaciones pendientes, requisiciones, órdenes de compra
// (con recepción y factura XML con cotejo a 3 vías), cuentas por pagar con
// antigüedad de saldos, pagos y comparativo de precios. Los botones se muestran
// según permisos; el servidor valida de nuevo permisos, límites y segregación.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Badge, Button, Card, Checkbox, FileButton, Group, Modal, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from "@mantine/core";
import { descargar, GET, POST, textoError } from "../api";
import { fecha, fechaHora, fechaIso, numero } from "../formato";
import { useSesion } from "../sesion";

const $ = (v: string | number | null | undefined, d = 2) => (v === null || v === undefined || v === "" ? "—" : `${Number(v) < 0 ? "-" : ""}$${numero(Math.abs(Number(v)), d)}`);
const cant = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : numero(v, Number(v) % 1 === 0 ? 0 : 3));
const COLOR: Record<string, string> = {
  BORRADOR: "gray", ENVIADA: "blue", AUTORIZADA: "green", RECHAZADA: "red", CANCELADA: "gray", ORDENADA: "teal", POR_AUTORIZAR: "orange", EMITIDA: "blue",
  PARCIAL: "yellow", RECIBIDA: "green", COTEJADA: "green", CON_DIFERENCIAS: "orange", ABIERTO: "blue", PAGADO: "green", AUTORIZADO: "teal", RECHAZADO: "red", CANCELADO: "gray",
};
const TEXTO: Record<string, string> = { POR_AUTORIZAR: "Por autorizar", CON_DIFERENCIAS: "Con diferencias" };
const Est = ({ e }: { e: string }) => <Badge color={COLOR[e] ?? "gray"} variant="light">{TEXTO[e] ?? e.charAt(0) + e.slice(1).toLowerCase()}</Badge>;
const FORMA: Record<string, string> = { "01": "Efectivo", "02": "Cheque", "03": "Transferencia" };

function useRefrescar() {
  const qc = useQueryClient();
  return () => ["c-aut", "c-req", "c-oc", "c-fac", "c-cxp", "c-pag", "c-doc"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
const useOpciones = () => useQuery({ queryKey: ["c-opciones"], queryFn: () => GET("/api/compras/opciones") });

function Firmas({ firmas }: { firmas: any[] }) {
  if (!firmas?.length) return null;
  return (
    <Text size="xs" c="dimmed">
      Autorización: {firmas.map((f) => (f.decision ? `${f.decision === "AUTORIZA" ? "autorizó" : "rechazó"} ${f.usuario} el ${fechaHora(f.firmado_en)}${f.comentario ? ` (${f.comentario})` : ""}` : `pendiente por ${$(f.monto)}`)).join(" · ")}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Autorizaciones
// ---------------------------------------------------------------------------
function Autorizaciones() {
  const refrescar = useRefrescar();
  const r = useQuery({ queryKey: ["c-aut"], queryFn: () => GET("/api/compras/autorizaciones") });
  const [com, setCom] = useState<Record<string, string>>({});
  const m = useMutation({ mutationFn: (a: { id: string; que: string }) => POST(`/api/compras/autorizaciones/${a.id}/${a.que}`, { comentario: com[a.id] || null }), onSuccess: refrescar });
  const lista: any[] = r.data?.pendientes ?? [];
  return (
    <Stack>
      <Text size="sm" c="dimmed">Solicitudes que puedes firmar según tu permiso y tu límite. Quien solicita no se autoriza a sí mismo.</Text>
      {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
      {!lista.length && <Text c="dimmed" size="sm">No tienes autorizaciones pendientes.</Text>}
      {lista.map((s) => (
        <Card key={s.id} withBorder>
          <Group justify="space-between">
            <div><Text fw={600}>{s.nombre} · {s.folio}</Text><Text size="xs" c="dimmed">Solicitó {s.solicitante} · {fechaHora(s.creado_en)}</Text></div>
            <Text size="xl" fw={700}>{$(s.monto)}</Text>
          </Group>
          {s.propia ? <Text size="sm" c="orange" mt="xs">La solicitaste tú: la debe autorizar otra persona.</Text>
            : !s.cubre ? <Text size="sm" c="orange" mt="xs">Pasa de tu límite ({$(s.limite)}): la autoriza alguien con un límite mayor.</Text>
            : (
              <Group mt="xs" align="flex-end">
                <TextInput label="Comentario (obligatorio si rechazas)" w={360} value={com[s.id] ?? ""} onChange={(e) => { const v = e.currentTarget.value; setCom((x) => ({ ...x, [s.id]: v })); }} />
                <Button color="green" loading={m.isPending} onClick={() => m.mutate({ id: s.id, que: "autorizar" })}>Autorizar</Button>
                <Button color="red" variant="light" loading={m.isPending} onClick={() => m.mutate({ id: s.id, que: "rechazar" })}>Rechazar</Button>
              </Group>
            )}
        </Card>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Requisiciones y creación de órdenes
// ---------------------------------------------------------------------------
function NuevaRequisicion() {
  const op = useOpciones();
  const refrescar = useRefrescar();
  const [rs, setRs] = useState([{ articulo: null as string | null, cantidad: "", unidad: null as string | null, comentario: "" }]);
  const [d, setD] = useState({ requerido: "", comentario: "", enviar: true });
  const m = useMutation({
    mutationFn: () => POST("/api/compras/requisiciones", { requerido_para: fechaIso(d.requerido), comentario: d.comentario || null, enviar: d.enviar, renglones: rs.filter((r) => r.articulo && r.cantidad).map((r) => ({ articulo: r.articulo, cantidad: r.cantidad, unidad: r.unidad, comentario: r.comentario || null })) }),
    onSuccess: () => { setRs([{ articulo: null, cantidad: "", unidad: null, comentario: "" }]); refrescar(); },
  });
  const ins: any[] = op.data?.insumos ?? [];
  return (
    <Card withBorder>
      <Text fw={600}>Nueva requisición</Text>
      <Text size="xs" c="dimmed" mb="sm">Se estima con el costo de referencia y se autoriza por monto: hasta $10,000 el autorizador de nivel 1, arriba dirección.</Text>
      <Stack gap={6}>
        {rs.map((r, i) => {
          const a = ins.find((x) => x.clave === r.articulo);
          return (
            <Group key={i} align="flex-end">
              <Select label={i === 0 ? "Insumo" : undefined} searchable w={300} data={ins.map((x) => ({ value: x.clave, label: `${x.clave} · ${x.nombre}` }))} value={r.articulo} onChange={(v) => setRs(rs.map((y, j) => (j === i ? { ...y, articulo: v, unidad: ins.find((z) => z.clave === v)?.unidad_compra ?? ins.find((z) => z.clave === v)?.unidad ?? null } : y)))} />
              <TextInput label={i === 0 ? "Cantidad" : undefined} w={100} value={r.cantidad} onChange={(e) => { const v = e.currentTarget.value; setRs(rs.map((y, j) => (j === i ? { ...y, cantidad: v } : y))); }} />
              <Select label={i === 0 ? "Unidad" : undefined} w={110} data={a ? [...new Set([a.unidad_compra, a.unidad].filter(Boolean))] : []} value={r.unidad} onChange={(v) => setRs(rs.map((y, j) => (j === i ? { ...y, unidad: v } : y)))} />
              <TextInput label={i === 0 ? "Comentario" : undefined} w={240} value={r.comentario} onChange={(e) => { const v = e.currentTarget.value; setRs(rs.map((y, j) => (j === i ? { ...y, comentario: v } : y))); }} />
              {rs.length > 1 && <ActionIcon variant="subtle" color="red" mb={4} onClick={() => setRs(rs.filter((_, j) => j !== i))}>✕</ActionIcon>}
            </Group>
          );
        })}
        <Button variant="default" size="xs" w={160} onClick={() => setRs([...rs, { articulo: null, cantidad: "", unidad: null, comentario: "" }])}>Agregar insumo</Button>
        <Group align="flex-end">
          <TextInput label="Se necesita para" placeholder="DD/MM/AAAA" w={140} value={d.requerido} onChange={(e) => setD({ ...d, requerido: e.currentTarget.value })} />
          <TextInput label="Comentario" w={300} value={d.comentario} onChange={(e) => setD({ ...d, comentario: e.currentTarget.value })} />
          <Checkbox label="Enviar a autorización" checked={d.enviar} onChange={(e) => setD({ ...d, enviar: e.currentTarget.checked })} />
          <Button loading={m.isPending} onClick={() => m.mutate()}>Registrar</Button>
        </Group>
        {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
        {m.data && <Alert color="green">Requisición {m.data.folio} por {$(m.data.monto_estimado)}{d.enviar ? " enviada a autorización." : " guardada en borrador."}</Alert>}
      </Stack>
    </Card>
  );
}

function CrearOC({ req, cerrar }: { req: any; cerrar: () => void }) {
  const op = useOpciones();
  const refrescar = useRefrescar();
  const pendientes = req.renglones.filter((r: any) => Number(r.cantidad) > Number(r.cantidad_ordenada));
  const [enc, setEnc] = useState({ proveedor: null as string | null, almacen: "MP-MAT", entrega: "", condiciones: "" });
  const inicial = (r: any) => {
    const usaCompra = r.unidad_compra && r.factor_compra;
    const pend = Number(r.cantidad) - Number(r.cantidad_ordenada);
    return { usar: true, cantidad: String(usaCompra ? Math.round((pend / Number(r.factor_compra)) * 1000) / 1000 : pend), unidad: usaCompra ? r.unidad_compra : r.unidad, precio: "", tasa: r.tasa_iva ?? op.data?.tasas_iva?.[0]?.clave ?? null };
  };
  const [ls, setLs] = useState<Record<string, any>>(() => Object.fromEntries(pendientes.map((r: any) => [r.id, inicial(r)])));
  const precioDe = (r: any, prov: string | null) => r.precios?.find((p: any) => p.proveedor === prov)?.precio ?? "";
  const m = useMutation({
    mutationFn: () => POST("/api/compras/ordenes", {
      requisicion: req.folio, proveedor: enc.proveedor, almacen: enc.almacen, fecha_entrega: fechaIso(enc.entrega), condiciones: enc.condiciones || null,
      renglones: pendientes.filter((r: any) => ls[r.id]?.usar).map((r: any) => ({ requisicion_renglon_id: r.id, cantidad: ls[r.id].cantidad, unidad: ls[r.id].unidad, precio: ls[r.id].precio, tasa_iva: ls[r.id].tasa })),
    }),
    onSuccess: refrescar,
  });
  const total = pendientes.filter((r: any) => ls[r.id]?.usar).reduce((s: number, r: any) => s + Number(ls[r.id].cantidad || 0) * Number(ls[r.id].precio || 0) * (1 + Number(op.data?.tasas_iva?.find((t: any) => t.clave === ls[r.id].tasa)?.tasa ?? 0)), 0);
  return (
    <Modal opened onClose={cerrar} size="90%" title={`Orden de compra desde ${req.folio}`}>
      <Stack>
        <Group align="flex-end">
          <Select label="Proveedor" searchable w={300} data={(op.data?.proveedores ?? []).map((p: any) => ({ value: p.clave, label: `${p.clave} · ${p.nombre}` }))} value={enc.proveedor}
            onChange={(v) => { setEnc({ ...enc, proveedor: v }); setLs((x) => Object.fromEntries(Object.entries(x).map(([k, y]: any) => [k, { ...y, precio: precioDe(pendientes.find((r: any) => r.id === k), v) || y.precio }]))); }} />
          <Select label="Se recibe en" w={220} data={(op.data?.almacenes ?? []).map((a: any) => ({ value: a.clave, label: `${a.clave} · ${a.nombre}` }))} value={enc.almacen} onChange={(v) => setEnc({ ...enc, almacen: v ?? "MP-MAT" })} />
          <TextInput label="Fecha de entrega" placeholder="DD/MM/AAAA" w={140} value={enc.entrega} onChange={(e) => setEnc({ ...enc, entrega: e.currentTarget.value })} />
          <TextInput label="Condiciones" w={260} value={enc.condiciones} onChange={(e) => setEnc({ ...enc, condiciones: e.currentTarget.value })} />
        </Group>
        <Table withTableBorder fz="sm">
          <Table.Thead><Table.Tr><Table.Th /><Table.Th>Insumo</Table.Th><Table.Th>Pendiente</Table.Th><Table.Th>Cantidad</Table.Th><Table.Th>Unidad</Table.Th><Table.Th>Precio sin IVA (por unidad)</Table.Th><Table.Th>IVA</Table.Th><Table.Th>Precios anteriores</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{pendientes.map((r: any) => {
            const l = ls[r.id]; const set = (c: any) => setLs((x) => ({ ...x, [r.id]: { ...x[r.id], ...c } }));
            return (
              <Table.Tr key={r.id}>
                <Table.Td><Checkbox checked={l.usar} onChange={(e) => set({ usar: e.currentTarget.checked })} /></Table.Td>
                <Table.Td>{r.articulo}<Text size="xs" c="dimmed">{r.nombre}</Text></Table.Td>
                <Table.Td>{cant(Number(r.cantidad) - Number(r.cantidad_ordenada))} {r.unidad}</Table.Td>
                <Table.Td><TextInput w={90} value={l.cantidad} onChange={(e) => set({ cantidad: e.currentTarget.value })} /></Table.Td>
                <Table.Td><Select w={100} data={[...new Set([r.unidad_compra, r.unidad].filter(Boolean))]} value={l.unidad} onChange={(v) => set({ unidad: v })} /></Table.Td>
                <Table.Td><TextInput w={120} value={l.precio} onChange={(e) => set({ precio: e.currentTarget.value })} /></Table.Td>
                <Table.Td><Select w={150} data={(op.data?.tasas_iva ?? []).map((t: any) => ({ value: t.clave, label: `${t.clave} (${numero(Number(t.tasa) * 100, 0)} %)` }))} value={l.tasa} onChange={(v) => set({ tasa: v })} /></Table.Td>
                <Table.Td><Text size="xs">{(r.precios ?? []).map((p: any) => `${p.proveedor}: ${$(p.precio, 4)}/${p.unidad ?? ""}`).join(" · ") || "—"}</Text></Table.Td>
              </Table.Tr>
            );
          })}</Table.Tbody>
        </Table>
        <Text fw={700}>Total estimado con IVA: {$(total)}</Text>
        <Text size="xs" c="dimmed">Si el total pasa de lo autorizado en la requisición más la tolerancia (Configuración → Compras), la orden vuelve a autorización.</Text>
        {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
        {m.data ? <Alert color="green">Orden {m.data.folio} por {$(m.data.total)} · {m.data.estatus === "EMITIDA" ? "emitida" : "requiere autorización (rebasa lo autorizado)"}.</Alert>
          : <Button loading={m.isPending} disabled={!enc.proveedor || !fechaIso(enc.entrega)} onClick={() => m.mutate()}>Emitir orden de compra</Button>}
      </Stack>
    </Modal>
  );
}

function DetalleRequisicion({ id, cerrar }: { id: string; cerrar: () => void }) {
  const { puede, yo } = useSesion();
  const refrescar = useRefrescar();
  const r = useQuery({ queryKey: ["c-doc", "req", id], queryFn: () => GET(`/api/compras/requisiciones/${id}`) });
  const [oc, setOc] = useState(false);
  const [motivo, setMotivo] = useState("");
  const accion = useMutation({ mutationFn: (que: string) => POST(`/api/compras/requisiciones/${id}/${que}`, que === "cancelar" ? { motivo } : {}), onSuccess: refrescar });
  const q = r.data;
  return (
    <Modal opened onClose={cerrar} size="xl" title={q ? `Requisición ${q.folio}` : "Requisición"}>
      {q && (
        <Stack>
          <Group><Est e={q.estatus} /><Text size="sm">{q.origen === "EXPLOSION" ? `Del plan ${q.plan}` : "Manual"} · solicitó {q.solicitante} · {fechaHora(q.creado_en)}{q.requerido_para ? ` · para el ${fecha(q.requerido_para)}` : ""} · estimado {$(q.monto_estimado)}</Text></Group>
          {q.comentario && <Text size="sm" c="dimmed">{q.comentario}</Text>}
          <Firmas firmas={q.firmas} />
          <Table fz="sm" withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Insumo</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Ordenado</Table.Th><Table.Th ta="right">Costo est.</Table.Th><Table.Th>Comentario</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{q.renglones.map((x: any) => <Table.Tr key={x.id}><Table.Td>{x.articulo}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td><Table.Td ta="right">{cant(x.cantidad)} {x.unidad}</Table.Td><Table.Td ta="right">{cant(x.cantidad_ordenada)}</Table.Td><Table.Td ta="right">{$(x.costo_estimado, 4)}</Table.Td><Table.Td>{x.comentario}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
          {!!q.ordenes.length && <Text size="sm">Órdenes: {q.ordenes.map((o: any) => `${o.folio} (${o.proveedor}, ${o.estatus.toLowerCase()})`).join(" · ")}</Text>}
          <Group>
            {q.estatus === "BORRADOR" && puede("compras.requisiciones:crear", "compras.requisiciones:editar") && <Button onClick={() => accion.mutate("enviar")} loading={accion.isPending}>Enviar a autorización</Button>}
            {["AUTORIZADA", "ORDENADA"].includes(q.estatus) && puede("compras.ordenes:crear") && q.renglones.some((x: any) => Number(x.cantidad) > Number(x.cantidad_ordenada)) && <Button color="green" onClick={() => setOc(true)}>Crear orden de compra</Button>}
          </Group>
          {["BORRADOR", "ENVIADA", "AUTORIZADA", "RECHAZADA"].includes(q.estatus) && (puede("compras.requisiciones:cancelar") || (q.estatus === "BORRADOR" && q.solicitante === yo.usuario.usuario)) && (
            <Group align="flex-end"><TextInput label="Motivo de cancelación" w={320} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} /><Button color="red" variant="light" disabled={motivo.trim().length < 3} onClick={() => accion.mutate("cancelar")}>Cancelar requisición</Button></Group>
          )}
          {accion.error && <Alert color="red">{textoError(accion.error)}</Alert>}
          {oc && <CrearOC req={q} cerrar={() => { setOc(false); r.refetch(); }} />}
        </Stack>
      )}
    </Modal>
  );
}

function Requisiciones() {
  const { puede } = useSesion();
  const [estatus, setEstatus] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const r = useQuery({ queryKey: ["c-req", estatus], queryFn: () => GET(`/api/compras/requisiciones${estatus ? `?estatus=${estatus}` : ""}`) });
  return (
    <Stack>
      {puede("compras.requisiciones:crear") && <NuevaRequisicion />}
      <Select w={200} label="Mostrar" clearable placeholder="Todas" value={estatus} onChange={setEstatus} data={["BORRADOR", "ENVIADA", "AUTORIZADA", "ORDENADA", "RECHAZADA", "CANCELADA"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))} />
      <Table withTableBorder striped highlightOnHover fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Estatus</Table.Th><Table.Th>Origen</Table.Th><Table.Th>Solicitó</Table.Th><Table.Th>Para</Table.Th><Table.Th ta="right">Insumos</Table.Th><Table.Th ta="right">Estimado</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.requisiciones ?? []).map((q: any) => (
          <Table.Tr key={q.id} style={{ cursor: "pointer" }} onClick={() => setVer(q.id)}>
            <Table.Td>{q.folio}</Table.Td><Table.Td><Est e={q.estatus} /></Table.Td><Table.Td>{q.origen === "EXPLOSION" ? `Plan ${q.plan}` : "Manual"}</Table.Td><Table.Td>{q.solicitante}</Table.Td>
            <Table.Td>{q.requerido_para ? fecha(q.requerido_para) : ""}</Table.Td><Table.Td ta="right">{q.renglones}</Table.Td><Table.Td ta="right">{$(q.monto_estimado)}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
      {ver && <DetalleRequisicion id={ver} cerrar={() => setVer(null)} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Órdenes de compra: detalle, impresión, recepción y factura
// ---------------------------------------------------------------------------
function imprimirOC(o: any) {
  const w = window.open("", "_blank");
  if (!w) return;
  const filas = o.renglones.map((r: any) => `<tr><td>${r.orden}</td><td>${r.articulo}<br><small>${r.nombre}</small></td><td class="d">${cant(r.cantidad)} ${r.unidad}</td><td class="d">${$(r.precio, 4)}</td><td class="d">${numero(Number(r.tasa_iva) * 100, 0)} %</td><td class="d">${$(r.importe)}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${o.folio}</title><style>body{font-family:system-ui,sans-serif;font-size:12px;margin:24px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:4px;text-align:left}.d{text-align:right}h1{font-size:18px}</style></head><body>
    <h1>Orden de compra ${o.folio}</h1>
    <p><b>Proveedor:</b> ${o.razon_social} (${o.rfc})<br><b>Entregar en:</b> ${o.almacen_nombre} · <b>fecha:</b> ${fecha(o.fecha_entrega)}<br><b>Condiciones:</b> ${o.condiciones ?? o.condiciones_pago ?? ""} · crédito ${o.dias_credito} días</p>
    <table><thead><tr><th>#</th><th>Artículo</th><th class="d">Cantidad</th><th class="d">Precio</th><th class="d">IVA</th><th class="d">Importe</th></tr></thead><tbody>${filas}</tbody></table>
    <p class="d"><b>Subtotal ${$(o.subtotal)} · IVA ${$(o.iva)} · Total ${$(o.total)}</b></p>
    <p><small>Requisición ${o.requisicion}. Emitida por ${o.creado_por} el ${fechaHora(o.creado_en)}. Facturar a nombre de la empresa e incluir el número de orden.</small></p>
    <script>window.print()</script></body></html>`);
  w.document.close();
}

function Recibir({ o, alTerminar }: { o: any; alTerminar: (aviso: string) => void }) {
  const pend = o.renglones.filter((r: any) => Number(r.cantidad) > Number(r.cantidad_recibida));
  const [ls, setLs] = useState<Record<string, any>>(Object.fromEntries(pend.map((r: any) => [r.id, { cantidad: String(Number(r.cantidad) - Number(r.cantidad_recibida)), lote: "", caducidad: "" }])));
  const [remision, setRemision] = useState("");
  const m = useMutation({
    mutationFn: () => POST(`/api/compras/ordenes/${o.id}/recibir`, { remision: remision || null, renglones: pend.map((r: any) => ({ oc_renglon_id: r.id, cantidad: ls[r.id].cantidad || "0", lote: ls[r.id].lote || null, caducidad: fechaIso(ls[r.id].caducidad) })).filter((x: any) => Number(x.cantidad) > 0) }),
    onSuccess: (x: any) => alTerminar(`Recepción ${x.folio} registrada: la mercancía entró al inventario (${x.movimiento}).`),
  });
  return (
    <Card withBorder>
      <Text fw={600}>Recibir mercancía</Text>
      <Text size="xs" c="dimmed" mb="xs">Escribe lo que realmente llegó. Entra al inventario al precio de la orden de compra.</Text>
      <Table fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Pendiente</Table.Th><Table.Th>Recibido</Table.Th><Table.Th>Lote</Table.Th><Table.Th>Caducidad</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{pend.map((r: any) => {
          const set = (c: any) => setLs((x) => ({ ...x, [r.id]: { ...x[r.id], ...c } }));
          return (
            <Table.Tr key={r.id}>
              <Table.Td>{r.articulo}<Text size="xs" c="dimmed">{r.nombre}</Text></Table.Td><Table.Td>{cant(Number(r.cantidad) - Number(r.cantidad_recibida))} {r.unidad}</Table.Td>
              <Table.Td><TextInput w={90} value={ls[r.id].cantidad} onChange={(e) => set({ cantidad: e.currentTarget.value })} /></Table.Td>
              <Table.Td>{r.maneja_lote ? <TextInput w={140} value={ls[r.id].lote} onChange={(e) => set({ lote: e.currentTarget.value })} /> : "—"}</Table.Td>
              <Table.Td>{r.maneja_lote && r.maneja_caducidad ? <TextInput w={120} placeholder="DD/MM/AAAA" value={ls[r.id].caducidad} onChange={(e) => set({ caducidad: e.currentTarget.value })} /> : "—"}</Table.Td>
            </Table.Tr>
          );
        })}</Table.Tbody>
      </Table>
      <Group mt="xs" align="flex-end"><TextInput label="Remisión del proveedor" w={200} value={remision} onChange={(e) => setRemision(e.currentTarget.value)} /><Button loading={m.isPending} onClick={() => m.mutate()}>Registrar recepción</Button></Group>
      {m.error && <Alert mt="xs" color="red">{textoError(m.error)}</Alert>}
    </Card>
  );
}

function Factura({ o, alTerminar }: { o: any; alTerminar: (aviso: string) => void }) {
  const [xml, setXml] = useState<string | null>(null);
  const [rel, setRel] = useState<Record<number, string | null>>({});
  const relaciones = () => Object.entries(rel).map(([orden, id]) => ({ orden: Number(orden), oc_renglon_id: id }));
  const revisar = useMutation({ mutationFn: (x: string) => POST(`/api/compras/ordenes/${o.id}/factura-revisar`, { xml: x, relaciones: relaciones() }) });
  const registrar = useMutation({
    mutationFn: () => POST(`/api/compras/ordenes/${o.id}/factura`, { xml, relaciones: relaciones() }),
    onSuccess: (x: any) => { setXml(null); revisar.reset(); alTerminar(x.estatus === "COTEJADA" ? "Factura registrada y cotejada: ya está en cuentas por pagar." : "Factura registrada con diferencias: queda pendiente de autorización del contralor."); },
  });
  const p = revisar.data;
  return (
    <Card withBorder>
      <Text fw={600}>Factura del proveedor (XML)</Text>
      <Text size="xs" c="dimmed" mb="xs">Se coteja contra la orden de compra (precio e IVA) y lo recibido (cantidad). Si todo cuadra dentro de la tolerancia pasa a cuentas por pagar; si no, la autoriza el contralor.</Text>
      <FileButton accept=".xml,text/xml,application/xml" onChange={async (f) => { if (!f) return; const t = await f.text(); setXml(t); setRel({}); revisar.mutate(t); }}>
        {(props) => <Button variant="default" {...props}>Elegir archivo XML</Button>}
      </FileButton>
      {revisar.error && <Alert mt="xs" color="red">{textoError(revisar.error)}</Alert>}
      {p && (
        <Stack mt="sm" gap="xs">
          <Text size="sm">{p.emisor} · {p.serie ?? ""}{p.folio ?? ""} · {p.fecha_local} · total {$(p.total)} · {p.metodo_pago} · UUID {p.uuid}</Text>
          <Table fz="xs" withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Concepto</Table.Th><Table.Th>Cantidad</Table.Th><Table.Th>Precio</Table.Th><Table.Th>Importe</Table.Th><Table.Th>IVA</Table.Th><Table.Th>Corresponde a</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{p.conceptos.map((c: any) => (
              <Table.Tr key={c.orden}><Table.Td>{c.descripcion}<Text size="xs" c="dimmed">{c.no_identificacion}</Text></Table.Td><Table.Td>{cant(c.cantidad)}</Table.Td><Table.Td>{$(c.valor_unitario, 4)}</Table.Td><Table.Td>{$(c.importe)}</Table.Td><Table.Td>{$(c.iva)}</Table.Td>
                <Table.Td><Select size="xs" w={220} clearable data={p.renglones_oc.map((r: any) => ({ value: r.id, label: `${r.orden}. ${r.articulo}` }))} value={rel[c.orden] !== undefined ? rel[c.orden] : c.oc_renglon_id}
                  onChange={(v) => { const n = { ...rel, [c.orden]: v }; setRel(n); revisar.mutate(xml!); }} /></Table.Td></Table.Tr>
            ))}</Table.Tbody>
          </Table>
          {p.diferencias.map((d: any, i: number) => <Text key={i} size="xs" c={d.dentro ? "green" : "red"}>{d.dentro ? "✓" : "✗"} {d.descripcion}</Text>)}
          <Alert color={p.cotejo_ok ? "green" : "orange"}>{p.cotejo_ok ? "El cotejo cuadra: al registrar pasa a cuentas por pagar." : "Hay diferencias fuera de tolerancia: al registrar queda pendiente de autorización del contralor."}</Alert>
          <Button loading={registrar.isPending} onClick={() => registrar.mutate()}>Registrar factura</Button>
          {registrar.error && <Alert color="red">{textoError(registrar.error)}</Alert>}
        </Stack>
      )}
    </Card>
  );
}

function DetalleOC({ id, cerrar }: { id: string; cerrar: () => void }) {
  const { puede } = useSesion();
  const refrescar = useRefrescar();
  const r = useQuery({ queryKey: ["c-doc", "oc", id], queryFn: () => GET(`/api/compras/ordenes/${id}`) });
  const [motivo, setMotivo] = useState("");
  const cancelar = useMutation({ mutationFn: () => POST(`/api/compras/ordenes/${id}/cancelar`, { motivo }), onSuccess: () => { refrescar(); r.refetch(); } });
  const o = r.data;
  const [aviso, setAviso] = useState<string | null>(null);
  const listo = (msg: string) => { setAviso(msg); refrescar(); r.refetch(); };
  return (
    <Modal opened onClose={cerrar} size="90%" title={o ? `Orden de compra ${o.folio}` : "Orden de compra"}>
      {o && (
        <Stack>
          <Group justify="space-between">
            <Group><Est e={o.estatus} /><Text size="sm">{o.proveedor} · {o.razon_social} · entrega {fecha(o.fecha_entrega)} en {o.almacen} · requisición {o.requisicion}</Text></Group>
            {o.total !== null && <Button variant="default" onClick={() => imprimirOC(o)}>Imprimir / guardar PDF</Button>}
          </Group>
          <Firmas firmas={o.firmas} />
          {aviso && <Alert color="green" withCloseButton onClose={() => setAviso(null)}>{aviso}</Alert>}
          <Table fz="sm" withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>Artículo</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Recibido</Table.Th><Table.Th ta="right">Precio</Table.Th><Table.Th ta="right">IVA</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{o.renglones.map((x: any) => <Table.Tr key={x.id}><Table.Td>{x.orden}</Table.Td><Table.Td>{x.articulo}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td><Table.Td ta="right">{cant(x.cantidad)} {x.unidad}</Table.Td><Table.Td ta="right">{cant(x.cantidad_recibida)}</Table.Td><Table.Td ta="right">{$(x.precio, 4)}</Table.Td><Table.Td ta="right">{numero(Number(x.tasa_iva) * 100, 0)} %</Table.Td><Table.Td ta="right">{$(x.importe)}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
          {o.total !== null && <Text ta="right" fw={700}>Subtotal {$(o.subtotal)} · IVA {$(o.iva)} · Total {$(o.total)}</Text>}
          {!!o.recepciones.length && <Text size="sm">Recepciones: {o.recepciones.map((x: any) => `${x.folio} (${fechaHora(x.creado_en)}, ${x.recibio})`).join(" · ")}</Text>}
          {!!o.facturas.length && <Text size="sm">Facturas: {o.facturas.map((f: any) => `${f.serie ?? ""}${f.folio ?? ""} ${$(f.total)} (${(TEXTO[f.estatus] ?? f.estatus).toLowerCase()})`).join(" · ")}</Text>}
          {["EMITIDA", "PARCIAL"].includes(o.estatus) && puede("compras.recepcion:crear") && <Recibir o={o} alTerminar={listo} />}
          {["PARCIAL", "RECIBIDA"].includes(o.estatus) && puede("compras.facturas:crear") && <Factura o={o} alTerminar={listo} />}
          {["POR_AUTORIZAR", "EMITIDA", "PARCIAL"].includes(o.estatus) && puede("compras.ordenes:cancelar") && (
            <Group align="flex-end"><TextInput label="Motivo" w={320} value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} /><Button color="red" variant="light" disabled={motivo.trim().length < 3} loading={cancelar.isPending} onClick={() => cancelar.mutate()}>{o.estatus === "PARCIAL" ? "Cerrar lo que falta por recibir" : "Cancelar orden"}</Button></Group>
          )}
          {cancelar.error && <Alert color="red">{textoError(cancelar.error)}</Alert>}
        </Stack>
      )}
    </Modal>
  );
}

function Ordenes() {
  const [estatus, setEstatus] = useState<string | null>("POR_AUTORIZAR,EMITIDA,PARCIAL");
  const [ver, setVer] = useState<string | null>(null);
  const r = useQuery({ queryKey: ["c-oc", estatus], queryFn: () => GET(`/api/compras/ordenes${estatus ? `?estatus=${estatus}` : ""}`) });
  return (
    <Stack>
      <Select w={260} label="Mostrar" clearable placeholder="Todas" value={estatus} onChange={setEstatus}
        data={[{ value: "POR_AUTORIZAR,EMITIDA,PARCIAL", label: "Abiertas" }, { value: "RECIBIDA", label: "Recibidas" }, { value: "CANCELADA,RECHAZADA", label: "Canceladas o rechazadas" }]} />
      <Table withTableBorder striped highlightOnHover fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Estatus</Table.Th><Table.Th>Proveedor</Table.Th><Table.Th>Entrega</Table.Th><Table.Th>Almacén</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Facturas</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.ordenes ?? []).map((o: any) => (
          <Table.Tr key={o.id} style={{ cursor: "pointer" }} onClick={() => setVer(o.id)}>
            <Table.Td>{o.folio}</Table.Td><Table.Td><Est e={o.estatus} /></Table.Td><Table.Td>{o.proveedor}<Text size="xs" c="dimmed">{o.proveedor_nombre}</Text></Table.Td>
            <Table.Td>{fecha(o.fecha_entrega)}</Table.Td><Table.Td>{o.almacen}</Table.Td><Table.Td ta="right">{$(o.total)}</Table.Td><Table.Td>{o.facturas || ""}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
      {ver && <DetalleOC id={ver} cerrar={() => setVer(null)} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Facturas, cuentas por pagar, pagos y comparativo
// ---------------------------------------------------------------------------
function Facturas() {
  const [ver, setVer] = useState<string | null>(null);
  const r = useQuery({ queryKey: ["c-fac"], queryFn: () => GET("/api/compras/facturas") });
  const d = useQuery({ queryKey: ["c-doc", "fac", ver], queryFn: () => GET(`/api/compras/facturas/${ver}`), enabled: !!ver });
  return (
    <Stack>
      <Table withTableBorder striped highlightOnHover fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Factura</Table.Th><Table.Th>Proveedor</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>OC</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Cotejo</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.facturas ?? []).map((f: any) => (
          <Table.Tr key={f.id} style={{ cursor: "pointer" }} onClick={() => setVer(f.id)}>
            <Table.Td>{f.serie ?? ""}{f.folio ?? ""}<Text size="xs" c="dimmed">{f.uuid_cfdi}</Text></Table.Td><Table.Td>{f.proveedor}</Table.Td><Table.Td>{fechaHora(f.fecha)}</Table.Td><Table.Td>{f.oc}</Table.Td>
            <Table.Td ta="right">{$(f.total)}</Table.Td><Table.Td><Est e={f.estatus} />{f.diferencias > 0 && <Text span size="xs" c="orange"> {f.diferencias} dif.</Text>}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
      <Modal opened={!!ver} onClose={() => setVer(null)} size="lg" title="Factura de proveedor">
        {d.data && (
          <Stack gap="xs">
            <Group><Est e={d.data.estatus} /><Text size="sm">{d.data.razon_social} · {d.data.serie ?? ""}{d.data.folio ?? ""} · {fechaHora(d.data.fecha)} · total {$(d.data.total)} · OC {d.data.oc}</Text></Group>
            <Text size="xs" c="dimmed">UUID {d.data.uuid_cfdi} · {d.data.metodo_pago} · registró {d.data.registro}</Text>
            <Firmas firmas={d.data.firmas} />
            {d.data.diferencias.map((x: any, i: number) => <Text key={i} size="xs" c={x.dentro ? "green" : "red"}>{x.dentro ? "✓" : "✗"} {x.descripcion}</Text>)}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function CuentasPorPagar() {
  const { puede } = useSesion();
  const op = useOpciones();
  const refrescar = useRefrescar();
  const r = useQuery({ queryKey: ["c-cxp"], queryFn: () => GET("/api/compras/cxp") });
  const [sel, setSel] = useState<Record<string, string>>({});
  const [pago, setPago] = useState({ cuenta: null as string | null, forma: "03", fecha: "", comentario: "" });
  const docs: any[] = r.data?.documentos ?? [];
  const elegidos = docs.filter((x) => sel[x.id] !== undefined);
  const proveedores = [...new Set(elegidos.map((x) => x.proveedor))];
  const m = useMutation({
    mutationFn: () => POST("/api/compras/pagos", { proveedor: proveedores[0], cuenta: pago.cuenta, forma: pago.forma, fecha_programada: fechaIso(pago.fecha), comentario: pago.comentario || null, aplicaciones: elegidos.map((x) => ({ cxp_id: x.id, importe: sel[x.id] })) }),
    onSuccess: () => { setSel({}); refrescar(); },
  });
  const disponible = (x: any) => Number(x.saldo) - Number(x.comprometido);
  return (
    <Stack>
      <Group justify="space-between"><Text fw={600}>Antigüedad de saldos al {r.data ? fecha(r.data.hoy) : ""}</Text>{puede("compras.cxp:exportar") && <Button variant="default" onClick={() => descargar("/api/compras/cxp?formato=xlsx", "cuentas-por-pagar.xlsx")}>Exportar a Excel</Button>}</Group>
      <Table withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Proveedor</Table.Th><Table.Th ta="right">Por vencer</Table.Th><Table.Th ta="right">1-30</Table.Th><Table.Th ta="right">31-60</Table.Th><Table.Th ta="right">61-90</Table.Th><Table.Th ta="right">Más de 90</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.antiguedad ?? []).map((a: any) => <Table.Tr key={a.proveedor}><Table.Td>{a.proveedor}<Text size="xs" c="dimmed">{a.nombre}</Text></Table.Td><Table.Td ta="right">{$(a.por_vencer)}</Table.Td><Table.Td ta="right">{$(a.d1_30)}</Table.Td><Table.Td ta="right">{$(a.d31_60)}</Table.Td><Table.Td ta="right">{$(a.d61_90)}</Table.Td><Table.Td ta="right">{$(a.mas_90)}</Table.Td><Table.Td ta="right"><b>{$(a.total)}</b></Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>
      <Text fw={600}>Facturas por pagar</Text>
      <Table withTableBorder striped fz="sm">
        <Table.Thead><Table.Tr><Table.Th /><Table.Th>Proveedor</Table.Th><Table.Th>Factura</Table.Th><Table.Th>Vence</Table.Th><Table.Th ta="right">Saldo</Table.Th><Table.Th ta="right">Ya programado</Table.Th><Table.Th>A pagar</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{docs.map((x) => (
          <Table.Tr key={x.id}>
            <Table.Td>{puede("compras.cxp:crear") && <Checkbox disabled={disponible(x) <= 0} checked={sel[x.id] !== undefined} onChange={(e) => setSel((s) => { const n = { ...s }; if (e.currentTarget.checked) n[x.id] = String(disponible(x)); else delete n[x.id]; return n; })} />}</Table.Td>
            <Table.Td>{x.proveedor}</Table.Td><Table.Td>{x.serie ?? ""}{x.folio ?? ""}<Text size="xs" c="dimmed">{x.oc}</Text></Table.Td>
            <Table.Td>{fecha(x.vencimiento)}{x.vencimiento < (r.data?.hoy ?? "") && <Badge ml={4} size="xs" color="red">vencida</Badge>}</Table.Td>
            <Table.Td ta="right">{$(x.saldo)}</Table.Td><Table.Td ta="right">{Number(x.comprometido) ? $(x.comprometido) : ""}</Table.Td>
            <Table.Td>{sel[x.id] !== undefined && <TextInput size="xs" w={110} value={sel[x.id]} onChange={(e) => { const v = e.currentTarget.value; setSel((s) => ({ ...s, [x.id]: v })); }} />}</Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
      {!!elegidos.length && (
        <Card withBorder>
          <Text fw={600}>Programar pago</Text>
          {proveedores.length > 1 ? <Alert color="orange">Elige facturas de un solo proveedor.</Alert> : (
            <Group align="flex-end" mt="xs">
              <Select label="Cuenta" w={240} clearable data={(op.data?.cuentas ?? []).map((c: any) => ({ value: c.clave, label: `${c.alias} (…${c.terminacion})` }))} value={pago.cuenta} onChange={(v) => setPago({ ...pago, cuenta: v })} />
              <Select label="Forma" w={160} value={pago.forma} onChange={(v) => setPago({ ...pago, forma: v ?? "03" })} data={Object.entries(FORMA).map(([value, label]) => ({ value, label }))} />
              <TextInput label="Fecha de pago" placeholder="DD/MM/AAAA" w={140} value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.currentTarget.value })} />
              <TextInput label="Comentario" w={240} value={pago.comentario} onChange={(e) => setPago({ ...pago, comentario: e.currentTarget.value })} />
              <Button loading={m.isPending} disabled={!fechaIso(pago.fecha)} onClick={() => m.mutate()}>Programar ({$(elegidos.reduce((s, x) => s + Number(sel[x.id] || 0), 0))})</Button>
            </Group>
          )}
          {m.error && <Alert mt="xs" color="red">{textoError(m.error)}</Alert>}
        </Card>
      )}
      {m.data && <Alert color="green">Pago {m.data.folio} por {$(m.data.importe)} programado: queda pendiente de autorización.</Alert>}
    </Stack>
  );
}

function Pagos() {
  const { puede } = useSesion();
  const refrescar = useRefrescar();
  const r = useQuery({ queryKey: ["c-pag"], queryFn: () => GET("/api/compras/pagos") });
  const [abierto, setAbierto] = useState<{ id: string; que: "pagado" | "cancelar" } | null>(null);
  const [d, setD] = useState({ fecha: "", referencia: "", motivo: "" });
  const m = useMutation({
    mutationFn: () => POST(`/api/compras/pagos/${abierto!.id}/${abierto!.que}`, abierto!.que === "pagado" ? { fecha_pago: fechaIso(d.fecha), referencia: d.referencia } : { motivo: d.motivo }),
    onSuccess: () => { setAbierto(null); refrescar(); },
  });
  return (
    <Stack>
      <Table withTableBorder striped fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Estatus</Table.Th><Table.Th>Proveedor</Table.Th><Table.Th>Facturas</Table.Th><Table.Th>Forma</Table.Th><Table.Th>Programado</Table.Th><Table.Th>Pagado</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>{(r.data?.pagos ?? []).map((p: any) => (
          <Table.Tr key={p.id}>
            <Table.Td>{p.folio}</Table.Td><Table.Td><Est e={p.estatus} /></Table.Td><Table.Td>{p.proveedor}</Table.Td>
            <Table.Td><Text size="xs">{(p.aplicaciones ?? []).map((a: any) => `${a.factura} ${$(a.importe)}`).join(" · ")}</Text></Table.Td>
            <Table.Td>{FORMA[p.forma_pago]}{p.cuenta ? ` · ${p.cuenta}` : ""}</Table.Td><Table.Td>{fecha(p.fecha_programada)}</Table.Td><Table.Td>{p.fecha_pago ? `${fecha(p.fecha_pago)} · ${p.referencia}` : ""}</Table.Td>
            <Table.Td ta="right">{$(p.importe)}</Table.Td>
            <Table.Td><Group gap={4} wrap="nowrap">
              {p.estatus === "AUTORIZADO" && puede("compras.cxp:crear", "compras.cxp:editar") && <Button size="xs" color="green" onClick={() => { setD({ fecha: "", referencia: "", motivo: "" }); setAbierto({ id: p.id, que: "pagado" }); }}>Marcar pagado</Button>}
              {["POR_AUTORIZAR", "AUTORIZADO"].includes(p.estatus) && puede("compras.cxp:cancelar") && <Button size="xs" variant="light" color="red" onClick={() => { setD({ fecha: "", referencia: "", motivo: "" }); setAbierto({ id: p.id, que: "cancelar" }); }}>Cancelar</Button>}
            </Group></Table.Td>
          </Table.Tr>
        ))}</Table.Tbody>
      </Table>
      <Modal opened={!!abierto} onClose={() => setAbierto(null)} title={abierto?.que === "pagado" ? "Registrar pago hecho en el banco" : "Cancelar pago"} centered>
        <Stack>
          {abierto?.que === "pagado" ? <>
            <TextInput label="Fecha en que se pagó" placeholder="DD/MM/AAAA" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.currentTarget.value })} />
            <TextInput label="Referencia o folio del banco (SPEI, cheque)" value={d.referencia} onChange={(e) => setD({ ...d, referencia: e.currentTarget.value })} />
          </> : <Textarea label="Motivo" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.currentTarget.value })} />}
          {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
          <Button loading={m.isPending} onClick={() => m.mutate()}>Confirmar</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

function Comparativo() {
  const [dias, setDias] = useState("180");
  const r = useQuery({ queryKey: ["c-comp", dias], queryFn: () => GET(`/api/compras/comparativo?dias=${dias}`) });
  return (
    <Stack>
      <Group align="flex-end"><Select label="Periodo" w={180} value={dias} onChange={(v) => setDias(v ?? "180")} data={[{ value: "30", label: "Últimos 30 días" }, { value: "90", label: "Últimos 90 días" }, { value: "180", label: "Últimos 6 meses" }, { value: "365", label: "Último año" }]} /></Group>
      <Text size="xs" c="dimmed">Precio por unidad base (sin IVA) de las órdenes de compra del periodo, por proveedor. El primero es el de menor último precio.</Text>
      <ScrollArea>
        <Table withTableBorder striped fz="sm">
          <Table.Thead><Table.Tr><Table.Th>Insumo</Table.Th><Table.Th ta="right">Costo de referencia</Table.Th><Table.Th>Proveedor</Table.Th><Table.Th ta="right">Último</Table.Th><Table.Th ta="right">Mínimo</Table.Th><Table.Th ta="right">Promedio</Table.Th><Table.Th ta="right">Máximo</Table.Th><Table.Th ta="right">Compras</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{(r.data?.articulos ?? []).flatMap((a: any) => a.proveedores.map((p: any, i: number) => (
            <Table.Tr key={`${a.clave}-${p.proveedor}`}>
              <Table.Td>{i === 0 && <>{a.clave}<Text size="xs" c="dimmed">{a.nombre} · por {a.unidad}</Text></>}</Table.Td><Table.Td ta="right">{i === 0 ? $(a.costo_referencia, 4) : ""}</Table.Td>
              <Table.Td>{p.proveedor}{i === 0 && a.proveedores.length > 1 && <Badge ml={4} size="xs" color="green">mejor</Badge>}</Table.Td>
              <Table.Td ta="right">{$(p.ultimo, 4)}</Table.Td><Table.Td ta="right">{$(p.minimo, 4)}</Table.Td><Table.Td ta="right">{$(p.promedio, 4)}</Table.Td><Table.Td ta="right">{$(p.maximo, 4)}</Table.Td><Table.Td ta="right">{p.compras}</Table.Td>
            </Table.Tr>
          )))}</Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}

export function Compras() {
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const aut = useQuery({ queryKey: ["c-aut"], queryFn: () => GET("/api/compras/autorizaciones") });
  const porFirmar = (aut.data?.pendientes ?? []).filter((s: any) => s.cubre && !s.propia).length;
  const pestanas = [
    { v: "autorizaciones", t: `Autorizaciones${porFirmar ? ` (${porFirmar})` : ""}`, ok: puede("compras.requisiciones:autorizar", "compras.facturas:autorizar", "compras.cxp:autorizar") },
    { v: "requisiciones", t: "Requisiciones", ok: puede("compras.requisiciones:ver") },
    { v: "ordenes", t: "Órdenes de compra", ok: puede("compras.ordenes:ver", "compras.recepcion:ver") },
    { v: "facturas", t: "Facturas", ok: puede("compras.facturas:ver") },
    { v: "cxp", t: "Cuentas por pagar", ok: puede("compras.cxp:ver") },
    { v: "pagos", t: "Pagos", ok: puede("compras.cxp:ver") },
    { v: "comparativo", t: "Comparativo de precios", ok: puede("compras.ordenes:ver", "compras.facturas:ver") },
  ].filter((p) => p.ok);
  const tab = pestanas.some((p) => p.v === params.get("tab")) ? params.get("tab")! : pestanas[0]?.v;
  return (
    <Stack>
      <Title order={2}>Compras</Title>
      <Tabs value={tab} onChange={(v) => setParams(v ? { tab: v } : {})} keepMounted={false}>
        <Tabs.List>{pestanas.map((p) => <Tabs.Tab key={p.v} value={p.v}>{p.t}</Tabs.Tab>)}</Tabs.List>
        <Tabs.Panel value="autorizaciones" pt="md"><Autorizaciones /></Tabs.Panel>
        <Tabs.Panel value="requisiciones" pt="md"><Requisiciones /></Tabs.Panel>
        <Tabs.Panel value="ordenes" pt="md"><Ordenes /></Tabs.Panel>
        <Tabs.Panel value="facturas" pt="md"><Facturas /></Tabs.Panel>
        <Tabs.Panel value="cxp" pt="md"><CuentasPorPagar /></Tabs.Panel>
        <Tabs.Panel value="pagos" pt="md"><Pagos /></Tabs.Panel>
        <Tabs.Panel value="comparativo" pt="md"><Comparativo /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
