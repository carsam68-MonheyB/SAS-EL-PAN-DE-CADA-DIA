// Cargas masivas por layout: subir → validar (simulación, no guarda nada) →
// revisar errores → confirmar. Historial, autorizaciones y archivos originales.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, FileInput, Group, List, Modal, ScrollArea, SegmentedControl, Select, Stack, Table, Tabs, Text, Textarea, Title } from "@mantine/core";
import { descargar, GET, POST, textoError } from "../api";
import { fechaHora, numero } from "../formato";
import { MenuDescarga, useLayouts, type LayoutInfo } from "./Catalogos";

interface Mensaje {
  renglon: number;
  campo: string;
  severidad: "error" | "advertencia";
  mensaje: string;
}

const ESTATUS: Record<string, { texto: string; color: string }> = {
  validada: { texto: "Validada, sin confirmar", color: "blue" },
  con_errores: { texto: "Con errores (no se aplicó)", color: "red" },
  pendiente_autorizacion: { texto: "Pendiente de autorización", color: "grape" },
  aplicada: { texto: "Aplicada", color: "green" },
  rechazada: { texto: "Rechazada", color: "gray" },
};

const MODOS: Record<string, string> = { alta: "Alta", actualizacion: "Actualización", ambos: "Alta y actualización" };

function leerBase64(archivo: File): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => mal(new Error("No se pudo leer el archivo."));
    r.readAsDataURL(archivo);
  });
}

function Mensajes({ mensajes }: { mensajes: Mensaje[] }) {
  if (!mensajes.length) return null;
  const mostrados = mensajes.slice(0, 500);
  return (
    <ScrollArea.Autosize mah={420}>
      <Table striped withTableBorder fz="sm">
        <Table.Thead>
          <Table.Tr><Table.Th>Renglón</Table.Th><Table.Th>Campo</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Mensaje</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {mostrados.map((m, i) => (
            <Table.Tr key={i}>
              <Table.Td>{m.renglon === 1 ? "Encabezado" : m.renglon}</Table.Td>
              <Table.Td>{m.campo}</Table.Td>
              <Table.Td><Badge color={m.severidad === "error" ? "red" : "yellow"} variant="light">{m.severidad === "error" ? "Error" : "Aviso"}</Badge></Table.Td>
              <Table.Td>{m.mensaje}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {mensajes.length > 500 && <Text size="sm" c="dimmed">Se muestran 500 de {numero(mensajes.length, 0)} mensajes. Descarga el reporte para verlos todos.</Text>}
    </ScrollArea.Autosize>
  );
}

function Resumen({ r }: { r: any }) {
  return (
    <Group gap="xs">
      <Badge variant="outline">{numero(r.renglones, 0)} renglones</Badge>
      <Badge color="green" variant="light">{numero(r.altas, 0)} altas</Badge>
      <Badge color="blue" variant="light">{numero(r.actualizaciones, 0)} actualizaciones</Badge>
      {r.sin_cambios !== undefined && <Badge color="gray" variant="light">{numero(r.sin_cambios, 0)} sin cambios</Badge>}
      <Badge color="red" variant={r.errores ? "filled" : "light"}>{numero(r.errores, 0)} errores</Badge>
      <Badge color="yellow" variant="light">{numero(r.advertencias, 0)} avisos</Badge>
    </Group>
  );
}

function NuevaCarga({ layouts }: { layouts: LayoutInfo[] }) {
  const [params] = useSearchParams();
  const importables = layouts.filter((l) => l.puede.importar);
  const [clave, setClave] = useState<string | null>(params.get("layout") && importables.some((l) => l.clave === params.get("layout")) ? params.get("layout") : null);
  const [modo, setModo] = useState("alta");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [resultado, setResultado] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const layout = importables.find((l) => l.clave === clave);
  const modosPermitidos = ["alta", "actualizacion", "ambos"].filter((m) => (m === "alta" ? layout?.puede.crear : m === "actualizacion" ? layout?.puede.editar : layout?.puede.crear && layout?.puede.editar));

  const validar = useMutation({
    mutationFn: async () => {
      if (!archivo || !clave) throw new Error("Elige el catálogo y el archivo.");
      return POST("/api/cargas", { layout: clave, modo, nombre_archivo: archivo.name, contenido: await leerBase64(archivo) });
    },
    onSuccess: (r) => {
      setResultado(r);
      setError(null);
      qc.invalidateQueries({ queryKey: ["cargas"] });
    },
    onError: (e) => {
      setResultado(null);
      setError(e instanceof Error && !("estado" in e) ? e.message : textoError(e));
    },
  });
  const aplicar = useMutation({
    mutationFn: () => POST(`/api/cargas/${resultado.id}/aplicar`),
    onSuccess: (r) => {
      setResultado({ ...resultado, ...r, confirmada: true });
      qc.invalidateQueries();
    },
    onError: (e) => setError(textoError(e)),
  });

  if (!importables.length) return <Alert>Tu puesto no tiene permiso para cargar layouts. Puedes consultar el historial.</Alert>;
  return (
    <Stack>
      <Card withBorder>
        <Stack>
          <Group align="end">
            <Select
              label="Catálogo"
              placeholder="Elige el layout"
              w={360}
              searchable
              data={importables.map((l) => ({ value: l.clave, label: `${l.secuencia}. ${l.nombre}` }))}
              value={clave}
              onChange={(v) => {
                setClave(v);
                setResultado(null);
              }}
            />
            {layout && (
              <>
                <MenuDescarga texto="Descargar plantilla" ruta={`/api/layouts/${layout.clave}/plantilla`} archivo={`${layout.clave}-plantilla`} variante="default" />
                <Button variant="subtle" onClick={() => descargar(`/api/layouts/${layout.clave}/instrucciones`, `${layout.clave}-instrucciones.txt`)}>Instrucciones (.txt)</Button>
              </>
            )}
          </Group>
          {layout && (
            <Alert color="orange" variant="light" title={layout.nombre}>
              <List size="sm" spacing={2}>
                {layout.notas.slice(1).map((n, i) => <List.Item key={i}>{n}</List.Item>)}
              </List>
            </Alert>
          )}
          <Group align="end">
            <div>
              <Text size="sm" fw={500} mb={4}>Modo</Text>
              <SegmentedControl value={modo} onChange={(v) => { setModo(v); setResultado(null); }} data={modosPermitidos.map((m) => ({ value: m, label: MODOS[m]! }))} disabled={!layout} />
            </div>
            <FileInput label="Archivo (.txt, .csv o .xlsx)" placeholder="Elegir archivo" accept=".txt,.csv,.tsv,.xlsx" w={320} value={archivo} onChange={(f) => { setArchivo(f); setResultado(null); }} clearable />
            <Button disabled={!layout || !archivo || !modosPermitidos.includes(modo)} loading={validar.isPending} onClick={() => validar.mutate()}>Validar (no guarda nada)</Button>
          </Group>
          {error && <Alert color="red">{error}</Alert>}
        </Stack>
      </Card>

      {resultado && (
        <Card withBorder>
          <Stack>
            <Group justify="space-between">
              <Title order={4}>{resultado.confirmada ? "Resultado" : "Resultado de la validación"}</Title>
              {resultado.estatus && <Badge color={ESTATUS[resultado.estatus]?.color} size="lg">{ESTATUS[resultado.estatus]?.texto}</Badge>}
            </Group>
            <Resumen r={resultado} />
            {!resultado.confirmada && resultado.errores > 0 && (
              <Alert color="red">
                Hay {numero(resultado.errores, 0)} error(es): <b>no se guardará ningún renglón</b>. Descarga el reporte, corrige lo que dice la columna ERROR y vuelve a subir el archivo completo.
              </Alert>
            )}
            {!resultado.confirmada && resultado.errores === 0 && (
              <Alert color="green">
                Sin errores. Al confirmar se guardan los {numero(resultado.altas + resultado.actualizaciones, 0)} cambios en una sola operación.
                {resultado.requiere_autorizacion && " Esta carga requiere autorización: al confirmar quedará pendiente hasta que la autorice otra persona."}
              </Alert>
            )}
            <Group>
              {(resultado.errores > 0 || resultado.advertencias > 0) && <MenuDescarga texto="Descargar reporte de errores" ruta={`/api/cargas/${resultado.id}/errores`} archivo={`${clave}-errores`} />}
              {!resultado.confirmada && resultado.errores === 0 && (
                <Button color="green" loading={aplicar.isPending} onClick={() => aplicar.mutate()}>Confirmar y aplicar</Button>
              )}
            </Group>
            <Mensajes mensajes={resultado.detalle ?? []} />
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

function Historial({ soloPendientes }: { soloPendientes?: boolean }) {
  const qc = useQueryClient();
  const cargas = useQuery({ queryKey: ["cargas", soloPendientes], queryFn: () => GET(`/api/cargas${soloPendientes ? "?estatus=pendiente_autorizacion" : ""}`) });
  const [detalle, setDetalle] = useState<string | null>(null);
  const [rechazo, setRechazo] = useState<{ id: string; motivo: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const info = useQuery({ queryKey: ["carga", detalle], queryFn: () => GET(`/api/cargas/${detalle}`), enabled: !!detalle });
  const accion = useMutation({
    mutationFn: ({ id, que, motivo }: { id: string; que: string; motivo?: string }) => POST(`/api/cargas/${id}/${que}`, motivo ? { motivo } : {}),
    onSuccess: () => {
      setRechazo(null);
      setError(null);
      qc.invalidateQueries();
    },
    onError: (e) => setError(textoError(e)),
  });

  if (cargas.error) return <Alert color="red">{textoError(cargas.error)}</Alert>;
  const lista: any[] = cargas.data?.cargas ?? [];
  return (
    <Stack>
      {error && <Alert color="red" withCloseButton onClose={() => setError(null)}>{error}</Alert>}
      {!lista.length && <Text c="dimmed">{soloPendientes ? "No hay cargas pendientes de autorización." : "Aún no hay cargas."}</Text>}
      {!!lista.length && (
        <ScrollArea>
          <Table striped withTableBorder fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th><Table.Th>Catálogo</Table.Th><Table.Th>Archivo</Table.Th><Table.Th>Subió</Table.Th><Table.Th>Modo</Table.Th>
                <Table.Th>Renglones</Table.Th><Table.Th>Altas</Table.Th><Table.Th>Act.</Table.Th><Table.Th>Errores</Table.Th><Table.Th>Estatus</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lista.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{fechaHora(c.creado_en)}</Table.Td>
                  <Table.Td>{c.layout_nombre}</Table.Td>
                  <Table.Td>{c.formato === "pantalla" ? <i>Captura en pantalla</i> : c.nombre_archivo}</Table.Td>
                  <Table.Td>{c.usuario}</Table.Td>
                  <Table.Td>{MODOS[c.modo]}</Table.Td>
                  <Table.Td>{numero(c.renglones, 0)}</Table.Td>
                  <Table.Td>{numero(c.altas, 0)}</Table.Td>
                  <Table.Td>{numero(c.actualizaciones, 0)}</Table.Td>
                  <Table.Td>{numero(c.errores, 0)}</Table.Td>
                  <Table.Td>
                    <Badge color={ESTATUS[c.estatus]?.color} variant="light" h="auto" py={2} styles={{ label: { whiteSpace: "normal", overflow: "visible" } }}>{ESTATUS[c.estatus]?.texto}</Badge>
                    {c.autorizado_por && <Text size="xs" c="dimmed">{c.estatus === "rechazada" ? "Rechazó" : "Autorizó"}: {c.autorizado_por}</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Button size="compact-xs" variant="default" onClick={() => setDetalle(c.id)}>Ver</Button>
                      {c.es_mia && c.estatus === "validada" && <Button size="compact-xs" color="green" loading={accion.isPending} onClick={() => accion.mutate({ id: c.id, que: "aplicar" })}>Confirmar</Button>}
                      {c.puede_autorizar && (
                        <>
                          <Button size="compact-xs" color="green" loading={accion.isPending} onClick={() => window.confirm("¿Autorizar y aplicar esta carga?") && accion.mutate({ id: c.id, que: "autorizar" })}>Autorizar</Button>
                          <Button size="compact-xs" color="red" variant="light" onClick={() => setRechazo({ id: c.id, motivo: "" })}>Rechazar</Button>
                        </>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      <Modal opened={!!detalle} onClose={() => setDetalle(null)} title="Detalle de la carga" size="xl">
        {info.data && (
          <Stack>
            <Text size="sm"><b>{info.data.layout_nombre}</b> · {MODOS[info.data.modo]} · {info.data.formato === "pantalla" ? "Captura en pantalla" : info.data.nombre_archivo}{info.data.codificacion ? ` (${info.data.codificacion})` : ""}</Text>
            <Resumen r={info.data} />
            {info.data.motivo_rechazo && <Alert color="gray" title="Motivo del rechazo">{info.data.motivo_rechazo}</Alert>}
            <Group>
              <Button variant="default" onClick={() => descargar(`/api/cargas/${detalle}/archivo`, info.data.formato === "pantalla" ? "captura.txt" : info.data.nombre_archivo).catch((e) => setError(textoError(e)))}>Archivo original</Button>
              {(info.data.errores > 0 || info.data.advertencias > 0) && <MenuDescarga texto="Reporte de errores" ruta={`/api/cargas/${detalle}/errores`} archivo={`${info.data.layout}-errores`} />}
            </Group>
            <Mensajes mensajes={info.data.detalle} />
          </Stack>
        )}
      </Modal>

      <Modal opened={!!rechazo} onClose={() => setRechazo(null)} title="Rechazar carga">
        <Stack>
          <Textarea label="Motivo" required value={rechazo?.motivo ?? ""} onChange={(e) => { const v = e.currentTarget.value; setRechazo((r) => r && { ...r, motivo: v }); }} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRechazo(null)}>Cancelar</Button>
            <Button color="red" loading={accion.isPending} onClick={() => rechazo && accion.mutate({ id: rechazo.id, que: "rechazar", motivo: rechazo.motivo })}>Rechazar</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function Cargas() {
  const layouts = useLayouts();
  const autoriza = layouts.data?.some((l) => l.puede.autorizar);
  if (layouts.error) return <Alert color="red">{textoError(layouts.error)}</Alert>;
  if (!layouts.data) return null;
  return (
    <Stack>
      <div>
        <Title order={2}>Cargas masivas por layout</Title>
        <Text c="dimmed" size="sm">Descarga la plantilla, llénala en Excel o en texto, súbela y revisa la validación. Nada se guarda hasta que confirmas, y si hay un solo error no se guarda ningún renglón.</Text>
      </div>
      <Tabs defaultValue={autoriza && !layouts.data.some((l) => l.puede.importar) ? "pendientes" : "nueva"}>
        <Tabs.List>
          <Tabs.Tab value="nueva">Nueva carga</Tabs.Tab>
          {autoriza && <Tabs.Tab value="pendientes">Pendientes de autorización</Tabs.Tab>}
          <Tabs.Tab value="historial">Historial</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="nueva" pt="md"><NuevaCarga layouts={layouts.data} /></Tabs.Panel>
        {autoriza && <Tabs.Panel value="pendientes" pt="md"><Historial soloPendientes /></Tabs.Panel>}
        <Tabs.Panel value="historial" pt="md"><Historial /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
