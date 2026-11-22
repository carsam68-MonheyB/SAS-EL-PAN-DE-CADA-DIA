// Costo estándar en cadena (insumos → masas → piezas), margen por SKU,
// simulación del impacto de un cambio de costo y fotos guardadas (historial).
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Badge, Button, Card, Group, Modal, ScrollArea, Select, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { descargar, GET, POST, textoError } from "../api";
import { fecha, fechaHora, fechaIso, numero } from "../formato";
import { useSesion } from "../sesion";
import { cantidad, Pesos } from "./Recetas";

const hoyMx = () => fecha(new Date());

function Desglose({ c, nivel }: { c: any; nivel: string }) {
  return (
    <Stack gap={4} p="xs">
      <Text size="xs" fw={600}>{nivel === "N1" ? `Por lote (rinde ${cantidad(c.rendimiento)}); el costo por unidad = total del lote ÷ rendimiento` : "Por pieza buena"}</Text>
      <Table fz="xs" withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Concepto</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">Costo unitario</Table.Th><Table.Th ta="right">Importe</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {c.componentes.map((l: any) => <Table.Tr key={l.clave}><Table.Td>{l.tipo} · {l.clave}</Table.Td><Table.Td ta="right">{l.cantidad === null ? "—" : cantidad(l.cantidad)}</Table.Td><Table.Td ta="right">{l.costo_unitario === null ? <Badge color="red" size="xs">sin costo</Badge> : <Pesos v={l.costo_unitario} d={4} />}</Table.Td><Table.Td ta="right"><Pesos v={l.importe} d={4} /></Table.Td></Table.Tr>)}
          {c.etapas.map((l: any) => <Table.Tr key={l.etapa}><Table.Td>Mano de obra · {l.etapa}</Table.Td><Table.Td ta="right">{l.minutos === null ? "—" : `${cantidad(l.minutos, 4)} min`}</Table.Td><Table.Td ta="right">{l.costo_minuto === null ? <Badge color="red" size="xs">sin tarifa</Badge> : <Pesos v={l.costo_minuto} d={4} />}</Table.Td><Table.Td ta="right"><Pesos v={l.importe} d={4} /></Table.Td></Table.Tr>)}
          {c.gif_detalle.map((l: any) => <Table.Tr key={l.base}><Table.Td>Gastos indirectos · {l.base}</Table.Td><Table.Td ta="right">{cantidad(l.cantidad, 4)}</Table.Td><Table.Td ta="right"><Pesos v={l.tasa} d={4} /></Table.Td><Table.Td ta="right"><Pesos v={l.importe} d={4} /></Table.Td></Table.Tr>)}
        </Table.Tbody>
      </Table>
      {!c.completo && <Text size="xs" c="orange">Falta: {c.faltantes.join("; ")}</Text>}
    </Stack>
  );
}

function TablaCostos({ articulos, simulado }: { articulos: any[]; simulado: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const filas = simulado ? articulos.filter((a) => a.nuevo && Number(a.nuevo.diferencia) !== 0) : articulos;
  if (simulado && !filas.length) return <Text size="sm" c="dimmed">Ese cambio no afecta a ninguna receta vigente.</Text>;
  return (
    <ScrollArea>
      <Table withTableBorder striped highlightOnHover fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Artículo</Table.Th><Table.Th>Ver.</Table.Th>
            {!simulado && <><Table.Th ta="right">Materia prima</Table.Th><Table.Th ta="right">Mano de obra</Table.Th><Table.Th ta="right">GIF</Table.Th></>}
            <Table.Th ta="right">Costo</Table.Th>
            {simulado && <><Table.Th ta="right">Costo nuevo</Table.Th><Table.Th ta="right">Diferencia</Table.Th></>}
            <Table.Th ta="right">Precio</Table.Th><Table.Th ta="right">Margen</Table.Th>
            {simulado && <Table.Th ta="right">Margen nuevo</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filas.map((a) => {
            const c = a.costo;
            const unidad = a.nivel === "N1" ? `por ${a.unidad}` : "por pieza";
            return (
              <Fragment key={a.clave}>
                <Table.Tr style={{ cursor: c ? "pointer" : undefined }} onClick={() => c && setAbierto(abierto === a.clave ? null : a.clave)}>
                  <Table.Td>
                    {a.clave} {a.nivel === "N1" && <Badge size="xs" variant="light">N1</Badge>}
                    <Text size="xs" c="dimmed">{a.nombre} · {unidad}</Text>
                    {a.problemas.map((p: string) => <Text key={p} size="xs" c="red">{p}</Text>)}
                  </Table.Td>
                  <Table.Td>{a.version ?? ""}</Table.Td>
                  {!simulado && <><Table.Td ta="right">{c && <Pesos v={c.mp} d={4} />}</Table.Td><Table.Td ta="right">{c && <Pesos v={c.mod} d={4} />}</Table.Td><Table.Td ta="right">{c && <Pesos v={c.gif} d={4} />}</Table.Td></>}
                  <Table.Td ta="right">{c ? <><b><Pesos v={c.total} d={4} /></b>{!c.completo && <Badge ml={4} size="xs" color="orange">incompleto</Badge>}</> : "—"}</Table.Td>
                  {simulado && <><Table.Td ta="right"><b><Pesos v={a.nuevo.total} d={4} /></b></Table.Td><Table.Td ta="right"><Text size="sm" c={Number(a.nuevo.diferencia) > 0 ? "red" : "green"}><Pesos v={a.nuevo.diferencia} d={4} /> ({numero(a.nuevo.diferencia_pct, 1)} %)</Text></Table.Td></>}
                  <Table.Td ta="right">{a.nivel === "N2" && <Pesos v={c?.precio} />}</Table.Td>
                  <Table.Td ta="right">{c?.margen !== null && c?.margen !== undefined ? <><Pesos v={c.margen} /> <Text span size="xs" c="dimmed">({numero(c.margen_pct, 1)} %)</Text></> : a.nivel === "N2" && c ? <Text size="xs" c="dimmed">{c.precio ? "faltan datos fiscales" : "sin precio general"}</Text> : ""}</Table.Td>
                  {simulado && <Table.Td ta="right">{a.nuevo.margen !== null ? <><Pesos v={a.nuevo.margen} /> <Text span size="xs" c="dimmed">({numero(a.nuevo.margen_pct, 1)} %)</Text></> : ""}</Table.Td>}
                </Table.Tr>
                {abierto === a.clave && c && <Table.Tr><Table.Td colSpan={simulado ? 8 : 9}><Desglose c={simulado ? a.nuevo : c} nivel={a.nivel} /></Table.Td></Table.Tr>}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function Simulador({ fechaIsoSel, articulos }: { fechaIsoSel: string; articulos: any[] }) {
  // Insumos y empaques que aparecen en las recetas vigentes, con su costo actual.
  const insumos = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of articulos) for (const l of a.costo?.componentes ?? []) if (l.tipo === "INSUMO" || l.tipo === "EMPAQUE") m.set(l.clave, l.costo_unitario);
    return [...m].sort(([x], [y]) => x.localeCompare(y));
  }, [articulos]);
  const [cambios, setCambios] = useState<{ articulo: string | null; costo: string }[]>([{ articulo: null, costo: "" }]);
  const sim = useMutation({ mutationFn: () => POST("/api/costos/simular", { fecha: fechaIsoSel, cambios: cambios.filter((c) => c.articulo && c.costo).map((c) => ({ articulo: c.articulo, costo: c.costo.replaceAll(",", "") })) }) });
  return (
    <Stack>
      <Text size="sm" c="dimmed">Escribe el costo nuevo de uno o varios insumos (por su unidad base). Se recalcula toda la cadena —masas, intermedios y productos— y se muestra el impacto en el margen. No se guarda nada.</Text>
      {cambios.map((c, i) => (
        <Group key={i} align="flex-end">
          <Select label={i === 0 ? "Insumo o empaque" : undefined} searchable w={280} data={insumos.map(([k, v]) => ({ value: k, label: `${k} (hoy ${v === null ? "sin costo" : `$${numero(v, 4)}`})` }))} value={c.articulo} onChange={(v) => setCambios((x) => x.map((y, j) => (j === i ? { ...y, articulo: v } : y)))} />
          <TextInput label={i === 0 ? "Costo nuevo" : undefined} w={140} placeholder="0.00" value={c.costo} onChange={(e) => { const v = e.currentTarget.value; setCambios((x) => x.map((y, j) => (j === i ? { ...y, costo: v } : y))); }} />
          {cambios.length > 1 && <ActionIcon variant="subtle" color="red" onClick={() => setCambios((x) => x.filter((_, j) => j !== i))}>✕</ActionIcon>}
        </Group>
      ))}
      <Group>
        <Button variant="default" onClick={() => setCambios((x) => [...x, { articulo: null, costo: "" }])}>Agregar otro insumo</Button>
        <Button loading={sim.isPending} disabled={!cambios.some((c) => c.articulo && c.costo)} onClick={() => sim.mutate()}>Calcular impacto</Button>
      </Group>
      {sim.error && <Alert color="red">{textoError(sim.error)}</Alert>}
      {sim.data && <TablaCostos articulos={sim.data.articulos} simulado />}
    </Stack>
  );
}

function Historial() {
  const lista = useQuery({ queryKey: ["costeos"], queryFn: () => GET("/api/costos/costeos") });
  const [ver, setVer] = useState<string | null>(null);
  const detalle = useQuery({ queryKey: ["costeo", ver], queryFn: () => GET(`/api/costos/costeos/${ver}`), enabled: !!ver });
  return (
    <Stack>
      <Table withTableBorder striped highlightOnHover fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Guardado</Table.Th><Table.Th>Fecha de costeo</Table.Th><Table.Th>Por</Table.Th><Table.Th ta="right">Artículos</Table.Th><Table.Th>Comentario</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(lista.data?.costeos ?? []).map((k: any) => <Table.Tr key={k.id} style={{ cursor: "pointer" }} onClick={() => setVer(k.id)}><Table.Td>{fechaHora(k.creado_en)}</Table.Td><Table.Td>{fecha(k.fecha)}</Table.Td><Table.Td>{k.usuario}</Table.Td><Table.Td ta="right">{k.articulos}</Table.Td><Table.Td>{k.comentario}</Table.Td></Table.Tr>)}
          {lista.data && !lista.data.costeos.length && <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed">Todavía no se ha guardado ningún costo estándar.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Modal opened={!!ver} onClose={() => setVer(null)} size="xl" title={detalle.data ? `Costo estándar al ${fecha(detalle.data.fecha)} (guardado ${fechaHora(detalle.data.creado_en)})` : "Costo estándar"}>
        {detalle.data && (
          <Table fz="sm" withTableBorder striped>
            <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th>Ver.</Table.Th><Table.Th ta="right">MP</Table.Th><Table.Th ta="right">MO</Table.Th><Table.Th ta="right">GIF</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th ta="right">Margen</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{detalle.data.articulos.map((a: any) => <Table.Tr key={a.clave}><Table.Td>{a.clave}{!a.completo && <Badge ml={4} size="xs" color="orange">incompleto</Badge>}</Table.Td><Table.Td>{a.version}</Table.Td><Table.Td ta="right"><Pesos v={a.mp} d={4} /></Table.Td><Table.Td ta="right"><Pesos v={a.mod} d={4} /></Table.Td><Table.Td ta="right"><Pesos v={a.gif} d={4} /></Table.Td><Table.Td ta="right"><b><Pesos v={a.total} d={4} /></b></Table.Td><Table.Td ta="right">{a.margen !== null ? <Pesos v={a.margen} /> : ""}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        )}
      </Modal>
    </Stack>
  );
}

export function Costos() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [texto, setTexto] = useState(hoyMx());
  const [sel, setSel] = useState(fechaIso(hoyMx())!);
  const [comentario, setComentario] = useState("");
  const [guardado, setGuardado] = useState<string | null>(null);
  const r = useQuery({ queryKey: ["costos", sel], queryFn: () => GET(`/api/costos?fecha=${sel}`) });
  const guardar = useMutation({
    mutationFn: () => POST("/api/costos/costeos", { fecha: sel, comentario }),
    onSuccess: (x: any) => {
      setGuardado(`Se guardó el costo estándar de ${x.articulos} recetas al ${fecha(x.fecha)}.`);
      setComentario("");
      qc.invalidateQueries({ queryKey: ["costeos"] });
    },
  });
  const sinRecetas = r.data && !r.data.articulos.some((a: any) => a.costo);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Costo estándar</Title>
        <Group align="flex-end">
          <TextInput label="Fecha" placeholder="DD/MM/AAAA" w={140} value={texto} error={texto && !fechaIso(texto) ? "Fecha no válida" : undefined}
            onChange={(e) => { const v = e.currentTarget.value; setTexto(v); const iso = fechaIso(v); if (iso) setSel(iso); }} />
          <Button variant="default" onClick={() => descargar(`/api/costos/exportar?fecha=${sel}`, `costo-estandar-${sel}.xlsx`)}>Exportar a Excel</Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed">
        Se calcula de abajo hacia arriba con las recetas activas a la fecha: costo de cada insumo (costo de referencia) → costo por kilo de cada masa e intermedio → costo por pieza de cada producto,
        más mano de obra y gastos indirectos. El margen se calcula sobre el precio al público sin impuestos. Haz clic en un renglón para ver su desglose.
      </Text>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      {r.data && (
        <>
          {sinRecetas && <Alert color="yellow">No hay recetas activas al {fecha(sel)}. Si tus recetas empiezan después (ej. 01/01/2027), cambia la fecha.</Alert>}
          {r.data.faltan_tarifas && <Alert color="gray">No hay tarifas de mano de obra vigentes a esa fecha: el costo no incluye mano de obra (catálogo “Costo de mano de obra por minuto”).</Alert>}
          {r.data.faltan_gif && <Alert color="gray">No hay tasas de gastos indirectos vigentes a esa fecha (catálogo “Tasas de gastos indirectos”).</Alert>}
          <Text size="xs" c="dimmed">Mermas aplicadas con la fórmula {r.data.formula_merma === "DIVIDIR" ? "cantidad ÷ (1 − merma)" : "cantidad × (1 + merma)"} (Configuración).</Text>
          <Tabs defaultValue="costos" keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="costos">Costos y márgenes</Tabs.Tab>
              <Tabs.Tab value="simular">Simular cambio de costo</Tabs.Tab>
              <Tabs.Tab value="historial">Historial guardado</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="costos" pt="md">
              <Stack>
                <TablaCostos articulos={r.data.articulos} simulado={false} />
                {puede("configuracion.parametros:editar", "produccion.recetas:editar") && (
                  <Card withBorder>
                    <Text fw={600} size="sm">Guardar como costo estándar</Text>
                    <Text size="xs" c="dimmed" mb="xs">Guarda una foto de estos costos con la versión de cada receta. La foto no se modifica después: sirve de historial y de base para comparar contra el costo real.</Text>
                    <Group align="flex-end">
                      <TextInput label="Comentario" w={320} value={comentario} onChange={(e) => setComentario(e.currentTarget.value)} />
                      <Button loading={guardar.isPending} disabled={!!sinRecetas} onClick={() => guardar.mutate()}>Guardar costo estándar al {fecha(sel)}</Button>
                    </Group>
                    {guardar.error && <Alert mt="xs" color="red">{textoError(guardar.error)}</Alert>}
                    {guardado && <Alert mt="xs" color="green">{guardado}</Alert>}
                  </Card>
                )}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="simular" pt="md"><Simulador fechaIsoSel={sel} articulos={r.data.articulos} /></Tabs.Panel>
            <Tabs.Panel value="historial" pt="md"><Historial /></Tabs.Panel>
          </Tabs>
        </>
      )}
    </Stack>
  );
}
