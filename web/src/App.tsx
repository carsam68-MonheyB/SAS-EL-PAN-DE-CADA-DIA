import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink as RouterLink, Route, Routes } from "react-router-dom";
import { AppShell, Badge, Burger, Center, Group, Loader, NavLink, ScrollArea, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { GET, POST } from "./api";
import { copia, esErrorDeRed } from "./sinConexion";
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
import { Inventarios } from "./paginas/Inventarios";
import { Pos } from "./paginas/Pos";
import { Ventas } from "./paginas/Ventas";
import { Compras } from "./paginas/Compras";
import { Produccion } from "./paginas/Produccion";
import { Contabilidad } from "./paginas/Contabilidad";

// Permisos que dan acceso a algún catálogo (el detalle lo decide el servidor).
const VER_CATALOGOS = [
  "catalogos.estructura:ver", "catalogos.insumos:ver", "catalogos.sku:ver", "catalogos.proveedores:ver",
  "catalogos.clientes:ver", "catalogos.precios:ver", "produccion.recetas:ver", "contabilidad.catalogo:ver",
  "produccion.plan:ver", "datos.costos:ver",
];
const VER_CARGAS = ["cargas.layout:importar", "catalogos.precios:autorizar", "inventarios.ajustes:autorizar"];
const VER_COMPRAS = ["compras.requisiciones:ver", "compras.ordenes:ver", "compras.recepcion:ver", "compras.facturas:ver", "compras.cxp:ver"];
const VER_INVENTARIOS = [
  "inventarios.existencias:ver", "inventarios.traspasos:ver", "inventarios.conteos:ver", "inventarios.merma_sucursal:ver",
  "produccion.mermas:ver", "compras.recepcion:crear", "inventarios.surtido:crear", "produccion.ordenes:crear",
];

const VER_CONTABILIDAD = ["contabilidad.polizas:ver", "contabilidad.reportes:ver", "contabilidad.catalogo:ver", "contabilidad.cierre:ver"];

const MENU = [
  { ruta: "/", texto: "Inicio", permisos: [] as string[] },
  { ruta: "/catalogos", texto: "Catálogos", permisos: VER_CATALOGOS },
  { ruta: "/cargas", texto: "Cargas masivas", permisos: VER_CARGAS },
  { ruta: "/recetas", texto: "Recetas", permisos: ["produccion.recetas:ver"] },
  { ruta: "/planes", texto: "Plan de producción", permisos: ["produccion.plan:ver"] },
  { ruta: "/produccion", texto: "Producción", permisos: ["produccion.ordenes:ver", "produccion.ordenes:crear"] },
  { ruta: "/costos", texto: "Costo estándar", permisos: ["datos.costos:ver"] },
  { ruta: "/inventarios", texto: "Inventarios", permisos: VER_INVENTARIOS },
  { ruta: "/pos", texto: "Punto de venta (caja)", permisos: ["pos.ventas:crear", "pos.caja:crear", "pos.caja:autorizar"] },
  { ruta: "/compras", texto: "Compras", permisos: VER_COMPRAS },
  { ruta: "/contabilidad", texto: "Contabilidad", permisos: VER_CONTABILIDAD },
  { ruta: "/ventas", texto: "Ventas y cortes", permisos: ["pos.ventas:ver", "pos.caja:ver", "pos.pedidos:ver"] },
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
            m.ruta === "/pos"
              ? <NavLink key={m.ruta} component="a" href="/pos" label={m.texto} />
              : <NavLink key={m.ruta} component={RouterLink} to={m.ruta} label={m.texto} onClick={close} />
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
          {puede("produccion.ordenes:ver", "produccion.ordenes:crear") && <Route path="/produccion" element={<Produccion />} />}
          {puede(...VER_INVENTARIOS) && <Route path="/inventarios" element={<Inventarios />} />}
          {puede("pos.ventas:ver", "pos.caja:ver", "pos.pedidos:ver") && <Route path="/ventas" element={<Ventas />} />}
          {puede(...VER_COMPRAS) && <Route path="/compras" element={<Compras />} />}
          {puede(...VER_CONTABILIDAD) && <Route path="/contabilidad" element={<Contabilidad />} />}
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
    // En la caja, si se cae el internet se sigue con la última sesión conocida (P43); el servidor valida al reconectar.
    const enCaja = window.location.pathname.startsWith("/pos");
    GET<Yo>("/api/auth/yo")
      .then((y) => { if (enCaja) copia.guardar("yo", y); setYo(y); })
      .catch((e) => setYo(enCaja && esErrorDeRed(e) ? copia.leer<Yo>("yo")?.datos ?? null : null));
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
        {/* La caja ocupa toda la pantalla (sin menú), pensada para monitor táctil. */}
        {ruta.startsWith("/pos") ? <Pos /> : <Marco />}
      </BrowserRouter>
    </ContextoSesion.Provider>
  );
}
