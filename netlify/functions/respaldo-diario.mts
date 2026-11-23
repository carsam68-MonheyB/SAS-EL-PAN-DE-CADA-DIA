// Proceso programado de respaldos (una vez al día, 6:15 hora del centro de
// México, cuando la base ya está despierta por la producción). El día 1 hace el
// respaldo mensual; además procesa los respaldos de cada cierre contable y
// archiva los XML nuevos. No tiene ruta pública: solo lo dispara Netlify.
import type { Config } from "@netlify/functions";
import { hoyNegocio } from "../../src/servidor/fechas";
import { procesoDiario } from "../../src/servidor/respaldo";
import { enTransaccion } from "../../src/servidor/transaccion";

export default async () => {
  const hoy = await enTransaccion(null, (c) => hoyNegocio(c));
  const r = await procesoDiario(hoy);
  console.log("respaldo diario", JSON.stringify(r.map((x) => ({ id: x.id, estatus: x.estatus }))));
};

export const config: Config = { schedule: "15 12 * * *" };
