# Contribuir a Cacotas

Gracias por contribuir a Cacotas.

## Antes de empezar

Lee:

1. `README.md`
2. `docs/desarrollo.md`
3. `docs/arquitectura.md`
4. `SPEC.md`
5. `AGENTS.md`

`SPEC.md` es la fuente de verdad funcional y técnica del proyecto.

## Flujo recomendado

1. Crea una rama desde `master`.
2. Trabaja en una tarea concreta.
3. Añade tests.
4. Ejecuta lint, typecheck, tests y build.
5. Incrementa la versión.
6. Abre una Pull Request.
7. Espera a que el CI quede en verde.
8. Revisa el diff final.
9. Fusiona en `master`.

## Regla de versión

Cada commit que llegue a `master` debe llevar un incremento de versión minor o fix.

Por tanto, una PR que vaya a generar un único commit en `master` debe dejar `package.json` con una versión superior a la de origen.

## Código

- TypeScript estricto.
- Sin `any`.
- Dependencias con versiones exactas.
- Código e identificadores en inglés.
- Interfaz en español.
- Sin lógica de entorno dentro de `shared/`.

## Datos

El ledger de movimientos es append-only.

No actualices ni borres movimientos existentes. Usa la factory y movimientos inversos para corregir.

## Tests obligatorios

Una modificación no está terminada si falla cualquiera de:

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:worker
pnpm test
pnpm build
```

## Documentación

Toda documentación nueva destinada a usuarios, administradores o colaboradores debe escribirse en español.

Cuando cambie el comportamiento documentado de Cacotas, actualiza la documentación correspondiente en la misma PR.
