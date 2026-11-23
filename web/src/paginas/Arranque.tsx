// Arranque y respaldos (Fase 9): lista de verificación antes de operar con datos
// reales, y respaldos externos (historial, respaldo manual y descarga cifrada).
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Group, SimpleGrid, Stack, Table, Tabs, Text, Title } from "@mantine/core";
import { descargar, GET, POST, textoError } from "../api";
import { fecha, fechaHora, numero } from "../formato";
import { useSesion } from "../sesion";

const COLOR: Record<string, string> = { OK: "green", AVISO: "orange", FALLA: "red", COMPLETO: "green", PENDIENTE: "gray", EN_PROCESO: "blue", ERROR: "red" };
const ICONO: Record<string, string> = { OK: "✔", AVISO: "!", FALLA: "✖" };
const TEXTO: Record<string, string> = { OK: "Bien", AVISO: "Revisar", FALLA: "Falta", COMPLETO: "Completo", PENDIENTE: "Pendiente", EN_PROCESO: "En proceso", ERROR: "Error" };
const TIPO: Record<string, string> = { MENSUAL: "Mensual", CIERRE: "Cierre contable", MANUAL: "Manual", DESCARGA: "Descarga cifrada" };
const tam = (b: number | null) => (b === null ? "—" : b > 1_048_576 ? `${numero(b / 1_048_576, 1)} MB` : `${numero(b / 1024, 0)} KB`);

function Revision() {
  const { puede } = useSesion();
  const r = useQuery({ queryKey: ["arranque"], queryFn: () => GET("/api/arranque") });
  const [err, setErr] = useState<string | null>(null);
  if (r.error) return <Alert color="red">{textoError(r.error)}</Alert>;
  if (!r.data) return <Text c="dimmed">Revisando…</Text>;
  const grupos = [...new Set(r.data.revisiones.map((x: any) => x.grupo as string))] as string[];
  return (
    <Stack>
      <Text size="sm" c="dimmed">Antes de operar con datos reales todo debe quedar en "Bien". Los secretos nunca se muestran: solo si están definidos.</Text>
      <Group>
        {(["FALLA", "AVISO", "OK"] as const).map((k) => <Badge key={k} size="lg" color={COLOR[k]} variant="light">{ICONO[k]} {TEXTO[k]}: {r.data.resumen[k]}</Badge>)}
        <Button variant="default" size="xs" onClick={() => r.refetch()} loading={r.isFetching}>Volver a revisar</Button>
        {puede("seguridad.configuracion:editar", "seguridad.usuarios:exportar") && <Button variant="default" size="xs" onClick={() => descargar("/api/arranque?formato=xlsx", "revision-arranque.xlsx").then(() => setErr(null)).catch((e) => setErr(textoError(e)))}>Exportar a Excel</Button>}
      </Group>
      {err && <Alert color="red">{err}</Alert>}
      {grupos.map((g) => (
        <Card key={g} withBorder p="sm">
          <Text fw={600} mb={4}>{g}</Text>
          <Table fz="sm" verticalSpacing={6}>
            <Table.Tbody>{r.data.revisiones.filter((x: any) => x.grupo === g).map((x: any) => (
              <Table.Tr key={x.clave}>
                <Table.Td w={110}><Badge color={COLOR[x.estado]} variant="light">{ICONO[x.estado]} {TEXTO[x.estado]}</Badge></Table.Td>
                <Table.Td w={280} fw={500}>{x.titulo}</Table.Td>
                <Table.Td>{x.detalle}{x.como && x.estado !== "OK" && <Text size="xs" c="dimmed">{x.como}</Text>}</Table.Td>
              </Table.Tr>
            ))}</Table.Tbody>
          </Table>
        </Card>
      ))}
    </Stack>
  );
}

function Respaldos() {
  const qc = useQueryClient();
  const r = useQuery({ queryKey: ["respaldos"], queryFn: () => GET("/api/respaldos") });
  const ahora = useMutation({ mutationFn: () => POST("/api/respaldos/ahora"), onSuccess: () => { qc.invalidateQueries({ queryKey: ["respaldos"] }); qc.invalidateQueries({ queryKey: ["arranque"] }); } });
  const [bajando, setBajando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (r.error) return <Alert color="red">{textoError(r.error)}</Alert>;
  const d = r.data;
  if (!d) return <Text c="dimmed">Cargando…</Text>;
  const k = d.configuracion;
  return (
    <Stack>
      <Text size="sm" c="dimmed">Cada mes (día 1) y al cerrar cada mes contable, la base completa se cifra y se copia a un almacenamiento fuera de Netlify donde nadie puede borrarla durante el plazo de conservación. Los XML de facturas se archivan por RFC, año y mes.</Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card withBorder p="sm"><Text size="xs" c="dimmed">Llave de cifrado (RESPALDO_LLAVE)</Text><Badge color={k.llave ? "green" : "red"} variant="light">{k.llave ? "Definida" : k.llave_error ?? "Falta"}</Badge></Card>
        <Card withBorder p="sm"><Text size="xs" c="dimmed">Almacenamiento externo</Text>{k.almacen ? <Text size="sm">{k.endpoint}<br />cubeta <b>{k.bucket}</b></Text> : <Badge color="red" variant="light">Sin configurar (P06)</Badge>}</Card>
        <Card withBorder p="sm"><Text size="xs" c="dimmed">XML de facturas</Text><Text size="sm">{d.xml_archivados} archivados · {d.xml_por_archivar} por archivar</Text></Card>
      </SimpleGrid>
      {d.puede_respaldar && (
        <Group>
          <Button loading={ahora.isPending} disabled={!k.llave || !k.almacen} onClick={() => ahora.mutate()}>Respaldar ahora</Button>
          <Button variant="default" loading={bajando} disabled={!k.llave} onClick={() => { setBajando(true); descargar("/api/respaldos/descargar", `erp-respaldo-${new Date().toISOString().slice(0, 10)}.erpresp`).then(() => { setErr(null); r.refetch(); }).catch((e) => setErr(textoError(e))).finally(() => setBajando(false)); }}>Descargar respaldo cifrado</Button>
          <Text size="xs" c="dimmed" maw={420}>El archivo descargado va cifrado: solo se abre con RESPALDO_LLAVE. Guárdalo en un lugar seguro.</Text>
        </Group>
      )}
      {ahora.data && <Alert color={ahora.data.estatus === "COMPLETO" ? "green" : "red"}>{ahora.data.estatus === "COMPLETO" ? `Respaldo completo: ${tam(ahora.data.bytes)}, ${numero(ahora.data.filas, 0)} registros, conservado hasta ${fecha(ahora.data.retener_hasta)}.` : `No se hizo el respaldo: ${ahora.data.error}`}</Alert>}
      {(ahora.error || err) && <Alert color="red">{err ?? textoError(ahora.error)}</Alert>}
      <Table striped withTableBorder fz="sm">
        <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Estatus</Table.Th><Table.Th>Tamaño</Table.Th><Table.Th>Registros</Table.Th><Table.Th>Se conserva hasta</Table.Th><Table.Th>Detalle</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {d.respaldos.map((x: any) => (
            <Table.Tr key={x.id}>
              <Table.Td>{fechaHora(x.terminado_en ?? x.creado_en)}</Table.Td><Table.Td>{TIPO[x.tipo] ?? x.tipo}{x.solicito ? <Text size="xs" c="dimmed">{x.solicito}</Text> : null}</Table.Td>
              <Table.Td><Badge color={COLOR[x.estatus]} variant="light">{TEXTO[x.estatus]}</Badge></Table.Td><Table.Td>{tam(x.bytes)}</Table.Td><Table.Td>{x.filas === null ? "—" : numero(x.filas, 0)}</Table.Td>
              <Table.Td>{x.retener_hasta ? fecha(x.retener_hasta) : "—"}</Table.Td>
              <Table.Td><Text size="xs">{x.error ?? x.motivo}</Text>{x.destino && <Text size="xs" c="dimmed">{x.destino}</Text>}</Table.Td>
            </Table.Tr>
          ))}
          {!d.respaldos.length && <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed">Todavía no hay respaldos.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

export function Arranque() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "respaldos" ? "respaldos" : "revision";
  return (
    <Stack>
      <Title order={2}>Arranque y respaldos</Title>
      <Tabs value={tab} onChange={(v) => setParams(v ? { tab: v } : {})} keepMounted={false}>
        <Tabs.List><Tabs.Tab value="revision">Revisión de arranque</Tabs.Tab><Tabs.Tab value="respaldos">Respaldos</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="revision" pt="md"><Revision /></Tabs.Panel>
        <Tabs.Panel value="respaldos" pt="md"><Respaldos /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
