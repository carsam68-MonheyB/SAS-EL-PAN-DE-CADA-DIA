// Catálogos maestros: consulta, búsqueda, captura en pantalla y exportación.
// El formulario se arma con la misma definición del layout, así que valida
// exactamente igual que la carga masiva.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Button, Group, Menu, Modal, NavLink, ScrollArea, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { descargar, ErrorApi, GET, POST, textoError } from "../api";

export interface CampoLayout {
  nombre: string;
  tipo: string;
  descripcion: string;
  ejemplo: string;
  obligatorio: boolean;
  por_omision: string | null;
  opciones: string[] | null;
  ref: string | null;
  sat: string | null;
  solo_alta: boolean;
  max: number | null;
}

export interface LayoutInfo {
  clave: string;
  nombre: string;
  grupo: string;
  descripcion: string;
  secuencia: number;
  llave: string[];
  requiere_autorizacion: boolean;
  notas: string[];
  puede: { ver: boolean; crear: boolean; editar: boolean; importar: boolean; exportar: boolean; autorizar: boolean };
  campos: CampoLayout[];
}

export function useLayouts() {
  return useQuery({ queryKey: ["layouts"], queryFn: () => GET<{ layouts: LayoutInfo[] }>("/api/layouts").then((r) => r.layouts) });
}

export function MenuDescarga({ texto, ruta, archivo, variante = "light" }: { texto: string; ruta: string; archivo: string; variante?: string }) {
  const [error, setError] = useState<string | null>(null);
  const bajar = (f: string) => descargar(`${ruta}${ruta.includes("?") ? "&" : "?"}formato=${f}`, `${archivo}.${f}`).catch((e) => setError(textoError(e)));
  return (
    <>
      <Menu>
        <Menu.Target>
          <Button variant={variante}>{texto}</Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => bajar("xlsx")}>Excel (.xlsx)</Menu.Item>
          <Menu.Item onClick={() => bajar("txt")}>Texto separado por | (.txt)</Menu.Item>
          <Menu.Item onClick={() => bajar("csv")}>CSV (.csv)</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {error && <Text c="red" size="sm">{error}</Text>}
    </>
  );
}

function Formulario({ layout, inicial, alCerrar }: { layout: LayoutInfo; inicial: Record<string, string> | null; alCerrar: (mensaje?: string) => void }) {
  const esAlta = inicial === null;
  const [valores, setValores] = useState<Record<string, string>>(() => inicial ?? Object.fromEntries(layout.campos.map((c) => [c.nombre, ""])));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const opciones = useQuery({ queryKey: ["opciones", layout.clave], queryFn: () => GET<Record<string, string[]>>(`/api/layouts/${layout.clave}/opciones`) });
  const qc = useQueryClient();

  const guardar = useMutation({
    mutationFn: () => {
      // En un cambio solo se mandan la llave y lo que cambió (vacío = sin cambio).
      const enviar = Object.fromEntries(
        layout.campos
          .filter((c) => (esAlta ? valores[c.nombre] !== "" : layout.llave.includes(c.nombre) || valores[c.nombre] !== (inicial![c.nombre] ?? "")))
          .map((c) => [c.nombre, valores[c.nombre] ?? ""]),
      );
      return POST(`/api/layouts/${layout.clave}/registro`, { modo: esAlta ? "alta" : "actualizacion", valores: enviar });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["registros", layout.clave] });
      qc.invalidateQueries({ queryKey: ["cargas"] });
      alCerrar(r.estatus === "pendiente_autorizacion" ? "Quedó pendiente de autorización. Se aplicará cuando la autorice otra persona (ver Cargas masivas)." : "Guardado.");
    },
    onError: (e) => {
      const porCampo: Record<string, string> = {};
      if (e instanceof ErrorApi && Array.isArray(e.datos?.detalles)) {
        for (const d of e.datos.detalles) if (d.campo) porCampo[d.campo] = d.mensaje.replace(`${d.campo}: `, "");
        const sinCampo = e.datos.detalles.filter((d: any) => !d.campo).map((d: any) => d.mensaje);
        setGeneral(sinCampo.length ? sinCampo.join(" · ") : Object.keys(porCampo).length ? null : textoError(e));
      } else setGeneral(textoError(e));
      setErrores(porCampo);
    },
  });

  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {layout.campos.map((c) => {
          const bloqueado = !esAlta && (layout.llave.includes(c.nombre) || c.solo_alta);
          const etiqueta = c.nombre.replaceAll("_", " ");
          const comun = {
            label: etiqueta,
            description: c.descripcion,
            error: errores[c.nombre],
            disabled: bloqueado,
            withAsterisk: esAlta && (c.obligatorio || layout.llave.includes(c.nombre)) && c.por_omision === null,
          };
          const lista = opciones.data?.[c.nombre];
          if (lista && lista.length) {
            return (
              <Select
                key={c.nombre}
                {...comun}
                data={lista}
                searchable
                clearable
                placeholder={c.por_omision ? `Si se omite: ${c.por_omision}` : c.ejemplo}
                value={valores[c.nombre] || null}
                onChange={(v) => setValores((x) => ({ ...x, [c.nombre]: v ?? "" }))}
              />
            );
          }
          return (
            <TextInput
              key={c.nombre}
              {...comun}
              placeholder={c.tipo === "fecha" ? "DD/MM/AAAA" : c.ejemplo}
              value={valores[c.nombre] ?? ""}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setValores((x) => ({ ...x, [c.nombre]: v }));
              }}
            />
          );
        })}
      </SimpleGrid>
      {general && <Alert color="red">{general}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={() => alCerrar()}>Cancelar</Button>
        <Button loading={guardar.isPending} onClick={() => guardar.mutate()}>{esAlta ? "Dar de alta" : "Guardar cambios"}</Button>
      </Group>
    </Stack>
  );
}

function Detalle({ layout }: { layout: LayoutInfo }) {
  const [buscar, setBuscar] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState<Record<string, string> | null | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(buscar), 300);
    return () => clearTimeout(t);
  }, [buscar]);
  const registros = useQuery({
    queryKey: ["registros", layout.clave, busqueda],
    queryFn: () => GET<{ encabezados: string[]; filas: string[][] }>(`/api/layouts/${layout.clave}/registros?buscar=${encodeURIComponent(busqueda)}`),
  });
  const idxActivo = registros.data?.encabezados.indexOf("ACTIVO") ?? -1;

  return (
    <Stack>
      <div>
        <Title order={3}>{layout.nombre}</Title>
        <Text size="sm" c="dimmed">{layout.descripcion}</Text>
      </div>
      <Group>
        {layout.puede.crear && <Button onClick={() => setEditando(null)}>Nuevo</Button>}
        {layout.puede.importar && <Button variant="light" component={Link} to={`/cargas?layout=${layout.clave}`}>Cargar archivo</Button>}
        {(layout.puede.importar || layout.puede.crear) && <MenuDescarga texto="Plantilla vacía" ruta={`/api/layouts/${layout.clave}/plantilla`} archivo={`${layout.clave}-plantilla`} variante="default" />}
        {layout.puede.exportar && <MenuDescarga texto="Exportar datos" ruta={`/api/layouts/${layout.clave}/exportar`} archivo={`${layout.clave}-datos`} variante="default" />}
        {layout.requiere_autorizacion && <Badge color="grape" variant="light">Los cambios requieren autorización</Badge>}
      </Group>
      {aviso && <Alert color="green" withCloseButton onClose={() => setAviso(null)}>{aviso}</Alert>}
      <TextInput placeholder="Buscar por clave, nombre…" value={buscar} onChange={(e) => setBuscar(e.currentTarget.value)} maw={360} />
      {registros.error && <Alert color="red">{textoError(registros.error)}</Alert>}
      {registros.data && (
        <>
          <Text size="sm" c="dimmed">{registros.data.filas.length === 1000 ? "Se muestran los primeros 1,000 registros; usa la búsqueda o exporta." : `${registros.data.filas.length} registro(s)`}</Text>
          <ScrollArea>
            <Table striped highlightOnHover withTableBorder fz="sm">
              <Table.Thead>
                <Table.Tr>{registros.data.encabezados.map((h) => <Table.Th key={h} style={{ whiteSpace: "nowrap" }}>{h.replaceAll("_", " ")}</Table.Th>)}</Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {registros.data.filas.map((f, i) => (
                  <Table.Tr
                    key={i}
                    style={{ cursor: layout.puede.editar ? "pointer" : undefined, opacity: idxActivo >= 0 && f[idxActivo] === "NO" ? 0.5 : 1 }}
                    onClick={() => layout.puede.editar && setEditando(Object.fromEntries(registros.data!.encabezados.map((h, j) => [h, f[j] ?? ""])))}
                  >
                    {f.map((v, j) => <Table.Td key={j} style={{ whiteSpace: "nowrap" }}>{v}</Table.Td>)}
                  </Table.Tr>
                ))}
                {!registros.data.filas.length && (
                  <Table.Tr><Table.Td colSpan={registros.data.encabezados.length}><Text c="dimmed" size="sm">Sin registros. {layout.puede.importar ? "Puedes darlos de alta uno por uno o con una carga masiva." : ""}</Text></Table.Td></Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </>
      )}
      <Modal opened={editando !== undefined} onClose={() => setEditando(undefined)} title={editando === null ? `Nuevo · ${layout.nombre}` : `Modificar · ${layout.nombre}`} size="xl">
        {editando !== undefined && (
          <Formulario
            layout={layout}
            inicial={editando}
            alCerrar={(m) => {
              setEditando(undefined);
              if (m) setAviso(m);
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}

export function Catalogos() {
  const { clave } = useParams();
  const navegar = useNavigate();
  const layouts = useLayouts();
  const grupos = useMemo(() => {
    const g = new Map<string, LayoutInfo[]>();
    for (const l of layouts.data ?? []) g.set(l.grupo, [...(g.get(l.grupo) ?? []), l]);
    return [...g.entries()];
  }, [layouts.data]);
  const actual = layouts.data?.find((l) => l.clave === clave) ?? layouts.data?.[0];

  if (layouts.error) return <Alert color="red">{textoError(layouts.error)}</Alert>;
  if (!layouts.data) return null;
  if (!layouts.data.length) return <Alert>No tienes catálogos asignados.</Alert>;
  return (
    <Group align="flex-start" wrap="nowrap" gap="lg">
      <Stack gap={0} w={250} visibleFrom="md" style={{ flexShrink: 0 }}>
        {grupos.map(([g, ls]) => (
          <div key={g}>
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" mt="sm" mb={4}>{g}</Text>
            {ls.map((l) => <NavLink key={l.clave} label={l.nombre} active={l.clave === actual?.clave} onClick={() => navegar(`/catalogos/${l.clave}`)} />)}
          </div>
        ))}
        <Anchor component={Link} to="/cargas" size="sm" mt="md">Ir a cargas masivas →</Anchor>
      </Stack>
      <Stack style={{ flex: 1, minWidth: 0 }}>
        <Select
          hiddenFrom="md"
          label="Catálogo"
          data={grupos.map(([g, ls]) => ({ group: g, items: ls.map((l) => ({ value: l.clave, label: l.nombre })) }))}
          value={actual?.clave ?? null}
          onChange={(v) => v && navegar(`/catalogos/${v}`)}
        />
        {actual && <Detalle key={actual.clave} layout={actual} />}
      </Stack>
    </Group>
  );
}
