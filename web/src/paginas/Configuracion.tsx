import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Group, Progress, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { GET, PUT, textoError } from "../api";
import { fecha, numero } from "../formato";

function Fila({ c }: { c: any }) {
  const qc = useQueryClient();
  const [valor, setValor] = useState(c.valor);
  const m = useMutation({ mutationFn: () => PUT(`/api/configuracion/${c.clave}`, { valor }), onSuccess: () => qc.invalidateQueries({ queryKey: ["configuracion"] }) });
  return (
    <Table.Tr>
      <Table.Td>{c.descripcion}<Text size="xs" c="dimmed" ff="monospace">{c.clave}</Text></Table.Td>
      <Table.Td>
        {c.editable ? (
          <Group gap="xs" wrap="nowrap">
            {c.opciones?.length ? (
              <Select size="xs" w={180} data={c.opciones} value={valor} allowDeselect={false} onChange={(v) => v && setValor(v)} />
            ) : (
              <TextInput size="xs" w={180} value={valor} onChange={(e) => setValor(e.currentTarget.value)} />
            )}
            <Button size="xs" variant="light" disabled={valor === c.valor} loading={m.isPending} onClick={() => m.mutate()}>Guardar</Button>
          </Group>
        ) : c.valor}
        {m.error && <Text size="xs" c="red">{textoError(m.error)}</Text>}
      </Table.Td>
      <Table.Td>{c.opciones?.length ? c.opciones.join(" o ") : c.minimo !== null || c.maximo !== null ? `${c.minimo ?? "—"} a ${c.maximo ?? "—"}` : ""}</Table.Td>
      <Table.Td>{c.provisional && <Badge color="yellow">provisional</Badge>}</Table.Td>
    </Table.Tr>
  );
}

export function Configuracion() {
  const cfg = useQuery({ queryKey: ["configuracion"], queryFn: () => GET("/api/configuracion") });
  const consumo = useQuery({ queryKey: ["consumo"], queryFn: () => GET("/api/consumo") });
  const grupos = new Map<string, any[]>();
  for (const c of cfg.data?.configuracion ?? []) grupos.set(c.grupo, [...(grupos.get(c.grupo) ?? []), c]);
  const k = consumo.data;
  return (
    <Stack>
      <Title order={2}>Configuración y consumo</Title>
      {k && (
        <Card withBorder>
          <Text fw={600}>Consumo estimado de la base de datos este mes</Text>
          <SimpleGrid cols={{ base: 1, sm: 3 }} mt="sm">
            <div><Text size="xl" fw={700}>{numero(k.horas_activas, 1)} h</Text><Text size="sm" c="dimmed">horas activas</Text></div>
            <div><Text size="xl" fw={700}>{numero(k.creditos_base_estimados, 0)}</Text><Text size="sm" c="dimmed">créditos estimados (base)</Text></div>
            <div><Text size="xl" fw={700}>{numero(k.creditos_plan_mes, 0)}</Text><Text size="sm" c="dimmed">créditos del plan</Text></div>
          </SimpleGrid>
          {k.porcentaje_del_plan !== null && <Progress mt="sm" value={Math.min(100, k.porcentaje_del_plan)} color={k.porcentaje_del_plan > 80 ? "red" : "orange"} />}
          <Text size="xs" c="dimmed" mt="xs">{k.nota}</Text>
          {k.por_dia.length > 0 && <Text size="xs" mt="xs">Por día: {k.por_dia.map((d: any) => `${fecha(d.dia)}: ${numero(d.horas, 1)} h`).join(" · ")}</Text>}
        </Card>
      )}
      {consumo.error && <Alert color="red">{textoError(consumo.error)}</Alert>}
      {[...grupos].map(([g, lista]) => (
        <Stack key={g} gap="xs">
          <Title order={4}>{g}</Title>
          <Table striped>
            <Table.Thead><Table.Tr><Table.Th>Parámetro</Table.Th><Table.Th>Valor</Table.Th><Table.Th>Rango</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>{lista.map((c) => <Fila key={c.clave} c={c} />)}</Table.Tbody>
          </Table>
        </Stack>
      ))}
    </Stack>
  );
}
