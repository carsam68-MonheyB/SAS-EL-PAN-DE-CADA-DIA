import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink as RouterLink, Route, Routes } from "react-router-dom";
import { AppShell, Badge, Burger, Center, Group, Loader, NavLink, ScrollArea, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { GET, POST } from "./api";
import { ContextoSesion, useSesion, type Yo } from "./sesion";
import { ActivarCuenta, Entrar, EtapaAcceso, Instalacion } from "./paginas/Acceso";
import { Inicio } from "./paginas/Inicio";
import { Usuarios } from "./paginas/Usuarios";
import { Roles } from "./paginas/Roles";
import { Controles } from "./paginas/Controles";
import { Bitacora } from "./paginas/Bitacora";
import { Configuracion } from "./paginas/Configuracion";
import { MiCuenta } from "./paginas/MiCuenta";
import { Catalogos } from "./paginas/Catalogos";
import { Cargas } from "./paginas/Cargas";
import { Recetas } from "./paginas/Recetas";
import { Planes } from "./paginas/Planes";
import { Costos } from "./paginas/Costos";

// Permisos que dan acceso a algún catálogo (el detalle lo decide el servidor).
const VER_CATALOGOS = [
  "catalogos.estructura:ver", "catalogos.insumos:ver", "catalogos.sku:ver", "catalogos.proveedores:ver",
  "catalogos.clientes:ver", "catalogos.precios:ver", "produccion.recetas:ver", "contabilidad.catalogo:ver",
  "produccion.plan:ver", "datos.costos:ver",
];
const VER_CARGAS = ["cargas.layout:importar", "catalogos.precios:autorizar"];

const MENU = [
  { ruta: "/", texto: "Inicio", permisos: [] as string[] },
  { ruta: "/catalogos", texto: "Catálogos", permisos: VER_CATALOGOS },
  { ruta: "/cargas", texto: "Cargas masivas", permisos: VER_CARGAS },
  { ruta: "/recetas", texto: "Recetas", permisos: ["produccion.recetas:ver"] },
  { ruta: "/planes", texto: "Plan de producción", permisos: ["produccion.plan:ver"] },
  { ruta: "/costos", texto: "Costo estándar", permisos: ["datos.costos:ver"] },
  { ruta: "/usuarios", texto: "Usuarios", permisos: ["seguridad.usuarios:ver"] },
  { ruta: "/roles", texto: "Roles y permisos", permisos: ["seguridad.usuarios:ver"] },
  { ruta: "/controles", texto: "Segregación y límites", permisos: ["seguridad.usuarios:ver"] },
  { ruta: "/bitacora", texto: "Bitácora", permisos: ["seguridad.bitacora:ver"] },
  { ruta: "/configuracion", texto: "Configuración y consumo", permisos: ["seguridad.configuracion:ver", "configuracion.parametros:ver"] },
  { ruta: "/mi-cuenta", texto: "Mi cuenta", permisos: [] },
];

function Marco() {
  const { yo, puede } = useSesion();
  const [abierto, { toggle, close }] = useDisclosure();
  const visibles = MENU.filter((m) => !m.permisos.length || puede(...m.permisos));
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 250, breakpoint: "sm", collapsed: { mobile: !abierto } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={abierto} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700}>Pan de Cada Día · ERP</Text>
            {yo.ambiente && <Badge color="yellow" variant="light">{yo.ambiente}</Badge>}
          </Group>
          <Text size="sm" c="dimmed" visibleFrom="sm">{yo.usuario.nombre} · {yo.roles.map((r) => r.clave).join(", ")}</Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <ScrollArea>
          {visibles.map((m) => (
            <NavLink key={m.ruta} component={RouterLink} to={m.ruta} label={m.texto} onClick={close} />
          ))}
          <NavLink label="Cerrar sesión" c="red" onClick={() => POST("/api/auth/salir").finally(() => window.location.assign("/"))} />
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Inicio />} />
          {puede(...VER_CATALOGOS) && <Route path="/catalogos" element={<Catalogos />} />}
          {puede(...VER_CATALOGOS) && <Route path="/catalogos/:clave" element={<Catalogos />} />}
          {puede(...VER_CARGAS) && <Route path="/cargas" element={<Cargas />} />}
          {puede("produccion.recetas:ver") && <Route path="/recetas" element={<Recetas />} />}
          {puede("produccion.recetas:ver") && <Route path="/recetas/:clave" element={<Recetas />} />}
          {puede("produccion.plan:ver") && <Route path="/planes" element={<Planes />} />}
          {puede("produccion.plan:ver") && <Route path="/planes/:id" element={<Planes />} />}
          {puede("datos.costos:ver") && <Route path="/costos" element={<Costos />} />}
          {puede("seguridad.usuarios:ver") && <Route path="/usuarios/*" element={<Usuarios />} />}
          {puede("seguridad.usuarios:ver") && <Route path="/roles" element={<Roles />} />}
          {puede("seguridad.usuarios:ver") && <Route path="/controles" element={<Controles />} />}
          {puede("seguridad.bitacora:ver") && <Route path="/bitacora" element={<Bitacora />} />}
          {puede("seguridad.configuracion:ver", "configuracion.parametros:ver") && <Route path="/configuracion" element={<Configuracion />} />}
          <Route path="/mi-cuenta" element={<MiCuenta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}

export function App() {
  const [yo, setYo] = useState<Yo | null | undefined>(undefined);
  const recargar = useCallback(() => {
    GET<Yo>("/api/auth/yo").then(setYo).catch(() => setYo(null));
  }, []);
  useEffect(() => {
    recargar();
    const fin = () => setYo(null);
    window.addEventListener("sesion-terminada", fin);
    return () => window.removeEventListener("sesion-terminada", fin);
  }, [recargar]);

  const ruta = window.location.pathname;
  if (ruta === "/activar") return <ActivarCuenta />;
  if (ruta === "/instalacion") return <Instalacion />;
  if (yo === undefined) return <Center mih="100vh"><Loader /></Center>;
  if (yo === null) return <Entrar alEntrar={recargar} />;
  if (yo.etapa !== "completa") return <EtapaAcceso yo={yo} alAvanzar={recargar} alSalir={() => setYo(null)} />;
  return (
    <ContextoSesion.Provider value={{ yo, recargar }}>
      <BrowserRouter>
        <Marco />
      </BrowserRouter>
    </ContextoSesion.Provider>
  );
}
