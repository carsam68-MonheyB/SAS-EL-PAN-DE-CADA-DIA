// Error de negocio con estado HTTP y mensaje en español para el usuario.
export class ErrorApp extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly detalles?: unknown,
  ) {
    super(mensaje);
  }
}

export const noAutenticado = (m = "Inicia sesión para continuar.") => new ErrorApp(401, "no_autenticado", m);
export const prohibido = (m = "No tienes permiso para esta operación.") => new ErrorApp(403, "prohibido", m);
export const noEncontrado = (m = "No se encontró el registro.") => new ErrorApp(404, "no_encontrado", m);
export const invalido = (m: string, detalles?: unknown) => new ErrorApp(400, "invalido", m, detalles);
export const conflicto = (m: string, detalles?: unknown) => new ErrorApp(409, "conflicto", m, detalles);
