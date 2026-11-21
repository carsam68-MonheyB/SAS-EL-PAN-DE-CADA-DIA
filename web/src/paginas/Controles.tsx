import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Group, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { GET, PUT, textoError } from "../api";
import { numero } from "../formato";
import { useSesion } from "../sesion";

function FilaLimite({ l, editable }: { l: any; editable: boolean }) {
  const qc = useQueryClient();
  const [valor, setValor] = useState(l.monto_hasta === null ? "" : numero(l.monto_hasta));
  const m = useMutation({
    mutationFn: () => PUT(`/api/limites/${l.id}`, { monto_hasta: valor.trim() === "" ? null : valor.replaceAll(",", "") }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["limites"] }),
  });
  return (
    <Table.Tr>
      <Table.Td>{l.operacion_nombre}</Table.Td>
      <Table.Td>{l.rol} · {l.rol_nombre}</Table.Td>
      <Table.Td>
        {editable ? (
          <Group gap="xs" wrap="nowrap">
            <TextInput size="xs" w={140} placeholder="sin límite" value={valor} onChange={(e) => setValor(e.currentTarget.value)} />
            <Button size="xs" variant="light" loading={m.isPending} onClick={() => m.mutate()}>Guardar</Button>
          </Group>
        ) : l.monto_hasta === null ? "Sin límite" : `$${numero(l.monto_hasta)}`}
        {m.error && <Text size="xs" c="red">{textoError(m.error)}</Text>}
      </Table.Td>
      <Table.Td>{l.provisional && <Badge color="yellow">provisional</Badge>}</Table.Td>
    </Table.Tr>
  );
}

export function Controles() {
  const qc = useQueryClient();
  const { puede } = useSesion();
  const editable = puede("configuracion.parametros:editar");
  const inc = useQuery({ queryKey: ["incompatibilidades"], queryFn: () => GET("/api/incompatibilidades") });
  const lim = useQuery({ queryKey: ["limites"], queryFn: () => GET("/api/limites") });
  const activar = useMutation({
    mutationFn: (i: any) => PUT(`/api/incompatibilidades/${i.id}`, { nivel: i.nivel, patron_a: i.patron_a, patron_b: i.patron_b, descripcion: i.descripcion, activa: !i.activa }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incompatibilidades"] }),
  });
  return (
    <Stack>
      <Title order={2}>Segregación de funciones</Title>
      <Text size="sm" c="dimmed">
        <b>Por asignación:</b> el sistema no deja asignar a una persona roles que junten ambos lados. <b>Por documento:</b> la misma persona no puede hacer ambas cosas sobre el mismo documento (lo valida cada módulo al operar).
      </Text>
      {activar.error && <Alert color="red">{textoError(activar.error)}</Alert>}
      <Table.ScrollContainer minWidth={800}>
        <Table striped>
          <Table.Thead><Table.Tr><Table.Th>Regla</Table.Th><Table.Th>Nivel</Table.Th><Table.Th>Permisos A</Table.Th><Table.Th>Permisos B</Table.Th><Table.Th>Activa</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {(inc.data?.incompatibilidades ?? []).map((i: any) => (
              <Table.Tr key={i.id}>
                <Table.Td>{i.descripcion}</Table.Td>
                <Table.Td><Badge variant="light" color={i.nivel === "asignacion" ? "orange" : "blue"}>{i.nivel === "asignacion" ? "asignación" : "documento"}</Badge></Table.Td>
                <Table.Td><Text size="xs" ff="monospace">{i.patron_a}</Text></Table.Td>
                <Table.Td><Text size="xs" ff="monospace">{i.patron_b}</Text></Table.Td>
                <Table.Td><Switch checked={i.activa} disabled={!editable} onChange={() => activar.mutate(i)} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Title order={2} mt="lg">Límites por monto para autorizar</Title>
      <Text size="sm" c="dimmed">Hasta el monto indicado autoriza ese puesto; arriba, el siguiente. Montos en pesos, el punto es el decimal (ej. 10,000.00).</Text>
      <Table striped>
        <Table.Thead><Table.Tr><Table.Th>Operación</Table.Th><Table.Th>Autoriza</Table.Th><Table.Th>Hasta</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>{(lim.data?.limites ?? []).map((l: any) => <FilaLimite key={l.id} l={l} editable={editable} />)}</Table.Tbody>
      </Table>
    </Stack>
  );
}
