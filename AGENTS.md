# AGENTS.md — Instrucciones para el agente implementador

## Antes de escribir una sola línea

1. Lee **`SPEC.md` entero**. No por secciones según haga falta: entero, una vez, antes de empezar.
2. Lee el issue de la fase en la que trabajas.
3. Si algo del SPEC te parece ambiguo, contradictorio o equivocado: **para y pregunta.**
   No lo resuelvas por tu cuenta.

`SPEC.md` es la fuente de verdad. Si un issue lo contradice, manda el SPEC y hay que avisar.

---

## Reglas que no se negocian

### 1. Nunca `UPDATE` ni `DELETE` sobre `movements`
El ledger es append-only. Corregir = insertar el movimiento inverso. Esto es lo que hace que la
sincronización entre dos dispositivos funcione sin resolver conflictos. Romperlo rompe el
proyecto entero, y lo hace de forma silenciosa.

### 2. Ningún movimiento se crea fuera de `shared/factory.ts`
Ni en la UI, ni en el Worker, ni en los tests, ni "solo para probar". La factory es lo único que
garantiza que `quantity` y `delta` sean coherentes.

### 3. `/shared` es TypeScript puro
Sin React, sin Dexie, sin APIs de Cloudflare, sin `window`, sin `localStorage`. Si necesitas algo
del entorno, el diseño está mal: pásalo como parámetro.
Prueba: `/shared` debe testearse con `vitest` sin un solo mock.

### 4. Los tests del SPEC §14 son parte del Definition of Done
No son opcionales ni "para después". Una fase sin sus tests no está terminada.

### 5. No añadas funcionalidades que no estén en el SPEC
Ni aunque parezcan obvias, útiles o de dos minutos. El alcance está deliberadamente recortado
porque hay una fecha límite dura. Si crees que falta algo, dilo; no lo implementes.

### 6. Una fase cada vez, en orden
No adelantes trabajo de fases posteriores. El orden del SPEC §15 está pensado para que el riesgo
salga pronto.

---

## Trampas conocidas

Errores que ya se han identificado en el diseño. Cada uno produce un fallo **silencioso**:
nada peta, los datos simplemente quedan mal.

| Trampa | Regla correcta |
|---|---|
| Cursor de sync | Guardar el `seq` máximo **de las filas recibidas**, nunca el máximo global. Con paginación, el global se salta filas para siempre |
| Orden en el sync | Insertar lo remoto **antes** de marcar lo local. Al revés se pierden filas irrecuperablemente |
| Agrupar por día | Siempre en JS con `Intl`, nunca aritmética sobre epoch. Marzo y octubre tienen días de 23 y 25 horas |
| Día en curso | Excluirlo del cálculo de consumo. A las 10:00 llevas 2 pañales y hundirías la media |
| Días sin registro | **No** rellenar con 0. Un bebé nunca gasta 0 pañales en un día: es dato ausente |
| Pañales externos | `delta = 0` pero `quantity = 1`. Cuentan en historial, no en stock, no en forecast |
| Ajustes | Guardan una **diferencia**, no un valor absoluto. Deshacer revierte el delta, no restaura el número anterior |
| Consumo por talla | **No.** Se agrega por bebé. Por talla, la app queda ciega justo al cambiar de talla |
| Bloqueo de compra | Nunca aplica si quedan ≤ 7 días. Es la regla que evita dejar a alguien sin pañales |
| IDs | UUID generados en cliente, nunca autoincrementales |
| Segundo dispositivo | Sin `Baby` local, **sincronizar antes de ofrecer onboarding** (SPEC §9.7). Si no, se crea un bebé duplicado |

---

## Convenciones

- **Código, identificadores y comentarios en inglés.** Textos de la interfaz en español.
- **Arrow functions siempre que sea posible**: `const f = () => {}` en vez de `function` declarations. Las clases Dexie y los métodos de objeto son la única excepción natural.
- Fechas: `Instant` como epoch ms en almacenamiento; `'YYYY-MM-DD'` para días lógicos.
- Nada de `any`. Si un tipo se resiste, dilo.
- Commits pequeños, uno por tarea del issue.
- Secretos en variables de entorno. **Nunca en git**, ni en un commit que luego se revierte.

---

## Cómo reportar

Al terminar una fase:

1. Qué se ha implementado, contra las casillas del issue
2. Qué tests pasan
3. **Qué decisiones has tomado que no estaban en el SPEC** — esto es lo más importante que
   puedes reportar
4. Qué has visto que convendría cambiar en el SPEC

Si te bloqueas más de un par de intentos con algo, para y pregunta en vez de seguir probando.

---

## La puerta de la fase 1

Al terminar la fase 1 hay una prueba de aceptación obligatoria:

> Instalar la PWA → modo avión → abrir → registrar 3 pañales → cerrar del todo → reabrir →
> los datos siguen ahí.

**No sigas a la fase 2 sin haberla pasado.** Si falla, repórtalo inmediatamente: el proyecto
entero depende de que la app funcione sin conexión, y hay que replantear el enfoque antes de
construir más encima.
