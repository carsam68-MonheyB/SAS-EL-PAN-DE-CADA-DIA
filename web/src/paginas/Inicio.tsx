import { Alert, Card, Group, List, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useSesion } from "../sesion";

export function Inicio() {
  const { yo } = useSesion();
  return (
    <Stack>
      <Title order={2}>Hola, {yo.usuario.nombre}</Title>
      {yo.usuario.es_prueba && <Alert color="yellow">Este es un usuario FICTICIO de prueba.</Alert>}
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card withBorder>
          <Text fw={600}>Tus puestos</Text>
          <List size="sm">{yo.roles.map((r) => <List.Item key={r.clave}>{r.nombre} ({r.clave})</List.Item>)}</List>
        </Card>
        <Card withBorder>
          <Text fw={600}>Tu alcance</Text>
          <Text size="sm">{yo.alcance.todas ? "Todas las sucursales y almacenes" : `${yo.alcance.sucursales.length} sucursal(es) · ${yo.alcance.almacenes.length} almacén(es)`}</Text>
          <Group mt="xs"><Text size="sm">Verificación en dos pasos: {yo.usuario.totp_activo ? "activada" : "no activada"}</Text></Group>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
