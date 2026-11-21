import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Button, CopyButton, Group, Modal, MultiSelect, SegmentedControl, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { GET, POST, PUT, textoError } from "../api";
import { fecha, fechaHora } from "../formato";
import { useSesion } from "../sesion";

interface Estructura {
  sucursales: { id: string; clave: string; nombre: string }[];
  almacenes: { id: string; clave: string; nombre: string }[];
}

function useCatalogos() {
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => GET("/api/roles") });
  const estructura = useQuery({ queryKey: ["estructura"], queryFn: () => GET<Estructura>("/api/estructura") });
  return { roles: roles.data?.roles ?? [], estructura: estructura.data };
}

function Enlace({ titulo, enlace }: { titulo: string; enlace: string }) {
  return (
    <Alert color="green" title={titulo}>
      <Text size="sm">Entrégalo en persona a la persona usuaria (aún no hay correo configurado). Es de un solo uso y vence.</Text>
      <Group mt="xs" wrap="nowrap">
        <Text size="xs" style={{ wordBreak: "break-all" }}>{enlace}</Text>
        <CopyButton value={enlace}>{({ copied, copy }) => <Button size="xs" variant="light" onClick={copy}>{copied ? "Copiado" : "Copiar"}</Button>}</CopyButton>
      </Group>
    </Alert>
  );
}

function FormularioUsuario({ inicial, alGuardar }: { inicial?: any; alGuardar: (r: any) => void }) {
  const { roles, estructura } = useCatalogos();
  const [d, setD] = useState({
    usuario: inicial?.usuario ?? "", nombre: inicial?.nombre ?? "", puesto: inicial?.puesto ?? "", correo: inicial?.correo ?? "",
    roles: (inicial?.roles ?? []) as string[], sucursales: (inicial?.sucursales ?? []) as string[], almacenes: (inicial?.almacenes ?? []) as string[],
  });
  const m = useMutation({
    mutationFn: () => (inicial ? PUT(`/api/usuarios/${inicial.id}`, { ...d, usuario: undefined }) : POST("/api/usuarios", d)),
    onSuccess: alGuardar,
  });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e?.currentTarget ? e.currentTarget.value : e });
  return (
    <Stack>
      {!inicial && <TextInput label="Usuario (para entrar)" description="Minúsculas, sin espacios. Ej. maria.lopez" value={d.usuario} onChange={(e) => setD({ ...d, usuario: e.currentTarget.value.toLowerCase() })} required />}
      <TextInput label="Nombre completo" value={d.nombre} onChange={set("nombre")} required />
      <TextInput label="Puesto" value={d.puesto} onChange={set("puesto")} required />
      <TextInput label="Correo (opcional)" value={d.correo} onChange={set("correo")} />
      <MultiSelect label="Roles" data={roles.filter((r: any) => r.activo).map((r: any) => ({ value: r.clave, label: `${r.clave} · ${r.nombre}` }))} value={d.roles} onChange={set("roles")} searchable />
      <MultiSelect label="Sucursales donde opera" description="Para puestos con alcance por sucursal" data={(estructura?.sucursales ?? []).map((s) => ({ value: s.id, label: `${s.clave} · ${s.nombre}` }))} value={d.sucursales} onChange={set("sucursales")} />
      <MultiSelect label="Almacenes donde opera" description="Para puestos con alcance por almacén" data={(estructura?.almacenes ?? []).map((a) => ({ value: a.id, label: `${a.clave} · ${a.nombre}` }))} value={d.almacenes} onChange={set("almacenes")} />
      {m.error && <Alert color="red">{textoError(m.error)}</Alert>}
      <Button loading={m.isPending} onClick={() => m.mutate()}>{inicial ? "Guardar cambios" : "Dar de alta y generar invitación"}</Button>
    </Stack>
  );
}

function DetalleUsuario({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const qc = useQueryClient();
  const { yo, puede } = useSesion();
  const { estructura } = useCatalogos();
  const q = useQuery({ queryKey: ["usuario", id], queryFn: () => GET(`/api/usuarios/${id}`) });
  const [editando, setEditando] = useState(false);
  const [enlace, setEnlace] = useState<string | null>(null);
  const accion = useMutation({
    mutationFn: (a: string) => POST(`/api/usuarios/${id}/${a}`),
    onSuccess: (r: any) => {
      if (r?.enlace) setEnlace(r.enlace);
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["usuario", id] });
    },
  });
  const u = q.data;
  if (!u) return null;
  const propio = u.id === yo.usuario.id;
  const nombres = (ids: string[], lista: { id: string; clave: string }[] = []) => ids.map((x) => lista.find((l) => l.id === x)?.clave ?? "?").join(", ") || "—";
  const confirmar = (a: string, texto: string) => window.confirm(texto) && accion.mutate(a);
  return (
    <Stack>
      {editando ? (
        <FormularioUsuario inicial={u} alGuardar={() => { setEditando(false); qc.invalidateQueries({ queryKey: ["usuarios"] }); qc.invalidateQueries({ queryKey: ["usuario", id] }); }} />
      ) : (
        <Table>
          <Table.Tbody>
            {[
              ["Usuario", u.usuario], ["Nombre", u.nombre], ["Puesto", u.puesto], ["Correo", u.correo ?? "—"],
              ["Estatus", u.estatus], ["Roles", u.roles.join(", ")],
              ["Sucursales", nombres(u.sucursales, estructura?.sucursales)], ["Almacenes", nombres(u.almacenes, estructura?.almacenes)],
              ["Activado", u.activado ? "Sí" : "Pendiente (no ha usado su invitación)"], ["Dos pasos", u.totp_activo ? "Activado" : "No"],
              ["PIN de cajero", u.tiene_pin ? "Definido" : "No"], ["Bloqueado", u.bloqueado ? "Sí" : "No"],
              ["Alta", fecha(u.fecha_alta)], ["Baja", fecha(u.fecha_baja) || "—"], ["Último acceso", fechaHora(u.ultimo_acceso) || "—"],
            ].map(([k, v]) => <Table.Tr key={k}><Table.Th w={160}>{k}</Table.Th><Table.Td>{v}</Table.Td></Table.Tr>)}
          </Table.Tbody>
        </Table>
      )}
      {enlace && <Enlace titulo="Enlace generado" enlace={enlace} />}
      {accion.error && <Alert color="red">{textoError(accion.error)}</Alert>}
      {propio && <Alert color="gray">Tus propios roles y estatus los cambia otro administrador.</Alert>}
      {!propio && u.estatus !== "baja" && (
        <Group>
          {puede("seguridad.usuarios:editar") && !editando && <Button variant="light" onClick={() => setEditando(true)}>Editar</Button>}
          {(puede("seguridad.usuarios:crear", "seguridad.usuarios:editar")) && u.estatus === "activo" && <Button variant="light" onClick={() => accion.mutate("invitar")}>{u.activado ? "Enlace para restablecer contraseña" : "Nuevo enlace de invitación"}</Button>}
          {puede("seguridad.usuarios:editar") && u.bloqueado && <Button variant="light" onClick={() => accion.mutate("desbloquear")}>Desbloquear</Button>}
          {puede("seguridad.usuarios:editar") && u.totp_activo && <Button variant="light" color="orange" onClick={() => confirmar("restablecer-2fa", "¿Restablecer su verificación en dos pasos? Tendrá que activarla de nuevo.")}>Restablecer dos pasos</Button>}
          {puede("seguridad.usuarios:editar") && u.estatus === "activo" && <Button variant="light" color="orange" onClick={() => confirmar("suspender", "¿Suspender al usuario? Se cerrarán sus sesiones.")}>Suspender</Button>}
          {puede("seguridad.usuarios:editar") && u.estatus === "suspendido" && <Button variant="light" onClick={() => accion.mutate("reactivar")}>Reactivar</Button>}
          {puede("seguridad.usuarios:cancelar") && <Button variant="light" color="red" onClick={() => confirmar("baja", "¿Dar de baja? El usuario no se borra (conserva su historia), pero ya no podrá entrar.")}>Dar de baja</Button>}
        </Group>
      )}
      <Button variant="subtle" onClick={alCerrar}>Cerrar</Button>
    </Stack>
  );
}

export function Usuarios() {
  const qc = useQueryClient();
  const { puede } = useSesion();
  const [filtro, setFiltro] = useState("activo");
  const [busqueda, setBusqueda] = useState("");
  const [alta, setAlta] = useState(false);
  const [resultadoAlta, setResultadoAlta] = useState<any>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<any>(null);
  const q = useQuery({ queryKey: ["usuarios", filtro], queryFn: () => GET(`/api/usuarios${filtro === "todos" ? "" : `?estatus=${filtro}`}`) });
  const datosPrueba = useMutation({ mutationFn: () => POST("/api/datos-prueba"), onSuccess: (r) => { setPrueba(r); qc.invalidateQueries({ queryKey: ["usuarios"] }); } });
  const lista = (q.data?.usuarios ?? []).filter((u: any) => `${u.usuario} ${u.nombre} ${u.puesto}`.toLowerCase().includes(busqueda.toLowerCase()));
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Usuarios</Title>
        <Group>
          {puede("seguridad.usuarios:crear") && <Button variant="light" loading={datosPrueba.isPending} onClick={() => window.confirm("¿Crear o reiniciar los usuarios FICTICIOS de prueba (uno por puesto)?") && datosPrueba.mutate()}>Usuarios de prueba</Button>}
          {puede("seguridad.usuarios:crear") && <Button onClick={() => { setResultadoAlta(null); setAlta(true); }}>Nuevo usuario</Button>}
        </Group>
      </Group>
      {datosPrueba.error && <Alert color="red">{textoError(datosPrueba.error)}</Alert>}
      {prueba && (
        <Alert color="yellow" title="Usuarios de prueba (FICTICIOS)" withCloseButton onClose={() => setPrueba(null)}>
          <Text size="sm">{prueba.aviso}</Text>
          <Text size="sm" mt="xs">Contraseña de todos: <b>{prueba.password}</b></Text>
          <Text size="sm">Usuarios: {prueba.usuarios.join(", ")}</Text>
        </Alert>
      )}
      <Group>
        <SegmentedControl value={filtro} onChange={setFiltro} data={[{ value: "activo", label: "Activos" }, { value: "suspendido", label: "Suspendidos" }, { value: "baja", label: "Bajas" }, { value: "todos", label: "Todos" }]} />
        <TextInput placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.currentTarget.value)} />
      </Group>
      <Table.ScrollContainer minWidth={700}>
        <Table striped highlightOnHover>
          <Table.Thead><Table.Tr><Table.Th>Usuario</Table.Th><Table.Th>Nombre</Table.Th><Table.Th>Puesto</Table.Th><Table.Th>Roles</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {lista.map((u: any) => (
              <Table.Tr key={u.id} style={{ cursor: "pointer" }} onClick={() => setSeleccionado(u.id)}>
                <Table.Td><Anchor component="button">{u.usuario}</Anchor> {u.es_prueba && <Badge size="xs" color="yellow">prueba</Badge>}</Table.Td>
                <Table.Td>{u.nombre}</Table.Td>
                <Table.Td>{u.puesto}</Table.Td>
                <Table.Td>{u.roles.join(", ")}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Badge color={u.estatus === "activo" ? "green" : u.estatus === "baja" ? "gray" : "orange"}>{u.estatus}</Badge>
                    {!u.activado && <Badge color="blue" variant="light">invitación pendiente</Badge>}
                    {u.bloqueado && <Badge color="red">bloqueado</Badge>}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Modal opened={alta} onClose={() => setAlta(false)} title="Nuevo usuario" size="lg">
        {resultadoAlta ? (
          <Stack>
            <Enlace titulo={`Usuario ${resultadoAlta.usuario.usuario} creado`} enlace={resultadoAlta.invitacion.enlace} />
            <Button onClick={() => setAlta(false)}>Listo</Button>
          </Stack>
        ) : (
          <FormularioUsuario alGuardar={(r) => { setResultadoAlta(r); qc.invalidateQueries({ queryKey: ["usuarios"] }); }} />
        )}
      </Modal>
      <Modal opened={!!seleccionado} onClose={() => setSeleccionado(null)} title="Usuario" size="lg">
        {seleccionado && <DetalleUsuario id={seleccionado} alCerrar={() => setSeleccionado(null)} />}
      </Modal>
    </Stack>
  );
}
