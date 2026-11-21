import { createContext, useContext } from "react";

export interface Yo {
  ambiente: string | null;
  etapa: "completa" | "segundo_factor" | "enrolar_totp" | "cambiar_password";
  usuario: { id: string; usuario: string; nombre: string; puesto: string; es_prueba: boolean; totp_activo: boolean; tiene_pin: boolean; requiere2fa: boolean };
  roles: { clave: string; nombre: string }[];
  permisos: string[];
  alcance: { todas: boolean; sucursales: string[]; almacenes: string[] };
  sesion: { tipo: string; caja_id: string | null };
}

export const ContextoSesion = createContext<{ yo: Yo; recargar: () => void } | null>(null);

export function useSesion() {
  const c = useContext(ContextoSesion);
  if (!c) throw new Error("Sin sesión");
  const puede = (...permisos: string[]) => permisos.some((p) => c.yo.permisos.includes(p));
  return { ...c, puede };
}
