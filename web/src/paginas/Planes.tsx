// Plan de producción: piezas por SKU, explosión (masas, lotes, materia prima),
// existencias para el requerimiento neto, aprobación y requisición en borrador.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Button, Group, Modal, NumberInput, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from "@mantine/core";
import { descargar, GET, POST, PUT, textoError } from "../api";
import { fecha, fechaHora, fechaIso } from "../formato";
import { cantidad } from "./Recetas";

const COLOR: Record<string, string> = { BORRADOR: "yellow", APROBADO: "green", CANCELADO: "gray" };

function useOpciones() {
  return useQuery({ queryKey: ["opciones", "plan_produccion"], queryFn: () => GET<Record<string, string[]>>("/api/layouts/plan_produccion/opciones"), retry: false });
}

/** Captura de piezas por SKU (alta de plan o cambio de renglones). */
function CapturaPiezas({ skus, valores, setValores }: { skus: string[]; valores: Record<string, string>; setValores: (f: (x: Record<string, string>) => Record<string, string>) => void }) {
  return (
    <ScrollArea.Autosize mah={420}>
      <Table fz="sm" striped>
        <Table.Thead><Table.Tr><Table.Th>Producto</Table.Th><Table.Th w={160}>Piezas buenas</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {skus.map((s) => (
            <Table.Tr key={s}>
              <Table.Td>{s}</Table.Td>
              <Table.Td>
                <NumberInput size="xs" min={0} thousandSeparator="," decimalSeparator="." allowNegative={false} value={valores[s] ?? ""} onChange={(v) => setValores((x) => ({ ...x, [s]: v === "" ? "" : String(v) }))} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}

function NuevoPlan({ alCerrar }: { alCerrar: () => void }) {
  const op = useOpciones();
  const navegar = useNavigate();
  const [f, setF] = useState("");
  const [turno, setTurno] = useState<string | null>(null);
  const [sucursal, setSucursal] = useState<string | null>(null);
  const [piezas, setPiezas] = useState<Record<string, string>>({});
  const crear = useMutation({
    mutationFn: () => POST("/api/planes", { fecha: f, turno: turno ?? "", sucursal: sucursal ?? "", renglones: Object.entries(piezas).filter(([, v]) => v !== "" && Number(v) > 0).map(([sku, v]) => ({ sku, piezas: v })) }),
    onSuccess: (r: any) => {
      alCerrar();
      if (r.id) navegar(`/planes/${r.id}`);
    },
  });
  if (op.error) return <Alert color="red">{textoError(op.error)}</Alert>;
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <TextInput label="Fecha de producción" placeholder="DD/MM/AAAA" withAsterisk value={f} onChange={(e) => setF(e.currentTarget.value)} error={f && !fechaIso(f) ? "Fecha no válida" : undefined} />
        <Select label="Turno" placeholder="Todo el día" clearable data={op.data?.TURNO ?? []} value={turno} onChange={setTurno} />
        <Select label="Sucursal destino" placeholder="General" clearable data={op.data?.SUCURSAL ?? []} value={sucursal} onChange={setSucursal} />
      </SimpleGrid>
      <Text size="sm" c="dimmed">Escribe las piezas BUENAS de cada producto (las que se quieren vender). El sistema agrega las mermas de cada receta. También puedes cargar el plan desde Cargas masivas.</Text>
      <CapturaPiezas skus={op.data?.SKU ?? []} valores={piezas} setValores={setPiezas} />
      {crear.error && <Alert color="red">{textoError(crear.error)}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={alCerrar}>Cancelar</Button>
        <Button disabled={!fechaIso(f)} loading={crear.isPending} onClick={() => crear.mutate()}>Crear plan</Button>
      </Group>
    </Stack>
  );
}

function Lista() {
  const [nuevo, setNuevo] = useState(false);
  const r = useQuery({ queryKey: ["planes"], queryFn: () => GET("/api/planes") });
  const navegar = useNavigate();
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Plan de producción</Title>
        <Group>
          <Button variant="light" component={Link} to="/cargas?layout=plan_produccion">Cargar plan por layout</Button>
          <Button onClick={() => setNuevo(true)}>Nuevo plan</Button>
        </Group>
      </Group>
      {r.error && <Alert color="red">{textoError(r.error)}</Alert>}
      <Table striped highlightOnHover withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Turno</Table.Th><Table.Th>Sucursal</Table.Th><Table.Th ta="right">Productos</Table.Th><Table.Th ta="right">Piezas</Table.Th><Table.Th>Estatus</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(r.data?.planes ?? []).map((p: any) => (
            <Table.Tr key={p.id} style={{ cursor: "pointer" }} onClick={() => navegar(`/planes/${p.id}`)}>
              <Table.Td>{p.folio}</Table.Td><Table.Td>{fecha(p.fecha)}</Table.Td><Table.Td>{p.turno ?? "Todo el día"}</Table.Td><Table.Td>{p.sucursal ?? "General"}</Table.Td>
              <Table.Td ta="right">{p.productos}</Table.Td><Table.Td ta="right">{cantidad(p.piezas)}</Table.Td><Table.Td><Badge color={COLOR[p.estatus]}>{p.estatus.toLowerCase()}</Badge></Table.Td>
            </Table.Tr>
          ))}
          {r.data && !r.data.planes.length && <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed">Todavía no hay planes.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Modal opened={nuevo} onClose={() => setNuevo(false)} title="Nuevo plan de producción" size="lg">{nuevo && <NuevoPlan alCerrar={() => setNuevo(false)} />}</Modal>
    </Stack>
  );
}

type Exist = Record<string, { existencia: string; en_transito: string }>;

function Origen({ o }: { o: { de: string; cantidad: string }[] }) {
  return <Text size="xs" c="dimmed">{o.map((x) => `${x.de}: ${cantidad(x.cantidad, 3)}`).join(" · ")}</Text>;
}

function Detalle({ id }: { id: string }) {
  const qc = useQueryClient();
  const r = useQuery({ queryKey: ["plan", id], queryFn: () => GET(`/api/planes/${id}`) });
  const op = useOpciones();
  const [piezas, setPiezas] = useState<Record<string, string>>({});
  const [exist, setExist] = useState<Exist>({});
  const [cancelar, setCancelar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    if (!r.data) return;
    setPiezas(Object.fromEntries(r.data.renglones.map((x: any) => [x.clave, String(Number(x.piezas))])));
    setExist(Object.fromEntries(r.data.existencias.map((x: any) => [x.clave, { existencia: String(Number(x.existencia)), en_transito: String(Number(x.en_transito)) }])));
  }, [r.data]);
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["plan", id] });
    qc.invalidateQueries({ queryKey: ["planes"] });
  };
  const accion = useMutation({
    mutationFn: (a: { ruta: string; cuerpo?: unknown; metodo?: "PUT" }) => (a.metodo === "PUT" ? PUT(a.ruta, a.cuerpo) : POST(a.ruta, a.cuerpo)),
    onSuccess: (x: any, a) => {
      setError(null);
      setAviso(a.ruta.endsWith("requisicion") ? `Se generó la requisición ${x.folio} en borrador.` : "Guardado.");
      setCancelar(null);
      refrescar();
    },
    onError: (e) => setError(textoError(e)),
  });
  const skus = useMemo(() => [...new Set([...(r.data?.renglones ?? []).map((x: any) => x.clave), ...(op.data?.SKU ?? [])])] as string[], [r.data, op.data]);
  if (r.error) return <Alert color="red">{textoError(r.error)}</Alert>;
  if (!r.data) return null;
  const { plan, explosion: e, puede } = r.data;
  const fechaMx = fecha(plan.fecha);
  const guardarPiezas = () => {
    const antes = Object.fromEntries(r.data.renglones.map((x: any) => [x.clave, String(Number(x.piezas))]));
    const renglones = Object.entries(piezas).filter(([k, v]) => v !== "" && v !== (antes[k] ?? (v === "0" ? "0" : ""))).map(([sku, v]) => ({ sku, piezas: v }));
    if (!renglones.length) return setAviso("Sin cambios.");
    accion.mutate({ ruta: "/api/planes", cuerpo: { fecha: fechaMx, turno: plan.turno ?? "", sucursal: plan.sucursal ?? "", renglones } });
  };
  const guardarExistencias = () =>
    accion.mutate({ ruta: `/api/planes/${id}/existencias`, metodo: "PUT", cuerpo: { existencias: Object.entries(exist).map(([articulo, x]) => ({ articulo, existencia: x.existencia || "0", en_transito: x.en_transito || "0" })) } });
  const celdaExist = (clave: string, campo: "existencia" | "en_transito", valor: string) =>
    puede.editar ? (
      <NumberInput size="xs" w={110} min={0} thousandSeparator="," allowNegative={false} value={exist[clave]?.[campo] ?? ""} placeholder="0"
        onChange={(v) => setExist((x) => ({ ...x, [clave]: { existencia: x[clave]?.existencia ?? "0", en_transito: x[clave]?.en_transito ?? "0", [campo]: v === "" ? "" : String(v) } }))} />
    ) : cantidad(valor);

  return (
    <Stack>
      <Anchor component={Link} to="/planes" size="sm">← Planes</Anchor>
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs"><Title order={2}>{plan.folio}</Title><Badge color={COLOR[plan.estatus]} size="lg">{plan.estatus.toLowerCase()}</Badge></Group>
          <Text c="dimmed" size="sm">
            Producción del {fechaMx} · {plan.turno ?? "todo el día"} · {plan.sucursal ?? "general"}
            {plan.aprobado_en && ` · aprobado ${fechaHora(plan.aprobado_en)} por ${plan.aprobado_por}`}
            {plan.cancelado_en && ` · cancelado ${fechaHora(plan.cancelado_en)} por ${plan.cancelado_por}: ${plan.motivo_cancelacion}`}
          </Text>
        </div>
        <Group>
          <Button variant="default" onClick={() => descargar(`/api/planes/${id}/exportar`, `explosion-${plan.folio}.xlsx`).catch((x) => setError(textoError(x)))}>Exportar a Excel</Button>
          {puede.aprobar && <Button color="green" disabled={!!e?.problemas.length} loading={accion.isPending} onClick={() => accion.mutate({ ruta: `/api/planes/${id}/aprobar` })}>Aprobar plan</Button>}
          {puede.requisicion && !r.data.requisiciones.some((q: any) => q.estatus !== "CANCELADA") && <Button loading={accion.isPending} onClick={() => accion.mutate({ ruta: `/api/planes/${id}/requisicion` })}>Generar requisición</Button>}
          {puede.cancelar && <Button color="red" variant="light" onClick={() => setCancelar("")}>Cancelar plan</Button>}
        </Group>
      </Group>
      {error && <Alert color="red" withCloseButton onClose={() => setError(null)}>{error}</Alert>}
      {aviso && <Alert color="green" withCloseButton onClose={() => setAviso(null)}>{aviso}</Alert>}
      {plan.estatus === "BORRADOR" && <Alert color="blue">El cálculo se actualiza con las recetas activas al {fechaMx} y con las existencias que captures. Al aprobar, el resultado queda fijo. Las existencias se pueden capturar aquí o tomar del inventario (materia prima, insumos y producción en proceso de la sucursal del plan, más lo que viene en tránsito).</Alert>}
      {e?.problemas.length > 0 && (
        <Alert color="red" title="Problemas: el plan no se puede aprobar">
          {e.problemas.map((p: any, i: number) => <Text key={i} size="sm">• {p.articulo}: {p.mensaje}</Text>)}
        </Alert>
      )}

      <Tabs defaultValue="productos" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="productos">Productos</Tabs.Tab>
          <Tabs.Tab value="masas">Masas e intermedios</Tabs.Tab>
          <Tabs.Tab value="mp">Materia prima</Tabs.Tab>
          <Tabs.Tab value="requisicion">Requisición</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="productos" pt="md">
          {puede.editar ? (
            <Stack>
              <CapturaPiezas skus={skus} valores={piezas} setValores={setPiezas} />
              <Group><Button loading={accion.isPending} onClick={guardarPiezas}>Guardar piezas</Button><Text size="xs" c="dimmed">Para quitar un producto escribe 0.</Text></Group>
            </Stack>
          ) : null}
          {e && (
            <Table withTableBorder striped fz="sm" mt="md">
              <Table.Thead><Table.Tr><Table.Th>Producto</Table.Th><Table.Th>Receta</Table.Th><Table.Th ta="right">Piezas buenas</Table.Th><Table.Th ta="right">Piezas a formar</Table.Th><Table.Th ta="right">Alcanzan con lo disponible</Table.Th><Table.Th>Limita</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {e.skus.map((s: any) => (
                  <Table.Tr key={s.clave}>
                    <Table.Td>{s.clave}<Text size="xs" c="dimmed">{s.nombre}</Text></Table.Td>
                    <Table.Td>{s.version ? `v${s.version}` : <Badge color="red">sin receta</Badge>}</Table.Td>
                    <Table.Td ta="right">{cantidad(s.piezas)}</Table.Td>
                    <Table.Td ta="right">{cantidad(s.piezas_formadas, 2)}</Table.Td>
                    <Table.Td ta="right">{s.completo ? <Badge color="green" variant="light">todas</Badge> : <Text c="red" fw={600} size="sm">{cantidad(s.alcanzan)}</Text>}</Table.Td>
                    <Table.Td>{s.limitantes.join(", ")}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {e?.skus.some((s: any) => !s.completo) && <Text size="xs" c="dimmed" mt="xs">“Alcanzan” es una estimación: si falta un material, cada producto que lo usa se reduce en la misma proporción (disponible ÷ requerido).</Text>}
        </Tabs.Panel>

        <Tabs.Panel value="masas" pt="md">
          {e && (
            <ScrollArea>
              <Table withTableBorder striped fz="sm">
                <Table.Thead><Table.Tr><Table.Th>Masa / intermedio</Table.Th><Table.Th ta="right">Se requiere</Table.Th><Table.Th>Existencia</Table.Th><Table.Th ta="right">A preparar</Table.Th><Table.Th ta="right">Rinde por lote</Table.Th><Table.Th ta="right">Lotes</Table.Th><Table.Th ta="right">Se produce</Table.Th><Table.Th ta="right">Sobrante esperado</Table.Th><Table.Th ta="right">Amasadas</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {e.intermedios.map((i: any) => (
                    <Table.Tr key={i.clave}>
                      <Table.Td>{i.clave} {i.sin_receta && <Badge color="red" size="xs">sin receta</Badge>}<Text size="xs" c="dimmed">{i.nombre}</Text><Origen o={i.origen} /></Table.Td>
                      <Table.Td ta="right">{cantidad(i.bruto, 3)} {i.unidad}</Table.Td>
                      <Table.Td>{celdaExist(i.clave, "existencia", i.existencia)}</Table.Td>
                      <Table.Td ta="right">{cantidad(i.a_preparar, 3)}</Table.Td>
                      <Table.Td ta="right">{cantidad(i.rendimiento, 3)}</Table.Td>
                      <Table.Td ta="right"><b>{cantidad(i.lotes, 4)}</b>{i.regla && <Text size="xs" c="dimmed">{i.regla === "COMPLETO" ? "lote completo" : "exacto"}</Text>}</Table.Td>
                      <Table.Td ta="right">{cantidad(i.producido, 3)}</Table.Td>
                      <Table.Td ta="right">{Number(i.sobrante) ? cantidad(i.sobrante, 3) : ""}</Table.Td>
                      <Table.Td ta="right">{cantidad(i.amasadas)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
          {puede.editar && (
            <Group mt="sm">
              <Button variant="light" loading={accion.isPending} onClick={guardarExistencias}>Guardar existencias y recalcular</Button>
              <Button variant="default" loading={accion.isPending} onClick={() => accion.mutate({ ruta: `/api/planes/${id}/existencias-inventario` })}>Tomar existencias del inventario</Button>
            </Group>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="mp" pt="md">
          {e && (
            <ScrollArea>
              <Table withTableBorder striped fz="sm">
                <Table.Thead><Table.Tr><Table.Th>Materia prima / empaque</Table.Th><Table.Th ta="right">Requerimiento bruto</Table.Th><Table.Th>Existencia</Table.Th><Table.Th>En tránsito</Table.Th><Table.Th ta="right">Requerimiento neto</Table.Th><Table.Th ta="right">En unidad de compra</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {e.materiales.map((m: any) => (
                    <Table.Tr key={m.clave}>
                      <Table.Td>{m.clave}<Text size="xs" c="dimmed">{m.nombre}</Text><Origen o={m.origen} /></Table.Td>
                      <Table.Td ta="right">{cantidad(m.bruto, 3)} {m.unidad}</Table.Td>
                      <Table.Td>{celdaExist(m.clave, "existencia", m.existencia)}</Table.Td>
                      <Table.Td>{celdaExist(m.clave, "en_transito", m.en_transito)}</Table.Td>
                      <Table.Td ta="right">{Number(m.neto) ? <Text c="red" fw={600} size="sm">{cantidad(m.neto, 3)} {m.unidad}</Text> : <Badge color="green" variant="light">cubierto</Badge>}</Table.Td>
                      <Table.Td ta="right">{m.neto_compra && Number(m.neto_compra) ? `${cantidad(m.neto_compra, 3)} ${m.unidad_compra}` : ""}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
          {puede.editar && (
            <Group mt="sm">
              <Button variant="light" loading={accion.isPending} onClick={guardarExistencias}>Guardar existencias y recalcular</Button>
              <Button variant="default" loading={accion.isPending} onClick={() => accion.mutate({ ruta: `/api/planes/${id}/existencias-inventario` })}>Tomar existencias del inventario</Button>
            </Group>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="requisicion" pt="md">
          {!r.data.requisiciones.length && <Text size="sm" c="dimmed">{plan.estatus === "APROBADO" ? "Sin requisición. Usa “Generar requisición” para pedir el requerimiento neto." : "Al aprobar el plan se puede generar la requisición de compra con el requerimiento neto."}</Text>}
          {r.data.requisiciones.map((q: any) => (
            <Stack key={q.id} gap="xs" mb="md">
              <Group gap="xs"><Text fw={600}>{q.folio}</Text><Badge>{q.estatus.toLowerCase()}</Badge><Text size="sm" c="dimmed">para el {fecha(q.requerido_para)} · {q.solicitante}</Text></Group>
              <Table withTableBorder fz="sm" maw={700}>
                <Table.Thead><Table.Tr><Table.Th>Artículo</Table.Th><Table.Th ta="right">Cantidad</Table.Th><Table.Th ta="right">En unidad de compra</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{q.renglones.map((x: any) => <Table.Tr key={x.clave}><Table.Td>{x.clave}<Text size="xs" c="dimmed">{x.nombre}</Text></Table.Td><Table.Td ta="right">{cantidad(x.cantidad)} {x.unidad}</Table.Td><Table.Td ta="right">{x.cantidad_compra ? `${cantidad(x.cantidad_compra)} ${x.unidad_compra}` : ""}</Table.Td></Table.Tr>)}</Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed">La requisición queda en borrador: se envía, autoriza y convierte en orden de compra en el módulo de compras (Fase 4).</Text>
            </Stack>
          ))}
        </Tabs.Panel>
      </Tabs>

      <Modal opened={cancelar !== null} onClose={() => setCancelar(null)} title={`Cancelar ${plan.folio}`}>
        <Stack>
          <Textarea label="Motivo" withAsterisk value={cancelar ?? ""} onChange={(x) => setCancelar(x.currentTarget.value)} />
          <Group justify="flex-end"><Button color="red" disabled={!cancelar?.trim()} loading={accion.isPending} onClick={() => accion.mutate({ ruta: `/api/planes/${id}/cancelar`, cuerpo: { motivo: cancelar } })}>Cancelar plan</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function Planes() {
  const { id } = useParams();
  return id ? <Detalle key={id} id={id} /> : <Lista />;
}
