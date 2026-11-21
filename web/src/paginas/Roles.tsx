import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Checkbox, Grid, Group, Modal, NavLink, Select, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { descargar, GET, POST, PUT, textoError } from "../api";
import { useSesion } from "../sesion";

const ACCIONES = [
  ["ver", "Ver"], ["crear", "Crear"], ["editar", "Editar"], ["cancelar", "Cancelar"], ["autorizar", "Autorizar"],
  ["cerrar", "Cerrar"], ["exportar", "Exportar"], ["imprimir", "Imprimir"], ["importar", "Importar"],
] as const;

interface Permiso { clave: string; grupo: string; modulo: string; modulo_nombre: string; accion: string; sensible: boolean }

function DatosRol({ rol, alGuardar }: { rol?: any; alGuardar: (r: any) => void }) {
  const [d, setD] = useState({ clave: rol?.clave ?? "", nombre: rol?.nombre ?? "", descripcion: rol?.descripcion ?? "", requiere_2fa: rol?.requiere_2fa ?? false, alcance: rol?.alcance ?? "todas", activo: rol?.activo ?? true });
  const m = useMutation({ mutationFn: () => (rol ? PUT(`/api/roles/${rol.id}`, d) : POST("/api/roles", d)), onSuccess: alGuardar });
  return (
    <Stack>
      {!rol && <TextInput label="Clave" description="Ej. AUXPROD" value={d.clave} onChange={(e) => setD({ ...d, clave: e.currentTarget.value.toUpperCase() })} />}
      <TextInput label="Nombre del puesto" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.currentTarget.value })} />
      <TextInput label="Descripción" value={d.descripcion} onChange={(e) => setD({ ...d, descripcion: e.currentTarget.value })} />
      <Select label="Alcance" data={[{ value: "todas", label: "Todas las sucursales" }, { value: "sucursal", label: "Solo sus sucursales" }, { value: "almacen", label: "Solo sus almacenes" }]} value={d.alcance} onChange={(v) => setD({ ...d, alcance: v ?? "todas" })} />
      <Switch label="Exige verificación en dos pasos" checked={d.requiere_2fa} onChange={(e) => setD({ ...d, requiere_2fa: e.currentTarget.checked })} />
      <Switch label="Activo" checked={d.activo} onChange={(e) => setD({ ...d, activo: e.currentTarget.checked })} />
      {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
      <Button loading={m.isPending} onClick={() => m.mutate()}>Guardar</Button>
    </Stack>
  );
}

function MatrizRol({ rolId, permisos }: { rolId: string; permisos: Permiso[] }) {
  const qc = useQueryClient();
  const { yo, puede } = useSesion();
  const q = useQuery({ queryKey: ["rol", rolId], queryFn: () => GET(`/api/roles/${rolId}`) });
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [editarDatos, setEditarDatos] = useState(false);
  useEffect(() => { if (q.data) setMarcados(new Set(q.data.permisos)); }, [q.data]);
  const rol = q.data;
  const esMio = !!rol && yo.roles.some((r) => r.clave === rol.clave);
  const editable = puede("seguridad.usuarios:editar") && !esMio;
  const guardar = useMutation({
    mutationFn: () => PUT(`/api/roles/${rolId}/permisos`, { permisos: [...marcados] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rol", rolId] }); qc.invalidateQueries({ queryKey: ["roles"] }); },
  });
  const modulos = useMemo(() => {
    const m = new Map<string, { grupo: string; nombre: string; acciones: Map<string, string> }>();
    for (const p of permisos) {
      if (p.grupo === "Datos sensibles") continue;
      const e = m.get(p.modulo) ?? { grupo: p.grupo, nombre: p.modulo_nombre, acciones: new Map() };
      e.acciones.set(p.accion, p.clave);
      m.set(p.modulo, e);
    }
    return [...m.values()];
  }, [permisos]);
  const sensibles = permisos.filter((p) => p.sensible);
  if (!rol) return null;
  const cambiar = (clave: string, si: boolean) => { const s = new Set(marcados); si ? s.add(clave) : s.delete(clave); setMarcados(s); };
  const cambios = rol.permisos.length !== marcados.size || rol.permisos.some((p: string) => !marcados.has(p));
  let grupoAnterior = "";
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={3}>{rol.nombre} <Badge>{rol.clave}</Badge> {!rol.activo && <Badge color="gray">inactivo</Badge>}</Title>
          <Text size="sm" c="dimmed">Alcance: {rol.alcance} · Dos pasos: {rol.requiere_2fa ? "obligatorio" : "opcional"} · {rol.usuarios} usuario(s)</Text>
        </div>
        {puede("seguridad.usuarios:editar") && <Button variant="light" onClick={() => setEditarDatos(true)}>Datos del rol</Button>}
      </Group>
      {esMio && <Alert color="gray">Tienes este rol: sus permisos los cambia otro administrador.</Alert>}
      <Table.ScrollContainer minWidth={900}>
        <Table striped withColumnBorders fz="xs">
          <Table.Thead>
            <Table.Tr><Table.Th>Módulo</Table.Th>{ACCIONES.map(([, t]) => <Table.Th key={t} ta="center">{t}</Table.Th>)}</Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {modulos.flatMap((m) => {
              const filas = [];
              if (m.grupo !== grupoAnterior) {
                grupoAnterior = m.grupo;
                filas.push(<Table.Tr key={`g-${m.grupo}`}><Table.Td colSpan={10} bg="var(--mantine-color-orange-0)"><b>{m.grupo}</b></Table.Td></Table.Tr>);
              }
              filas.push(
                <Table.Tr key={m.nombre}>
                  <Table.Td>{m.nombre}</Table.Td>
                  {ACCIONES.map(([a]) => {
                    const clave = m.acciones.get(a);
                    return <Table.Td key={a} ta="center">{clave && <Checkbox size="xs" disabled={!editable} checked={marcados.has(clave)} onChange={(e) => cambiar(clave, e.currentTarget.checked)} style={{ display: "inline-block" }} />}</Table.Td>;
                  })}
                </Table.Tr>,
              );
              return filas;
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Title order={5}>Datos sensibles</Title>
      <Group>{sensibles.map((p) => <Checkbox key={p.clave} label={p.modulo === "datos" || p.accion !== "cancelar" ? p.modulo_nombre : "Cancelar CFDI"} disabled={!editable} checked={marcados.has(p.clave)} onChange={(e) => cambiar(p.clave, e.currentTarget.checked)} />)}</Group>
      {guardar.error && <Alert color="red" title="No se guardó">{textoError(guardar.error)}</Alert>}
      {guardar.isSuccess && !cambios && <Alert color="green">Permisos guardados (quedó registrado en la bitácora).</Alert>}
      {editable && <Group><Button disabled={!cambios} loading={guardar.isPending} onClick={() => guardar.mutate()}>Guardar permisos</Button>{cambios && <Button variant="subtle" onClick={() => setMarcados(new Set(rol.permisos))}>Descartar cambios</Button>}</Group>}
      <Modal opened={editarDatos} onClose={() => setEditarDatos(false)} title="Datos del rol">
        <DatosRol rol={rol} alGuardar={() => { setEditarDatos(false); qc.invalidateQueries({ queryKey: ["rol", rolId] }); qc.invalidateQueries({ queryKey: ["roles"] }); }} />
      </Modal>
    </Stack>
  );
}

export function Roles() {
  const qc = useQueryClient();
  const { puede } = useSesion();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => GET("/api/roles") });
  const permisos = useQuery({ queryKey: ["permisos"], queryFn: () => GET("/api/permisos") });
  const [sel, setSel] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Roles y permisos</Title>
        <Group>
          {puede("seguridad.usuarios:exportar") && <Button variant="light" onClick={() => descargar("/api/reportes/quien-puede?formato=xlsx", "quien-puede-hacer-que.xlsx").catch((e) => setError(textoError(e)))}>Reporte quién puede hacer qué (Excel)</Button>}
          {puede("seguridad.usuarios:crear") && <Button onClick={() => setNuevo(true)}>Nuevo rol</Button>}
        </Group>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      <Grid>
        <Grid.Col span={{ base: 12, md: 3 }}>
          {(roles.data?.roles ?? []).map((r: any) => (
            <NavLink key={r.id} active={sel === r.id} onClick={() => setSel(r.id)} label={`${r.clave} · ${r.nombre}`} description={`${r.permisos} permisos · ${r.usuarios} usuarios${r.activo ? "" : " · inactivo"}`} />
          ))}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9 }}>
          {sel && permisos.data ? <MatrizRol rolId={sel} permisos={permisos.data.permisos} /> : <Text c="dimmed">Elige un rol para ver o editar su matriz de permisos.</Text>}
        </Grid.Col>
      </Grid>
      <Modal opened={nuevo} onClose={() => setNuevo(false)} title="Nuevo rol">
        <DatosRol alGuardar={(r) => { setNuevo(false); setSel(r.id); qc.invalidateQueries({ queryKey: ["roles"] }); }} />
      </Modal>
    </Stack>
  );
}
