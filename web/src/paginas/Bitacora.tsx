import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Code, Group, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { descargar, GET, textoError } from "../api";
import { fechaHora, fechaIso } from "../formato";
import { useSesion } from "../sesion";

function Filtros({ alBuscar, conTabla }: { alBuscar: (q: string) => void; conTabla?: boolean }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [usuario, setUsuario] = useState("");
  const [tabla, setTabla] = useState("");
  const [error, setError] = useState<string | null>(null);
  const aplicar = () => {
    const p = new URLSearchParams();
    for (const [k, v] of [["desde", desde], ["hasta", hasta]] as const) {
      if (!v) continue;
      const iso = fechaIso(v);
      if (!iso) return setError(`La fecha "${v}" no es válida (usa DD/MM/AAAA).`);
      p.set(k, iso);
    }
    if (usuario) p.set("usuario", usuario.trim().toLowerCase());
    if (conTabla && tabla) p.set("tabla", tabla.trim());
    setError(null);
    alBuscar(p.toString());
  };
  return (
    <Stack gap="xs">
      <Group align="end">
        <TextInput label="Desde" placeholder="DD/MM/AAAA" w={130} value={desde} onChange={(e) => setDesde(e.currentTarget.value)} />
        <TextInput label="Hasta" placeholder="DD/MM/AAAA" w={130} value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} />
        <TextInput label="Usuario" w={160} value={usuario} onChange={(e) => setUsuario(e.currentTarget.value)} />
        {conTabla && <TextInput label="Tabla" w={160} value={tabla} onChange={(e) => setTabla(e.currentTarget.value)} />}
        <Button onClick={aplicar}>Buscar</Button>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
    </Stack>
  );
}

function Cambio({ antes, despues }: { antes: any; despues: any }) {
  const claves = [...new Set([...Object.keys(antes ?? {}), ...Object.keys(despues ?? {})])].filter((k) => !["actualizado_en", "actualizado_por"].includes(k));
  const distintos = antes && despues ? claves.filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k])) : claves;
  return (
    <Stack gap={0}>
      {distintos.slice(0, 8).map((k) => (
        <Text key={k} size="xs"><b>{k}:</b> {antes ? <Code>{JSON.stringify(antes[k])}</Code> : null}{antes && despues ? " → " : ""}{despues ? <Code>{JSON.stringify(despues[k])}</Code> : null}</Text>
      ))}
    </Stack>
  );
}

export function Bitacora() {
  const { puede } = useSesion();
  const [qa, setQa] = useState("");
  const [qx, setQx] = useState("");
  const [error, setError] = useState<string | null>(null);
  const auditoria = useQuery({ queryKey: ["auditoria", qa], queryFn: () => GET(`/api/bitacora/auditoria?${qa}`) });
  const accesos = useQuery({ queryKey: ["accesos", qx], queryFn: () => GET(`/api/bitacora/accesos?${qx}`) });
  const verificar = useMutation({ mutationFn: () => GET("/api/bitacora/verificar") });
  const exportar = (tipo: string, q: string) => descargar(`/api/bitacora/${tipo}?${q}&formato=xlsx`, `bitacora-${tipo}.xlsx`).catch((e) => setError(textoError(e)));
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Bitácora</Title>
        <Button variant="light" loading={verificar.isPending} onClick={() => verificar.mutate()}>Verificar integridad</Button>
      </Group>
      <Text size="sm" c="dimmed">Nadie, ni el administrador, puede editar ni borrar la bitácora. Cada registro está encadenado al anterior: cualquier alteración se detecta.</Text>
      {verificar.data && (verificar.data.integra
        ? <Alert color="green">Bitácora íntegra: {verificar.data.registros} registros verificados.</Alert>
        : <Alert color="red">¡Alerta! El registro {verificar.data.primer_registro_alterado} fue alterado fuera del sistema.</Alert>)}
      {error && <Alert color="red">{error}</Alert>}
      <Tabs defaultValue="auditoria">
        <Tabs.List>
          <Tabs.Tab value="auditoria">Cambios (auditoría)</Tabs.Tab>
          <Tabs.Tab value="accesos">Accesos</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="auditoria" pt="md">
          <Stack>
            <Group justify="space-between" align="end"><Filtros conTabla alBuscar={setQa} />{puede("seguridad.bitacora:exportar") && <Button variant="light" onClick={() => exportar("auditoria", qa)}>Exportar a Excel</Button>}</Group>
            <Table.ScrollContainer minWidth={900}>
              <Table striped fz="xs">
                <Table.Thead><Table.Tr><Table.Th>Folio</Table.Th><Table.Th>Fecha</Table.Th><Table.Th>Usuario</Table.Th><Table.Th>Tabla</Table.Th><Table.Th>Operación</Table.Th><Table.Th>Cambio (antes → después)</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {(auditoria.data?.registros ?? []).map((r: any) => (
                    <Table.Tr key={r.id}><Table.Td>{r.id}</Table.Td><Table.Td>{fechaHora(r.fecha)}</Table.Td><Table.Td>{r.usuario ?? "sistema"}</Table.Td><Table.Td>{r.tabla}</Table.Td><Table.Td>{r.operacion}</Table.Td><Table.Td><Cambio antes={r.antes} despues={r.despues} /></Table.Td></Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="accesos" pt="md">
          <Stack>
            <Group justify="space-between" align="end"><Filtros alBuscar={setQx} />{puede("seguridad.bitacora:exportar") && <Button variant="light" onClick={() => exportar("accesos", qx)}>Exportar a Excel</Button>}</Group>
            <Table.ScrollContainer minWidth={900}>
              <Table striped fz="xs">
                <Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Usuario</Table.Th><Table.Th>Evento</Table.Th><Table.Th>Resultado</Table.Th><Table.Th>Desde</Table.Th><Table.Th>Detalle</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {(accesos.data?.registros ?? []).map((r: any) => (
                    <Table.Tr key={r.id}><Table.Td>{fechaHora(r.fecha)}</Table.Td><Table.Td>{r.usuario}</Table.Td><Table.Td>{r.evento}</Table.Td><Table.Td c={r.exito ? "green" : "red"}>{r.exito ? "Éxito" : "Fallido"}</Table.Td><Table.Td>{r.ip}</Table.Td><Table.Td>{r.detalle}</Table.Td></Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
