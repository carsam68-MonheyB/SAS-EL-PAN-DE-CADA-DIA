import { useState } from "react";
import { Alert, Button, Card, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { POST, textoError } from "../api";
import { useSesion } from "../sesion";
import { ActivarTotp, CambiarPassword } from "./Acceso";

export function MiCuenta() {
  const { yo, recargar, puede } = useSesion();
  const [ok, setOk] = useState<string | null>(null);
  const [activando, setActivando] = useState(false);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Stack maw={520}>
      <Title order={2}>Mi cuenta</Title>
      {ok && <Alert color="green" withCloseButton onClose={() => setOk(null)}>{ok}</Alert>}
      <Card withBorder>
        <Title order={4} mb="sm">Cambiar contraseña</Title>
        <CambiarPassword alTerminar={() => { setOk("Contraseña cambiada. Se cerraron tus otras sesiones."); recargar(); }} />
      </Card>
      <Card withBorder>
        <Title order={4} mb="sm">Verificación en dos pasos</Title>
        {yo.usuario.totp_activo ? <Text size="sm">Activada. Si cambias de celular, pide al administrador que la restablezca.</Text>
          : activando ? <ActivarTotp alTerminar={() => { setActivando(false); recargar(); }} />
          : <Button variant="light" onClick={() => setActivando(true)}>Activar verificación en dos pasos</Button>}
      </Card>
      {puede("pos.ventas:crear", "pos.devoluciones:autorizar", "pos.caja:autorizar", "pos.caja:cerrar", "pos.pedidos:autorizar", "pos.descuentos:autorizar", "pos.pedidos_sin_anticipo:autorizar") && (
        <Card withBorder>
          <Title order={4} mb="sm">PIN de cajero</Title>
          <Text size="sm" mb="sm">Lo usas para tomar la caja sin cerrar la sesión del turno o para autorizar en la caja (descuentos, devoluciones, cortes). {yo.usuario.tiene_pin ? "Ya tienes un PIN definido." : "Aún no tienes PIN."}</Text>
          <Stack>
            <PasswordInput label="Tu contraseña" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <PasswordInput label="Nuevo PIN" value={pin} onChange={(e) => setPin(e.currentTarget.value.replace(/\D/g, ""))} inputMode="numeric" />
            {error && <Alert color="red">{error}</Alert>}
            <Button onClick={() => POST("/api/auth/mi-pin", { password, pin }).then(() => { setOk("PIN actualizado."); setPin(""); setPassword(""); setError(null); recargar(); }).catch((e) => setError(textoError(e)))}>Guardar PIN</Button>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
