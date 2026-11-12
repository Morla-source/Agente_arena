# TU-95 BEAR — Simulador de vuelo 2D

Simulador del bombardero pesado turbohélice soviético Tupolev Tu-95, inspirado en el
clásico juego Flash *TU-95*. **Un único archivo `index.html`**: sin dependencias, sin
imágenes y sin archivos de sonido. Todo lo que se ve está dibujado con Canvas 2D y todo
lo que se oye está sintetizado con la Web Audio API.

```
Abrir index.html con doble clic  →  juega.
O servir la carpeta:  python3 -m http.server 8080
```

---

## Controles

| Tecla | Acción |
| --- | --- |
| `W` / `S` (o `↑` / `↓`) | Potencia de los cuatro motores (0-100 %, con inercia de 1,5 s) |
| `A` / `D` (o `←` / `→`) | Cabeceo: `A` levanta el morro, `D` lo baja (invertible en el menú) |
| `F` | Flaps: `TAKEOFF` → `NEUTRAL` → `LANDING` |
| `G` | Tren de aterrizaje (tarda 2 s, con aviso luminoso) |
| `ESPACIO` | En el aire suelta bombas · en tierra abre el paracaídas de frenado y frena |
| `B` | Compuerta de la bahía de bombas |
| `H` | Eyección de emergencia |
| `P` / `ESC` | Pausa con guía rápida |
| `R` | Reiniciar la misión |
| `M` | Silenciar el audio |

Los frenos de rueda se sueltan solos al pasar del 25 % de potencia y se fijan al detenerse.

## Campaña (6 misiones, desbloqueo progresivo)

1. **Vuelo de prueba** — 45 km, tutorial guiado por radio: despegar, subir a 4 000 m y tomar tierra.
2. **Crucero de largo alcance** — 110 km árticos: régimen económico (NEUTRAL, 55-85 %) para no quedarse seco.
3. **Bombardeo estratégico** — 85 km, ocho FAB-900 sobre el polígono marcado, con caída parabólica real.
4. **Tormenta en el Atlántico Norte** — 90 km con rachas, cizalladura, lluvia y relámpagos.
5. **Emergencia en el aire** — a los 38 km se incendian dos motores: potencia limitada al 55 % y planeo hasta Chita.
6. **Operación Trueno** — 130 km, cinturón de artillería antiaérea, base enemiga que destruir y pista de 1 400 m.

## Modelo de vuelo

Unidades SI internas (metros, segundos, newtons, kilogramos); la cabina muestra km/h y metros.

```
Empuje    T = mín( MAX_THRUST·f ,  MAX_POWER·η·f / V )     f = (throttle/100)·salud·factorAltitud
Susten.   L = ½·ρ·V²·S·CL · multiplicadorFlaps             CL = CL₀ + CLα·α ,  α = cabeceo − trayectoria
Resist.   D = ½·ρ·V²·S·CD                                  CD = CD₀ + CDflaps + CDtren + CDα·|α| + CDmach·(V/Vref)²
Peso      W = masa·g                                       ρ(h) = ρ₀·e^(−h/8500)
```

* El empuje está limitado por la **potencia** del turbohélice (T ≈ P·η/V), como en un NK-12 real:
  empuje enorme en la carrera de despegue y decreciente en altitud, lo que fija el techo en ~12 000 m.
* La **pérdida** entra por ángulo de ataque (CL crítico, con bonus según flaps) y avisa por velocidad;
  al entrar, la sustentación cae y el morro pica solo.
* En tierra hay rodadura, frenos y paracaídas; la toma se evalúa en `Aircraft.touchdown()`.

### Reglas de toma (todo lo demás es `¡DESASTRE!`)

| Condición | Resultado |
| --- | --- |
| Tren arriba (`gear < 0.98`) | Destrucción inmediata |
| Descenso > 7 m/s | Colapso del tren |
| Cabeceo < −5° | Impacto de proa |
| Cabeceo > +15° | *Tailstrike* |
| Fuera de la pista o pasado el final | Destrucción |
| Tren abajo, −1…−5 m/s y morro entre 0 y 10° | Toma perfecta |

Las constantes físicas viven todas en el bloque `CONFIG`, al principio del `<script>`.

## Estructura del archivo

Todo en `index.html`, organizado en secciones comentadas dentro del único `<script>`:

| Sección | Contenido |
| --- | --- |
| `01. CONFIG` | Constantes físicas calibrables |
| `02. UTIL` | Matemáticas, RNG con semilla (terreno y nubes), almacenamiento |
| `03. AudioEngine` | 4 motores sintetizados, viento, alarmas STALL/GPWS, impactos |
| `04. Aircraft` | Estado, aerodinámica, flaps, tren, bombas, daño, eyección |
| `05. MissionManager` | 6 misiones, radio de torre, objetivos, terreno, viento, flak |
| `06. Renderer` | Cámara con zoom dinámico, cielo, nubes en paralaje, terreno, pistas, avión articulado, partículas |
| `07. HUD` | Instrumentos de cabina (canvas) y barra de ruta superior |
| `08. GameLoop` | Bucle a `dt` fijo (1/120 s), máquina de estados, teclado, menús |

## Banco de pruebas

`tools/headless-test.mjs` extrae el `<script>` de `index.html`, lo ejecuta en Node con stubs
de DOM/Canvas/Web Audio y **pilota el avión real** (mismo `Aircraft`, mismo `MissionManager`,
mismo `Game.stepFixed` que usa el bucle del juego):

```
node tools/headless-test.mjs      # 48 comprobaciones
```

Cubre: carrera de despegue y velocidad de rotación, ascenso a 8 000 m, crucero al 70 %
(799 km/h) y velocidad máxima al 100 % (887 km/h), consumo, pérdida y recuperación,
aproximación y toma completas hasta `VICTORY`, las cinco causas de desastre, el bombardeo
parabólico, el fallo de dos motores con límite al 55 %, el techo de vuelo, la falta de
combustible, la artillería antiaérea, la eyección, y la ejecución sin errores de todo el
código de dibujo y del sintetizador.

## Créditos

Juego original de este repositorio: **Órbita Cero** (shooter espacial), conservado en
[`archive/orbita-cero.html`](archive/orbita-cero.html).
