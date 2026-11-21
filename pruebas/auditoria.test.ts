import { beforeAll, describe, it, expect } from "vitest";
import type pg from "pg";
import { baseLimpia } from "./apoyo";
import { enTransaccion } from "../src/servidor/transaccion";

let pool: pg.Pool;
beforeAll(async () => { pool = await baseLimpia("erp_prueba_auditoria"); });

describe("bitácora de auditoría", () => {
  it("registra usuario, valor anterior y nuevo, sin secretos", async () => {
    const actor = (await pool.query("INSERT INTO usuario (usuario, nombre, puesto) VALUES ('actor', 'Actor', 'x') RETURNING id")).rows[0].id;
    const id = await enTransaccion(actor, async (c) =>
      (await c.query("INSERT INTO usuario (usuario, nombre, puesto, hash_password) VALUES ('ana', 'Ana', 'Cajera', 'SECRETO') RETURNING id")).rows[0].id);
    await enTransaccion(actor, (c) => c.query("UPDATE usuario SET nombre = 'Ana López' WHERE id = $1", [id]));
    const { rows } = await pool.query("SELECT * FROM bitacora_auditoria WHERE tabla = 'usuario' AND registro_id = $1 ORDER BY id", [id]);
    expect(rows.map((r) => r.operacion)).toEqual(["INSERT", "UPDATE"]);
    expect(rows[1].usuario_id).toBe(actor);
    expect(rows[1].antes.nombre).toBe("Ana");
    expect(rows[1].despues.nombre).toBe("Ana López");
    expect(JSON.stringify(rows)).not.toContain("SECRETO");
    expect(rows[1].actualizado_por ?? rows[1].despues.actualizado_por).toBe(actor);
  });

  it("no se puede editar, borrar ni vaciar", async () => {
    await expect(pool.query("UPDATE bitacora_auditoria SET tabla = 'x'")).rejects.toThrow(/solo inserción/);
    await expect(pool.query("DELETE FROM bitacora_auditoria")).rejects.toThrow(/solo inserción/);
    await expect(pool.query("TRUNCATE bitacora_auditoria")).rejects.toThrow(/solo inserción/);
    await pool.query("INSERT INTO bitacora_acceso (evento, exito) VALUES ('prueba', true)");
    await expect(pool.query("DELETE FROM bitacora_acceso")).rejects.toThrow(/solo inserción/);
    await expect(pool.query("UPDATE bitacora_acceso SET exito = false")).rejects.toThrow(/solo inserción/);
  });

  it("un usuario no se borra: se da de baja", async () => {
    await expect(pool.query("DELETE FROM usuario WHERE usuario = 'ana'")).rejects.toThrow(/solo inserción/);
  });

  it("la cadena de hashes detecta alteraciones hechas por fuera del sistema", async () => {
    expect((await pool.query("SELECT bitacora_auditoria_verificar() r")).rows[0].r).toBeNull();
    // Simula a alguien con acceso directo que desactiva el candado y altera un renglón.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE bitacora_auditoria DISABLE TRIGGER bitacora_auditoria_inmutable");
      await c.query("UPDATE bitacora_auditoria SET despues = jsonb_set(despues, '{nombre}', '\"Otro\"') WHERE id = (SELECT min(id) FROM bitacora_auditoria)");
      const roto = (await c.query("SELECT bitacora_auditoria_verificar() r")).rows[0].r;
      expect(roto).not.toBeNull();
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
});

describe("transacciones", () => {
  it("si algo falla no queda nada a medias", async () => {
    const antes = (await pool.query("SELECT count(*)::int n FROM usuario")).rows[0].n;
    await expect(enTransaccion(null, async (c) => {
      await c.query("INSERT INTO usuario (usuario, nombre, puesto) VALUES ('temporal', 'T', 'x')");
      await c.query("INSERT INTO usuario (usuario, nombre, puesto) VALUES ('temporal', 'T', 'x')"); // duplicado
    })).rejects.toThrow();
    expect((await pool.query("SELECT count(*)::int n FROM usuario")).rows[0].n).toBe(antes);
  });
});
