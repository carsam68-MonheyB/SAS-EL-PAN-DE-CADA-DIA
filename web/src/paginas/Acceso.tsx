// Inicio de sesión y etapas de acceso: segundo factor, cambio de contraseña y
// activación del doble factor. También la activación por enlace e instalación.
import { useEffect, useState } from "react";
import { Alert, Anchor, Button, Card, Center, Code, Image, List, PasswordInput, PinInput, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { GET, POST, textoError } from "../api";
import type { Yo } from "../sesion";

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Center mih="100vh" p="md" bg="var(--mantine-color-orange-0)">
      <Card withBorder shadow="sm" radius="md" p="xl" w={420} maw="100%">
        <Stack>
          <div>
            <Text size="sm" c="dimmed">ERP Pan de Cada Día</Text>
            <Title order={3}>{titulo}</Title>
          </div>
          {children}
        </Stack>
      </Card>
    </Center>
  );
}

function useEnvio() {
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const enviar = async (fn: () => Promise<void>) => {
    setError(null);
    setCargando(true);
    try {
      await fn();
    } catch (e) {
      setError(textoError(e));
    } finally {
      setCargando(false);
    }
  };
  return { error, cargando, enviar };
}

export function Entrar({ alEntrar }: { alEntrar: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const { error, cargando, enviar } = useEnvio();
  const [instalado, setInstalado] = useState(true);
  useEffect(() => {
    GET("/api/instalacion").then((r) => setInstalado(r.instalado)).catch(() => undefined);
  }, []);
  return (
    <Marco titulo="Iniciar sesión">
      {!instalado && (
        <Alert color="orange">El sistema aún no tiene usuarios. <Anchor href="/instalacion">Instalar el primer administrador</Anchor>.</Alert>
      )}
      <form onSubmit={(e) => { e.preventDefault(); enviar(async () => { await POST("/api/auth/login", { usuario, password }); alEntrar(); }); }}>
        <Stack>
          <TextInput label="Usuario" value={usuario} onChange={(e) => setUsuario(e.currentTarget.value)} autoComplete="username" autoFocus required />
          <PasswordInput label="Contraseña" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" required />
          {error && <Alert color="red">{error}</Alert>}
          <Button type="submit" loading={cargando}>Entrar</Button>
        </Stack>
      </form>
      <Text size="xs" c="dimmed">No hay registro abierto: el administrador da de alta a cada usuario.</Text>
    </Marco>
  );
}

export function EtapaAcceso({ yo, alAvanzar, alSalir }: { yo: Yo; alAvanzar: () => void; alSalir: () => void }) {
  const salir = <Anchor component="button" size="sm" onClick={() => POST("/api/auth/salir").finally(alSalir)}>Cancelar y salir</Anchor>;
  if (yo.etapa === "segundo_factor") return <SegundoFactor alAvanzar={alAvanzar}>{salir}</SegundoFactor>;
  if (yo.etapa === "cambiar_password") return <Marco titulo="Cambia tu contraseña"><CambiarPassword alTerminar={alAvanzar} />{salir}</Marco>;
  return <ActivarTotp obligatorio alTerminar={alAvanzar}>{salir}</ActivarTotp>;
}

function SegundoFactor({ alAvanzar, children }: { alAvanzar: () => void; children: React.ReactNode }) {
  const [codigo, setCodigo] = useState("");
  const [recuperacion, setRecuperacion] = useState(false);
  const { error, cargando, enviar } = useEnvio();
  const mandar = (c: string) => enviar(async () => { await POST("/api/auth/segundo-factor", { codigo: c }); alAvanzar(); });
  return (
    <Marco titulo="Verificación en dos pasos">
      {!recuperacion ? (
        <>
          <Text size="sm">Escribe el código de 6 dígitos de tu app (Google o Microsoft Authenticator).</Text>
          <Center><PinInput length={6} type="number" oneTimeCode autoFocus value={codigo} onChange={setCodigo} onComplete={mandar} /></Center>
        </>
      ) : (
        <TextInput label="Código de recuperación" value={codigo} onChange={(e) => setCodigo(e.currentTarget.value)} />
      )}
      {error && <Alert color="red">{error}</Alert>}
      <Button loading={cargando} onClick={() => mandar(codigo)}>Verificar</Button>
      <Anchor component="button" size="sm" onClick={() => { setRecuperacion(!recuperacion); setCodigo(""); }}>
        {recuperacion ? "Usar el código de la app" : "Perdí mi celular: usar un código de recuperación"}
      </Anchor>
      {children}
    </Marco>
  );
}

export function CambiarPassword({ alTerminar }: { alTerminar: () => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const { error, cargando, enviar } = useEnvio();
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (nueva !== confirmar) return; enviar(async () => {
      await POST("/api/auth/cambiar-password", { actual, nueva });
      alTerminar();
    }); }}>
      <Stack>
        <PasswordInput label="Contraseña actual" value={actual} onChange={(e) => setActual(e.currentTarget.value)} autoComplete="current-password" required />
        <PasswordInput label="Nueva contraseña" description="Mínimo la longitud configurada, con letras y números, sin tu usuario." value={nueva} onChange={(e) => setNueva(e.currentTarget.value)} autoComplete="new-password" required />
        <PasswordInput label="Confirma la nueva contraseña" value={confirmar} onChange={(e) => setConfirmar(e.currentTarget.value)} autoComplete="new-password" required
          error={confirmar && nueva !== confirmar ? "No coincide" : undefined} />
        {error && <Alert color="red">{error}</Alert>}
        <Button type="submit" loading={cargando}>Cambiar contraseña</Button>
      </Stack>
    </form>
  );
}

export function ActivarTotp({ obligatorio, alTerminar, children }: { obligatorio?: boolean; alTerminar: () => void; children?: React.ReactNode }) {
  const [datos, setDatos] = useState<{ qr: string; secreto: string } | null>(null);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [codigo, setCodigo] = useState("");
  const { error, cargando, enviar } = useEnvio();
  useEffect(() => {
    enviar(async () => setDatos(await POST("/api/auth/totp-iniciar")));
  }, []);
  const contenido = codigos ? (
    <>
      <Alert color="green">Doble factor activado.</Alert>
      <Text size="sm" fw={600}>Guarda estos 10 códigos de recuperación en un lugar seguro. Cada uno sirve una sola vez si pierdes el celular. No se volverán a mostrar.</Text>
      <SimpleGrid cols={2}>{codigos.map((c) => <Code key={c}>{c}</Code>)}</SimpleGrid>
      <Button onClick={alTerminar}>Ya los guardé, continuar</Button>
    </>
  ) : (
    <>
      {obligatorio && <Alert color="orange">Tu puesto exige verificación en dos pasos. Actívala para continuar.</Alert>}
      <List size="sm" type="ordered">
        <List.Item>Instala Google Authenticator o Microsoft Authenticator en tu celular.</List.Item>
        <List.Item>En la app, agrega una cuenta escaneando este código.</List.Item>
        <List.Item>Escribe el código de 6 dígitos que te muestra.</List.Item>
      </List>
      {datos && <Center><Image src={datos.qr} w={200} h={200} alt="Código QR" /></Center>}
      {datos && <Text size="xs" c="dimmed">¿No puedes escanear? Clave manual: <Code>{datos.secreto}</Code></Text>}
      <Center><PinInput length={6} type="number" oneTimeCode value={codigo} onChange={setCodigo} /></Center>
      {error && <Alert color="red">{error}</Alert>}
      <Button loading={cargando} onClick={() => enviar(async () => setCodigos((await POST("/api/auth/totp-confirmar", { codigo })).codigos_recuperacion))}>Activar</Button>
    </>
  );
  return obligatorio ? <Marco titulo="Activa la verificación en dos pasos">{contenido}{children}</Marco> : <Stack>{contenido}</Stack>;
}

export function ActivarCuenta() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [listo, setListo] = useState<string | null>(null);
  const { error, cargando, enviar } = useEnvio();
  return (
    <Marco titulo="Activa tu usuario">
      {listo ? (
        <>
          <Alert color="green">{listo}</Alert>
          <Button component="a" href="/">Ir a iniciar sesión</Button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (password !== confirmar) return; enviar(async () => setListo((await POST("/api/auth/activar", { token, password })).mensaje)); }}>
          <Stack>
            <Text size="sm">Define tu contraseña. Debe tener letras y números y no contener tu usuario.</Text>
            <PasswordInput label="Contraseña" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="new-password" required />
            <PasswordInput label="Confirma la contraseña" value={confirmar} onChange={(e) => setConfirmar(e.currentTarget.value)} autoComplete="new-password" required
              error={confirmar && password !== confirmar ? "No coincide" : undefined} />
            {error && <Alert color="red">{error}</Alert>}
            <Button type="submit" loading={cargando} disabled={!token}>Activar</Button>
          </Stack>
        </form>
      )}
    </Marco>
  );
}

export function Instalacion() {
  const [clave, setClave] = useState("");
  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [enlace, setEnlace] = useState<string | null>(null);
  const { error, cargando, enviar } = useEnvio();
  return (
    <Marco titulo="Instalación: primer administrador">
      {enlace ? (
        <>
          <Alert color="green">Administrador creado. Abre este enlace para definir su contraseña (vence según la configuración):</Alert>
          <Anchor href={enlace} style={{ wordBreak: "break-all" }}>{enlace}</Anchor>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); enviar(async () => setEnlace((await POST("/api/instalacion", { clave, usuario, nombre })).enlace)); }}>
          <Stack>
            <Text size="sm">Solo funciona una vez, cuando el sistema no tiene usuarios. La clave es la variable CLAVE_INSTALACION configurada en Netlify.</Text>
            <PasswordInput label="Clave de instalación" value={clave} onChange={(e) => setClave(e.currentTarget.value)} required />
            <TextInput label="Usuario del administrador" value={usuario} onChange={(e) => setUsuario(e.currentTarget.value.toLowerCase())} required />
            <TextInput label="Nombre completo" value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} required />
            {error && <Alert color="red">{error}</Alert>}
            <Button type="submit" loading={cargando}>Crear administrador</Button>
          </Stack>
        </form>
      )}
    </Marco>
  );
}
