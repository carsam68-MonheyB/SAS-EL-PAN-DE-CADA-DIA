// Tablero y reportes de gestión (4.10). Cada quien ve solo los reportes de sus
// módulos y su alcance; costos y márgenes solo con el permiso de datos
// sensibles. Todo se exporta a Excel. El servidor valida de nuevo.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Box, Button, Card, Group, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { descargar, GET, textoError } from "../api";
import { fecha, fechaIso, numero } from "../formato";

const $ = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : `${Number(v) < 0 ? "-" : ""}$${numero(Math.abs(Number(v)), 2)}`);
const pct = (v: string | null | undefined) => (v === null || v === undefined ? "—" : `${numero(v, 2)} %`);
const cant = (v: string | null | undefined) => (v === null || v === undefined ? "—" : Number(v) % 1 === 0 ? numero(v, 0) : numero(v, 3));
const hoyIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

interface Periodo { desde: string; hasta: string }

function SelectorPeriodo({ p, setP }: { p: Periodo; setP: (p: Periodo) => void }) {
  const [d, setD] = useState(fecha(p.desde));
  const [h, setH] = useState(fecha(p.hasta));
  const rapido = (desde: string, hasta: string) => { setD(fecha(desde)); setH(fecha(hasta)); setP({ desde, hasta }); };
  const hoy = hoyIso();
  const menos = (n: number) => { const x = new Date(`${hoy}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  return (
    <Group align="flex-end" gap="xs">
      <TextInput label="Desde" w={120} value={d} onChange={(e) => setD(e.currentTarget.value)} placeholder="DD/MM/AAAA" />
      <TextInput label="Hasta" w={120} value={h} onChange={(e) => setH(e.currentTarget.value)} placeholder="DD/MM/AAAA" />
      <Button variant="default" onClick={() => { const a = fechaIso(d); const b = fechaIso(h); if (a && b) setP({ desde: a, hasta: b }); }}>Consultar</Button>
      <Button variant="subtle" size="compact-sm" onClick={() => rapido(hoy, hoy)}>Hoy</Button>
      <Button variant="subtle" size="compact-sm" onClick={() => rapido(menos(6), hoy)}>7 días</Button>
      <Button variant="subtle" size="compact-sm" onClick={() => rapido(`${hoy.slice(0, 8)}01`, hoy)}>Este mes</Button>
    </Group>
  );
}

function Exportar({ ruta, archivo, puede }: { ruta: string; archivo: string; puede: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  if (!puede) return null;
  return <Stack gap={2}><Button variant="default" onClick={() => descargar(ruta, archivo).then(() => setErr(null)).catch((e) => setErr(textoError(e)))}>Exportar a Excel</Button>{err && <Text size="xs" c="red">{err}</Text>}</Stack>;
}

const Cifra = ({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) => (
  <Card withBorder p="sm"><Text size="xs" c="dimmed">{titulo}</Text><Text fz={26} fw={700} lh={1.2}>{valor}</Text>{nota && <Text size="xs" c="dimmed">{nota}</Text>}</Card>
);

/** Barras de una sola serie (una tonalidad), con el valor al pasar el mouse. */
function Barras({ datos, titulo }: { datos: { etiqueta: string; valor: number; detalle: string }[]; titulo: string }) {
  const max = Math.max(...datos.map((x) => x.valor), 0);
  if (!datos.length || max <= 0) return <Card withBorder p="sm"><Text fw={600} size="sm">{titulo}</Text><Text size="sm" c="dimmed">Sin datos en el periodo.</Text></Card>;
  const H = 140;
  return (
    <Card withBorder p="sm">
      <Text fw={600} size="sm" mb={6}>{titulo}</Text>
      <Group gap={2} align="flex-end" wrap="nowrap" h={H + 20} style={{ borderBottom: "1px solid var(--mantine-color-gray-4)" }}>
        {datos.map((x) => (
          <Tooltip key={x.etiqueta} label={`${x.etiqueta}: ${x.detalle}`} withArrow>
            <Stack gap={2} align="center" justify="flex-end" style={{ flex: 1, minWidth: 6, height: H + 20, cursor: "default" }}>
              <Box style={{ width: "70%", maxWidth: 28, height: Math.max(2, (x.valor / max) * H), background: "var(--mantine-color-orange-6)", borderRadius: "4px 4px 0 0" }} />
            </Stack>
          </Tooltip>
        ))}
      </Group>
      <Group gap={2} wrap="nowrap">{datos.map((x, i) => <Text key={x.etiqueta} size="10px" c="dimmed" ta="center" style={{ flex: 1, minWidth: 6, overflow: "hidden", whiteSpace: "nowrap" }}>{datos.length <= 16 || i % Math.ceil(datos.length / 12) === 0 ? x.etiqueta : ""}</Text>)}</Group>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function Resumen({ p, ve }: { p: Periodo; ve: any }) {
  const r = useQuery({ queryKey: ["t-resumen", p], queryFn: () => GET(`/api/tablero/resumen?desde=${p.desde}&hasta=${p.hasta}`) });
  if (r.error) return <Alert color="red">{textoError(r.error)}</Alert>;
  const d = r.data;
  if (!d) return <Text c="dimmed">Cargando…</Text>;
  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        {d.ventas && <Cifra titulo="Ventas (neto de devoluciones)" valor={$(d.ventas.venta)} nota={`${d.ventas.tickets} tickets · promedio ${$(d.ventas.ticket_promedio)}`} />}
        {d.margen && <Cifra titulo="Margen real" valor={pct(d.margen.margen_real_pct)} nota={`${$(d.margen.margen_real)} sobre ${$(d.margen.venta_sin_impuestos)} sin impuestos`} />}
        {d.mermas && <Cifra titulo="Mermas" valor={d.mermas.total === null ? "—" : $(d.mermas.total)} nota={d.mermas.por_causa[0] ? `Principal: ${d.mermas.por_causa[0].nombre}` : "Sin mermas"} />}
        {d.compras && <Cifra titulo="Compras" valor={$(d.compras.total)} nota={`${d.compras.alzas.length} insumos subieron de precio`} />}
        {d.ventas && Number(d.ventas.descuento_oferta) > 0 && <Cifra titulo="Descuento en ofertas" valor={$(d.ventas.descuento_oferta)} />}
      </SimpleGrid>
      {d.ventas && (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Barras titulo="Ventas por día" datos={d.ventas.por_dia.map((x: any) => ({ etiqueta: fecha(x.dia).slice(0, 5), valor: Number(x.venta), detalle: `${$(x.venta)} · ${x.tickets} tickets` }))} />
          <Barras titulo="Ventas por hora" datos={d.por_hora.map((x: any) => ({ etiqueta: `${x.hora}h`, valor: Number(x.venta), detalle: `${$(x.venta)} · ${x.tickets} tickets` }))} />
        </SimpleGrid>
      )}
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {d.top_sku && (
          <Card withBorder p="sm"><Text fw={600} size="sm">Productos más vendidos</Text>
            <Table fz="sm"><Table.Tbody>{d.top_sku.map((x: any) => <Table.Tr key={x.sku}><Table.Td>{x.nombre}</Table.Td><Table.Td ta="right">{cant(x.cantidad)}</Table.Td><Table.Td ta="right">{$(x.venta)}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
          </Card>
        )}
        {d.mermas && (
          <Card withBorder p="sm"><Text fw={600} size="sm">Mermas por causa</Text>
            <Table fz="sm"><Table.Tbody>{d.mermas.por_causa.map((x: any) => <Table.Tr key={x.clave}><Table.Td>{x.nombre}</Table.Td><Table.Td ta="right">{x.registros}</Table.Td><Table.Td ta="right">{x.valor === null ? "—" : $(x.valor)}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
            {!d.mermas.por_causa.length && <Text size="sm" c="dimmed">Sin mermas.</Text>}
          </Card>
        )}
        {d.compras && (
          <Card withBorder p="sm"><Text fw={600} size="sm">Insumos que subieron de precio</Text>
            <Table fz="sm"><Table.Tbody>{d.compras.alzas.map((x: any) => <Table.Tr key={x.clave}><Table.Td>{x.nombre}<Text size="xs" c="dimmed">{$(x.primero)} → {$(x.ultimo)}</Text></Table.Td><Table.Td ta="right" style={{ whiteSpace: "nowrap" }}><Text size="sm" fw={600} c="orange.8">+{numero(x.variacion_pct, 2)} %</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table>
            {!d.compras.alzas.length && <Text size="sm" c="dimmed">Sin alzas en el periodo.</Text>}
          </Card>
        )}
      </SimpleGrid>
      {!ve.ventas && !ve.mermas && !ve.compras && <Alert color="blue">Tu puesto ve los reportes de inventario: entra a "Rotación".</Alert>}
    </Stack>
  );
}

const POR = [{ value: "dia", label: "Día" }, { value: "hora", label: "Hora" }, { value: "sucursal", label: "Sucursal" }, { value: "cajero", label: "Cajero" }, { value: "sku", label: "Producto" }, { value: "familia", label: "Familia" }];
function Ventas({ p, ve, sucursales }: { p: Periodo; ve: any; sucursales: any[] }) {
  const [por, setPor] = useState("dia");
  const [suc, setSuc] = useState<string | null>(null);
  const q = `desde=${p.desde}&hasta=${p.hasta}&por=${por}${suc ? `&sucursal=${suc}` : ""}`;
  const r = useQuery({ queryKey: ["t-ventas", q], queryFn: () => GET(`/api/tablero/ventas?${q}`) });
  const d = r.data;
  return (
    <Stack>
      <Group align="flex-end">
        <Stack gap={4}><Text size="sm" fw={500}>Agrupar por</Text><SegmentedControl data={POR} value={por} onChange={setPor} /></Stack>
        {sucursales.length > 1 && <Select label="Sucursal" w={170} clearable placeholder="Todas" data={sucursales.map((s) => ({ value: s.clave, label: s.nombre }))} value={suc} onChange={setSuc} />}
        <Exportar puede={ve.exportar} ruta={`/api/tablero/ventas?${q}&formato=xlsx`} archivo={`ventas-${por}.xlsx`} />
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {d && (
        <>
          <Text size="sm">Total {$(d.totales.venta)} · {d.totales.tickets} tickets · ticket promedio {$(d.totales.ticket_promedio)}{Number(d.totales.descuento_oferta) ? ` · ofertas ${$(d.totales.descuento_oferta)}` : ""}</Text>
          <ScrollArea.Autosize mah={560}>
            <Table striped withTableBorder fz="sm">
              <Table.Thead><Table.Tr><Table.Th>{POR.find((x) => x.value === por)!.label}</Table.Th><Table.Th ta="right">Tickets</Table.Th>{(por === "sku" || por === "familia") && <Table.Th ta="right">Cantidad</Table.Th>}<Table.Th ta="right">Sin impuestos</Table.Th><Table.Th ta="right">Venta</Table.Th>{por !== "sku" && por !== "familia" && <Table.Th ta="right">Ticket prom.</Table.Th>}<Table.Th ta="right">Ofertas</Table.Th><Table.Th ta="right">% del total</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{d.filas.map((x: any) => (
                <Table.Tr key={x.clave}>
                  <Table.Td>{por === "dia" ? fecha(x.clave) : x.nombre}{por === "sku" || por === "cajero" ? <Text span size="xs" c="dimmed"> {x.clave}</Text> : null}</Table.Td>
                  <Table.Td ta="right">{x.tickets}</Table.Td>{(por === "sku" || por === "familia") && <Table.Td ta="right">{cant(x.cantidad)}</Table.Td>}
                  <Table.Td ta="right">{$(x.venta_sin_impuestos)}</Table.Td><Table.Td ta="right" fw={600}>{$(x.venta)}</Table.Td>{por !== "sku" && por !== "familia" && <Table.Td ta="right">{$(x.ticket_promedio)}</Table.Td>}
                  <Table.Td ta="right">{Number(x.descuento_oferta) ? $(x.descuento_oferta) : "—"}</Table.Td><Table.Td ta="right">{pct(x.participacion)}</Table.Td>
                </Table.Tr>
              ))}</Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          {!d.filas.length && <Text c="dimmed" size="sm">Sin ventas en el periodo.</Text>}
        </>
      )}
    </Stack>
  );
}

function Margen({ p, ve }: { p: Periodo; ve: any }) {
  const q = `desde=${p.desde}&hasta=${p.hasta}`;
  const r = useQuery({ queryKey: ["t-margen", q], queryFn: () => GET(`/api/tablero/margen?${q}`) });
  const d = r.data;
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Text size="sm" c="dimmed">Venta sin impuestos contra el costo estándar (último costeo guardado) y contra el costo real (lo que costó lo vendido según el kárdex).</Text>
        <Exportar puede={ve.exportar} ruta={`/api/tablero/margen?${q}&formato=xlsx`} archivo="margen.xlsx" />
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {d && (
        <>
          <Text size="sm">Venta {$(d.totales.venta_sin_impuestos)} · costo real {$(d.totales.costo_real)} · margen real <b>{$(d.totales.margen_real)} ({pct(d.totales.margen_real_pct)})</b>{d.sin_estandar ? ` · ${d.sin_estandar} producto(s) sin costo estándar` : ""}</Text>
          <ScrollArea>
            <Table striped withTableBorder fz="sm">
              <Table.Thead><Table.Tr><Table.Th>Producto</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Venta</Table.Th><Table.Th ta="right">Costo estándar</Table.Th><Table.Th ta="right">Margen estándar</Table.Th><Table.Th ta="right">Costo real</Table.Th><Table.Th ta="right">Margen real</Table.Th><Table.Th ta="right">Real − estándar</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{d.filas.map((x: any) => (
                <Table.Tr key={x.sku}>
                  <Table.Td>{x.nombre}<Text size="xs" c="dimmed">{x.sku} · {x.familia}</Text></Table.Td><Table.Td ta="right">{cant(x.cantidad)}</Table.Td><Table.Td ta="right">{$(x.venta_sin_impuestos)}</Table.Td>
                  <Table.Td ta="right">{x.costo_estandar === null ? <Text size="xs" c="orange">sin costeo</Text> : $(x.costo_estandar)}</Table.Td>
                  <Table.Td ta="right">{x.margen_estandar === null ? "—" : <>{$(x.margen_estandar)}<Text size="xs" c="dimmed">{pct(x.margen_estandar_pct)}</Text></>}</Table.Td>
                  <Table.Td ta="right">{$(x.costo_real)}</Table.Td><Table.Td ta="right" fw={600}>{$(x.margen_real)}<Text size="xs" c="dimmed">{pct(x.margen_real_pct)}</Text></Table.Td>
                  <Table.Td ta="right">{x.diferencia_costo === null ? "—" : $(x.diferencia_costo)}</Table.Td>
                </Table.Tr>
              ))}</Table.Tbody>
            </Table>
          </ScrollArea>
        </>
      )}
    </Stack>
  );
}

function Mermas({ p, ve }: { p: Periodo; ve: any }) {
  const q = `desde=${p.desde}&hasta=${p.hasta}`;
  const r = useQuery({ queryKey: ["t-mermas", q], queryFn: () => GET(`/api/tablero/mermas?${q}`) });
  const d = r.data;
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Text size="sm" c="dimmed">Mermas del inventario (al costo real) y de producción por etapa (al costo estándar).</Text>
        <Exportar puede={ve.exportar} ruta={`/api/tablero/mermas?${q}&formato=xlsx`} archivo="mermas.xlsx" />
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {d && (
        <>
          {d.total !== null && <Text size="sm">Total <b>{$(d.total)}</b></Text>}
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {[["Por causa", d.por_causa], ["Por producto", d.por_sku]].map(([t, xs]: any) => (
              <Card key={t} withBorder p="sm"><Text fw={600} size="sm">{t}</Text>
                <Table fz="sm"><Table.Tbody>{xs.map((x: any) => <Table.Tr key={x.clave}><Table.Td>{x.nombre}</Table.Td><Table.Td ta="right">{x.registros}</Table.Td><Table.Td ta="right">{x.valor === null ? "—" : $(x.valor)}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
              </Card>
            ))}
          </SimpleGrid>
          <Table striped withTableBorder fz="sm">
            <Table.Thead><Table.Tr><Table.Th>Origen</Table.Th><Table.Th>Almacén</Table.Th><Table.Th>Producto</Table.Th><Table.Th>Causa</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Valor</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{d.filas.map((x: any, i: number) => <Table.Tr key={i}><Table.Td>{x.origen}</Table.Td><Table.Td>{x.almacen}</Table.Td><Table.Td>{x.nombre}</Table.Td><Table.Td>{x.causa_nombre}</Table.Td><Table.Td ta="right">{cant(x.cantidad)} {x.unidad}</Table.Td><Table.Td ta="right">{x.valor === null ? "—" : $(x.valor)}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
          {!d.filas.length && <Text c="dimmed" size="sm">Sin mermas en el periodo.</Text>}
        </>
      )}
    </Stack>
  );
}

function Rotacion({ p, ve }: { p: Periodo; ve: any }) {
  const [grupo, setGrupo] = useState("PT");
  const q = `desde=${p.desde}&hasta=${p.hasta}&grupo=${grupo}`;
  const r = useQuery({ queryKey: ["t-rotacion", q], queryFn: () => GET(`/api/tablero/rotacion?${q}`) });
  const d = r.data;
  return (
    <Stack>
      <Group align="flex-end">
        <SegmentedControl data={[{ value: "PT", label: "Producto terminado" }, { value: "MP", label: "Materia prima" }]} value={grupo} onChange={setGrupo} />
        <Exportar puede={ve.exportar} ruta={`/api/tablero/rotacion?${q}&formato=xlsx`} archivo={`rotacion-${grupo}.xlsx`} />
      </Group>
      <Text size="sm" c="dimmed">Rotación = lo que salió ({grupo === "PT" ? "ventas, mermas y ajustes" : "surtidos a producción, mermas y ajustes"}) ÷ inventario promedio. Días de inventario = días del periodo ÷ rotación. Por producto se mide en cantidad; por almacén, en valor.</Text>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {d && (
        <>
          {!!d.totales.length && (
            <SimpleGrid cols={{ base: 2, md: 4 }}>{d.totales.map((t: any) => <Cifra key={t.almacen} titulo={t.almacen} valor={t.dias === null ? "—" : `${numero(t.dias, 1)} días`} nota={`rota ${t.rotacion ?? "—"} veces · promedio ${$(t.promedio_valor)}`} />)}</SimpleGrid>
          )}
          <ScrollArea.Autosize mah={520}>
            <Table striped withTableBorder fz="sm">
              <Table.Thead><Table.Tr><Table.Th>Almacén</Table.Th><Table.Th>Artículo</Table.Th><Table.Th ta="right">Inicial</Table.Th><Table.Th ta="right">Final</Table.Th><Table.Th ta="right">Salidas</Table.Th><Table.Th ta="right">Rotación</Table.Th><Table.Th ta="right">Días de inventario</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{d.filas.map((x: any) => (
                <Table.Tr key={x.almacen + x.sku}>
                  <Table.Td>{x.almacen}</Table.Td><Table.Td>{x.nombre}{x.sin_movimiento && <Badge ml={6} size="xs" color="gray" variant="light">sin movimiento</Badge>}</Table.Td>
                  <Table.Td ta="right">{cant(x.inicial_cantidad)} {x.unidad}</Table.Td><Table.Td ta="right">{cant(x.final_cantidad)}</Table.Td><Table.Td ta="right">{cant(x.salidas_cantidad)}</Table.Td>
                  <Table.Td ta="right">{x.rotacion ?? "—"}</Table.Td><Table.Td ta="right" fw={600}>{x.dias === null ? "—" : numero(x.dias, 1)}</Table.Td>
                </Table.Tr>
              ))}</Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </>
      )}
    </Stack>
  );
}

function Compras({ p, ve }: { p: Periodo; ve: any }) {
  const q = `desde=${p.desde}&hasta=${p.hasta}`;
  const r = useQuery({ queryKey: ["t-compras", q], queryFn: () => GET(`/api/tablero/compras?${q}`) });
  const d = r.data;
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Text size="sm">{d ? <>Compras del periodo: <b>{$(d.total)}</b></> : ""}</Text>
        <Exportar puede={ve.exportar} ruta={`/api/tablero/compras?${q}&formato=xlsx`} archivo="compras.xlsx" />
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {d && (
        <>
          <Card withBorder p="sm"><Text fw={600} size="sm">Por proveedor</Text>
            <Table fz="sm"><Table.Thead><Table.Tr><Table.Th>Proveedor</Table.Th><Table.Th ta="right">Entradas</Table.Th><Table.Th ta="right">Insumos</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">% del total</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{d.proveedores.map((x: any) => <Table.Tr key={x.proveedor}><Table.Td>{x.nombre}<Text size="xs" c="dimmed">{x.proveedor}</Text></Table.Td><Table.Td ta="right">{x.entradas}</Table.Td><Table.Td ta="right">{x.insumos}</Table.Td><Table.Td ta="right" fw={600}>{$(x.importe)}</Table.Td><Table.Td ta="right">{pct(x.participacion)}</Table.Td></Table.Tr>)}</Table.Tbody>
            </Table>
          </Card>
          <Text fw={600} size="sm">Precio de los insumos (los de mayor compra primero; precio por unidad de almacén, sin IVA)</Text>
          <ScrollArea>
            <Table striped withTableBorder fz="sm">
              <Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>Insumo</Table.Th><Table.Th ta="right">Importe</Table.Th><Table.Th ta="right">Primero</Table.Th><Table.Th ta="right">Último</Table.Th><Table.Th ta="right">Mín.</Table.Th><Table.Th ta="right">Máx.</Table.Th><Table.Th ta="right">Promedio</Table.Th><Table.Th ta="right">Variación</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{d.insumos.map((x: any) => (
                <Table.Tr key={x.clave}>
                  <Table.Td>{x.lugar}</Table.Td><Table.Td>{x.nombre}<Text size="xs" c="dimmed">{x.clave} · {x.unidad} · {x.compras} compras</Text></Table.Td><Table.Td ta="right">{$(x.importe)}</Table.Td>
                  <Table.Td ta="right">{$(x.primero)}</Table.Td><Table.Td ta="right">{$(x.ultimo)}</Table.Td><Table.Td ta="right">{$(x.minimo)}</Table.Td><Table.Td ta="right">{$(x.maximo)}</Table.Td><Table.Td ta="right">{$(x.promedio)}</Table.Td>
                  <Table.Td ta="right">{x.variacion_pct === null ? "—" : <Badge variant="light" color={Number(x.variacion_pct) > 0 ? "orange" : Number(x.variacion_pct) < 0 ? "teal" : "gray"}>{Number(x.variacion_pct) > 0 ? "+" : ""}{numero(x.variacion_pct, 2)} %</Badge>}</Table.Td>
                </Table.Tr>
              ))}</Table.Tbody>
            </Table>
          </ScrollArea>
          {!d.insumos.length && <Text c="dimmed" size="sm">Sin compras en el periodo.</Text>}
        </>
      )}
    </Stack>
  );
}

export function Tablero() {
  const [params, setParams] = useSearchParams();
  const [p, setP] = useState<Periodo>({ desde: `${hoyIso().slice(0, 8)}01`, hasta: hoyIso() });
  const o = useQuery({ queryKey: ["t-opciones"], queryFn: () => GET("/api/tablero/opciones") });
  if (o.error) return <Alert color="red">{textoError(o.error)}</Alert>;
  if (!o.data) return <Text c="dimmed">Cargando…</Text>;
  const ve = o.data.visibles;
  const pestanas = [
    { v: "resumen", t: "Resumen", ok: true }, { v: "ventas", t: "Ventas", ok: ve.ventas }, { v: "margen", t: "Margen por producto", ok: ve.margen },
    { v: "mermas", t: "Mermas", ok: ve.mermas }, { v: "rotacion", t: "Rotación de inventario", ok: ve.rotacion }, { v: "compras", t: "Compras y precios", ok: ve.compras },
  ].filter((x) => x.ok);
  const tab = pestanas.some((x) => x.v === params.get("tab")) ? params.get("tab")! : "resumen";
  return (
    <Stack>
      <Group justify="space-between" align="flex-end"><Title order={2}>Tablero</Title><SelectorPeriodo p={p} setP={setP} /></Group>
      <Tabs value={tab} onChange={(v) => setParams(v ? { tab: v } : {})} keepMounted={false}>
        <Tabs.List>{pestanas.map((x) => <Tabs.Tab key={x.v} value={x.v}>{x.t}</Tabs.Tab>)}</Tabs.List>
        <Tabs.Panel value="resumen" pt="md"><Resumen p={p} ve={ve} /></Tabs.Panel>
        <Tabs.Panel value="ventas" pt="md"><Ventas p={p} ve={ve} sucursales={o.data.sucursales} /></Tabs.Panel>
        <Tabs.Panel value="margen" pt="md"><Margen p={p} ve={ve} /></Tabs.Panel>
        <Tabs.Panel value="mermas" pt="md"><Mermas p={p} ve={ve} /></Tabs.Panel>
        <Tabs.Panel value="rotacion" pt="md"><Rotacion p={p} ve={ve} /></Tabs.Panel>
        <Tabs.Panel value="compras" pt="md"><Compras p={p} ve={ve} /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
