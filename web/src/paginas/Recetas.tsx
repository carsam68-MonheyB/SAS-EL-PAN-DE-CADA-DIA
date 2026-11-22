// Recetas de masas, intermedios (N1) y productos terminados (N2): versiones,
// fórmula convertida, etapas, revisión, activación y costo estándar vigente.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Accordion, Alert, Anchor, Badge, Button, Card, Group, NavLink, ScrollArea, SegmentedControl, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { GET, POST, textoError } from "../api";
import { fecha, fechaHora, numero } from "../formato";

const COLOR_ESTADO: Record<string, string> = { Vigente: "green", Programada: "blue", Borrador: "yellow", Histórica: "gray" };

/** Número sin ceros sobrantes, con coma de miles (hasta 6 decimales). */
export function cantidad(v: string | null | undefined, maximo = 6): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: maximo }).format(n);
}

export function Pesos({ v, d = 2 }: { v: string | null | undefined; d?: number }) {
  return <>{v === null || v === undefined ? "—" : `$${numero(v, d)}`}</>;
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{etiqueta}</Text>
      <Text size="sm">{valor === null || valor === undefined || valor === "" ? "—" : valor}</Text>
    </div>
  );
}

function Version({ clave, nivel, v, verCantidades, puedeActivar }: { clave: string; nivel: string; v: any; verCantidades: boolean; puedeActivar: boolean }) {
  const qc = useQueryClient();
  const [aviso, setAviso] = useState<string[] | null>(null);
  const activar = useMutation({
    mutationFn: () => POST(`/api/recetas/${clave}/${v.version}/activar`),
    onSuccess: (r: any) => {
      setAviso(r.avisos);
      qc.invalidateQueries({ queryKey: ["recetas"] });
    },
  });
  const pct = v.captura === "PCT_PANADERO";
  // En % panadero: harina = tamaño del lote × 100 ÷ suma de %; cada ingrediente = harina × % ÷ 100.
  const sumaPct = v.componentes.reduce((s: number, c: any) => s + Number(c.pct ?? 0), 0);
  const tamano = Number(v.tamano_lote ?? 0);
  const porLote = (c: any) => (sumaPct && tamano ? cantidad(String((tamano * 100) / sumaPct * Number(c.pct) / 100), 4) : "");
  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Dato etiqueta="Vigente desde" valor={fecha(v.vigente_desde)} />
        {nivel === "N1" ? (
          <>
            <Dato etiqueta="Captura" valor={pct ? "% panadero" : "Cantidades"} />
            <Dato etiqueta={`Tamaño del lote (${v.unidad_base})`} valor={cantidad(v.tamano_lote ?? v.tamano_calculado)} />
            <Dato etiqueta={`Rinde por lote (${v.unidad_base})`} valor={cantidad(v.rendimiento_lote ?? v.rendimiento_calculado)} />
            <Dato etiqueta="Merma de proceso" valor={`${cantidad(v.merma_proceso_pct ?? "0")} %`} />
            <Dato etiqueta="Regla de lote" valor={v.regla_lote === "COMPLETO" ? "Lote completo" : "Cantidad exacta"} />
            <Dato etiqueta={`Capacidad de amasadora (${v.unidad_base})`} valor={cantidad(v.capacidad_amasadora)} />
          </>
        ) : (
          <>
            <Dato etiqueta="Merma de formado" valor={`${cantidad(v.merma_formado_pct ?? "0")} %`} />
            <Dato etiqueta="Merma de horneado" valor={`${cantidad(v.merma_horneado_pct ?? "0")} %`} />
            <Dato etiqueta="Piezas por lote" valor={cantidad(v.piezas_por_lote)} />
          </>
        )}
        <Dato etiqueta="Activada" valor={v.activada_en ? `${fechaHora(v.activada_en)} · ${v.activada_por}` : "No"} />
      </SimpleGrid>
      {v.comentario && <Text size="sm" c="dimmed">{v.comentario}</Text>}

      <Text fw={600} size="sm">{nivel === "N1" ? "Fórmula por lote" : "Componentes por pieza buena"}</Text>
      {!verCantidades && <Alert color="gray">Tu puesto no tiene permiso para ver las cantidades de la receta.</Alert>}
      <ScrollArea>
        <Table withTableBorder striped fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tipo</Table.Th><Table.Th>Componente</Table.Th>
              {verCantidades && (pct ? <><Table.Th ta="right">% panadero</Table.Th><Table.Th ta="right">Por lote ({v.unidad_base})</Table.Th></> : <><Table.Th ta="right">Cantidad</Table.Th><Table.Th>Unidad</Table.Th></>)}
              <Table.Th ta="right">Merma</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {v.componentes.map((c: any) => (
              <Table.Tr key={c.clave}>
                <Table.Td>{c.tipo}</Table.Td>
                <Table.Td>{c.clave}<Text size="xs" c="dimmed">{c.nombre}</Text></Table.Td>
                {verCantidades && (pct ? <><Table.Td ta="right">{cantidad(c.pct)} %</Table.Td><Table.Td ta="right">{porLote(c)}</Table.Td></> : <><Table.Td ta="right">{cantidad(c.cantidad)}</Table.Td><Table.Td>{c.unidad}</Table.Td></>)}
                <Table.Td ta="right">{Number(c.merma_pct) ? `${cantidad(c.merma_pct)} %` : ""}</Table.Td>
              </Table.Tr>
            ))}
            {!v.componentes.length && <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed">Sin componentes. Cárgalos en Cargas masivas.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {v.etapas.length > 0 && (
        <>
          <Text fw={600} size="sm">Mano de obra por etapa</Text>
          <Table withTableBorder fz="sm" maw={520}>
            <Table.Thead><Table.Tr><Table.Th>Etapa</Table.Th><Table.Th ta="right">Minutos</Table.Th><Table.Th>Por</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {v.etapas.map((e: any) => <Table.Tr key={e.etapa}><Table.Td>{e.nombre}</Table.Td><Table.Td ta="right">{cantidad(e.minutos)}</Table.Td><Table.Td>{e.base === "LOTE" ? "lote" : "pieza"}</Table.Td></Table.Tr>)}
            </Table.Tbody>
          </Table>
        </>
      )}

      {v.problemas.length > 0 && (
        <Alert color="red" title="Problemas: esta versión no se puede usar todavía">
          {v.problemas.map((p: string) => <Text key={p} size="sm">• {p}</Text>)}
        </Alert>
      )}
      {v.avisos.length > 0 && <Alert color="yellow">{v.avisos.map((p: string) => <Text key={p} size="sm">• {p}</Text>)}</Alert>}
      {v.estatus === "BORRADOR" && puedeActivar && (
        <Group>
          <Button color="green" disabled={v.problemas.length > 0} loading={activar.isPending} onClick={() => activar.mutate()}>Activar versión {v.version}</Button>
          <Text size="xs" c="dimmed">Una vez activa ya no se modifica: para cambiarla se crea otra versión.</Text>
        </Group>
      )}
      {activar.error && <Alert color="red">{textoError(activar.error)}</Alert>}
      {aviso && <Alert color="green">Versión activada.{aviso.length ? ` ${aviso.join(" ")}` : ""}</Alert>}
    </Stack>
  );
}

function CostoVigente({ costo, nivel, unidad }: { costo: any; nivel: string; unidad: string }) {
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">Costo estándar vigente {nivel === "N1" ? `por ${unidad}` : "por pieza"}</Text>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Dato etiqueta="Materia prima" valor={<Pesos v={costo.mp} d={4} />} />
        <Dato etiqueta="Mano de obra" valor={<Pesos v={costo.mod} d={4} />} />
        <Dato etiqueta="Gastos indirectos" valor={<Pesos v={costo.gif} d={4} />} />
        <Dato etiqueta="Total" valor={<b><Pesos v={costo.total} d={4} /></b>} />
        {nivel === "N2" && <Dato etiqueta="Precio al público" valor={<Pesos v={costo.precio} />} />}
        {nivel === "N2" && <Dato etiqueta="Margen" valor={costo.margen === null ? "—" : <><Pesos v={costo.margen} /> ({numero(costo.margen_pct, 1)} %)</>} />}
      </SimpleGrid>
      {!costo.completo && <Alert color="yellow" mt="sm">Costo incompleto. Falta: {costo.faltantes.join("; ")}</Alert>}
      <Anchor component={Link} to="/costos" size="sm" mt="xs">Ver todos los costos y simular cambios →</Anchor>
    </Card>
  );
}

function Detalle({ clave }: { clave: string }) {
  const r = useQuery({ queryKey: ["recetas", clave], queryFn: () => GET(`/api/recetas/${clave}`) });
  if (r.error) return <Alert color="red">{textoError(r.error)}</Alert>;
  if (!r.data) return null;
  const d = r.data;
  return (
    <Stack>
      <div>
        <Group gap="xs"><Title order={3}>{d.nombre}</Title><Badge variant="light">{d.nivel === "N1" ? "Masa / intermedio (N1)" : "Producto terminado (N2)"}</Badge></Group>
        <Text size="sm" c="dimmed">{d.clave}</Text>
      </div>
      {d.costo && <CostoVigente costo={d.costo} nivel={d.nivel} unidad={d.unidad} />}
      {!d.versiones.length && (
        <Alert>
          Sin receta. Cárgala en <Anchor component={Link} to="/cargas">Cargas masivas</Anchor>: primero el encabezado ({d.nivel === "N1" ? "Recetas de masas e intermedios" : "Recetas de productos terminados"}) y después los renglones ({d.nivel === "N1" ? "Fórmulas de masas e intermedios" : "Componentes de recetas de SKU"}).
        </Alert>
      )}
      <Accordion variant="separated" defaultValue={String(d.versiones.find((v: any) => v.estado === "Vigente" || v.estado === "Borrador")?.version ?? d.versiones[0]?.version)}>
        {d.versiones.map((v: any) => (
          <Accordion.Item key={v.version} value={String(v.version)}>
            <Accordion.Control>
              <Group gap="xs">
                <Text fw={600}>Versión {v.version}</Text>
                <Badge color={COLOR_ESTADO[v.estado]}>{v.estado}</Badge>
                <Text size="sm" c="dimmed">desde {fecha(v.vigente_desde)}</Text>
                {v.problemas.length > 0 && <Badge color="red" variant="light">{v.problemas.length} problema(s)</Badge>}
              </Group>
            </Accordion.Control>
            <Accordion.Panel><Version clave={d.clave} nivel={d.nivel} v={v} verCantidades={d.ver_cantidades} puedeActivar={d.puede_activar} /></Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}

export function Recetas() {
  const { clave } = useParams();
  const navegar = useNavigate();
  const [nivel, setNivel] = useState("N1");
  const [buscar, setBuscar] = useState("");
  const lista = useQuery({ queryKey: ["recetas"], queryFn: () => GET("/api/recetas") });
  const visibles = useMemo(
    () => (lista.data?.articulos ?? []).filter((a: any) => a.nivel === nivel && `${a.clave} ${a.nombre}`.toLowerCase().includes(buscar.toLowerCase())),
    [lista.data, nivel, buscar],
  );
  const actual = clave ?? visibles[0]?.clave;
  if (lista.error) return <Alert color="red">{textoError(lista.error)}</Alert>;
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Recetas</Title>
        <Button variant="light" component={Link} to="/cargas">Cargar recetas por layout</Button>
      </Group>
      <Group align="flex-start" wrap="nowrap" gap="lg">
        <Stack gap="xs" w={280} style={{ flexShrink: 0 }}>
          <SegmentedControl value={nivel} onChange={setNivel} data={[{ value: "N1", label: "Masas e intermedios" }, { value: "N2", label: "Productos" }]} />
          <TextInput placeholder="Buscar…" value={buscar} onChange={(e) => setBuscar(e.currentTarget.value)} />
          <ScrollArea.Autosize mah="70vh">
            {visibles.map((a: any) => {
              const borrador = a.versiones.some((v: any) => v.estado === "Borrador");
              return (
                <NavLink
                  key={a.clave}
                  active={a.clave === actual}
                  label={a.nombre}
                  description={a.clave}
                  onClick={() => navegar(`/recetas/${a.clave}`)}
                  rightSection={
                    a.vigente ? <Badge size="xs" color="green">v{a.vigente}</Badge>
                    : a.versiones.some((v: any) => v.estado === "Programada") ? <Badge size="xs" color="blue">programada</Badge>
                    : borrador ? <Badge size="xs" color="yellow">borrador</Badge>
                    : <Badge size="xs" color="gray">sin receta</Badge>
                  }
                />
              );
            })}
            {lista.data && !visibles.length && <Text size="sm" c="dimmed">Sin artículos.</Text>}
          </ScrollArea.Autosize>
        </Stack>
        <Stack style={{ flex: 1, minWidth: 0 }}>{actual && <Detalle key={actual} clave={actual} />}</Stack>
      </Group>
    </Stack>
  );
}
