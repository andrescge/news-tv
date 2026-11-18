# Auditoría de NEWS·TV: fuentes y diseño

Fecha: 17 de noviembre de 2026 · Rama auditada: `claude/doctor-prompt-audit-54116c` (igual a `main` en código) · No se modificó ningún archivo de código.

## Resumen

1. **Finextra devuelve HTTP 403 desde el 14 de noviembre** en sus tres feeds. Pagos y Cripto siguen mostrando sus notas antiguas sin ninguna marca; cuando caduquen (30 días), Pagos dependerá solo de PYMNTS y Cripto solo de Chainalysis, que es el blog de un proveedor.
2. **El canal Autoridades EC casi no tiene noticias regulatorias.** 9 de sus 11 entradas son publicaciones de datos del BCE (boletines semanales), mientras que las resoluciones de la Junta aparecen en el canal Ecuador financiero. Las rutas de Superbancos y Supercias vía Google News dan 0 resultados.
3. **Fintech LATAM repite la misma operación hasta tres veces** (Cocos, Akua, Palomma, Nexu, Clara), porque la deduplicación solo compara dentro del mismo medio.
4. **En pantalla, un titular largo se corta y no hay dónde leerlo entero** si la nota no trae extracto; eso afecta a 28 de 81 notas.
5. **Un fallo de carga se presenta como «Sin noticias»**, y el rótulo «EN VIVO» permanece encendido aunque la edición tenga horas o las fuentes estén caídas.

## Alcance y evidencia

Archivos revisados: `scripts/collect.mjs`, `scripts/content.mjs`, `scripts/validate.mjs`, `site/index.html`, `site/app.js`, `site/styles.css`, `site/data/news.json`, `README.md` y el workflow.

Datos usados:

| Evidencia | Qué es |
| --- | --- |
| Semilla en `main` | `site/data/news.json`, generada el 29 de septiembre: 57 notas, 11 fuentes |
| Edición en vivo | `news.json` de la rama `data`, generada el 17 de noviembre a las 22:24 UTC: 83 notas, 17 fuentes |
| Recolección fresca | `node scripts/collect.mjs --output <temporal>` ejecutado para esta auditoría: 81 notas, 14 de 17 fuentes respondieron |
| Contraste | Razones WCAG calculadas a partir de los colores de `site/styles.css` |
| Feeds candidatos | Una petición HTTP por feed, contando entradas; no evalúa calidad del contenido |

Límites de la auditoría:

- La valoración editorial de cada medio se basa en conocimiento general del medio y en los titulares de la edición, no en un estudio de propiedad o financiación.
- No se probó la interfaz en un navegador ni con lector de pantalla; los hallazgos de UX salen de leer el código y calcular contraste.
- El 403 de Finextra se reprodujo desde esta máquina incluso con otro User-Agent, así que no se sabe si el bloqueo es por agente, por IP o general.

---

## Parte 1: Fuentes de noticias

### Inventario

`SOURCES` en `scripts/collect.mjs` (líneas 8–26) tiene 17 entradas con cuatro adaptadores:

- `rss` (8): SEPS, LatamList, iupana, Finextra ×3, PYMNTS, Chainalysis.
- `google` (6): búsquedas RSS de Google News filtradas por `allowHosts`.
- `bce` (2) y `bce-publications` (1): páginas HTML del BCE leídas con selectores.

Estado en la recolección fresca:

| Canal | Notas | Sin extracto | En inglés | Últimos 7 días | Últimas 24 h |
| --- | --- | --- | --- | --- | --- |
| Ecuador financiero | 10 | 4 | 0 | 3 | 1 |
| Autoridades EC | 11 | 10 | 0 | 3 | 1 |
| Fintech LATAM | 25 | 14 | 9 | 18 | 5 |
| Pagos globales | 17 | 0 | 17 | 17 | 5 |
| Cripto | 18 | 0 | 18 | 3 | 1 |

La vista abre en 7 días, así que tres de los cinco canales arrancan con tres notas en bucle.

### Hallazgos transversales

**Google News como intermediario.** Seis de las 17 fuentes pasan por Google News y 19 de 81 notas enlazan a `news.google.com/rss/articles/...` en vez de al medio.

- Esas notas llegan sin extracto, porque `normalize` descarta el extracto cuando repite el titular (`content.mjs:53`).
- El orden y la selección dependen de un ranking que el proyecto no controla.
- Superbancos y Supercias se etiquetan `kind: 'official'` aunque el contenido llega a través del índice de Google, no del sitio oficial.

**Deduplicación solo dentro del mismo medio.** `deduplicate` usa como clave `categoría + URL` o `categoría + medio + titular` (`content.mjs:101-102`). Dos medios que cubren la misma ronda no coinciden en ninguna. En la edición fresca de Fintech LATAM:

- Cocos (ronda de US$34M): LatamList, Latam Fintech Hub y dos notas de Bloomberg Línea.
- Akua, Palomma, Nexu: LatamList y Latam Fintech Hub.
- Clara: LatamList y Finextra.

**Fuentes caídas sin marca en las notas.** Cuando una fuente falla, el recopilador conserva sus notas anteriores (`collect.mjs:54`), pero la nota no lleva ningún indicador. El estado solo se ve dentro del panel Fuentes.

**Filtros temáticos desiguales.** `relevant()` tiene una rama por fuente y devuelve `true` si no hay rama (`content.mjs:123`). Chainalysis, BCE boletines, BCE Junta y Finextra Payments no tienen filtro de tema. Otros filtros son tan amplios que casi no filtran:

- `ecuador-news` acepta «pago», «economía», «dólar» en titular o extracto. En la semilla entraron «Pacientes renales en Ecuador: dializadora exige un acuerdo de pagos» y «Devolución del IVA en Ecuador».
- `seps`, `superbancos`, `supercias` aceptan «control», «ley», «cooperativas», «seguros».
- `latam-bloomberg` acepta «billetera» y dejó pasar «ChatGPT podrá comprar por usted usando su tarjeta», que no es una noticia de LATAM.
- `finextra-crypto` busca en el extracto y dejó pasar «India's NPCI creates tech and innovation unit».

**La documentación de fuentes existe en cuatro copias.** `SOURCES`, la tabla del `README.md`, la lista de criterios en `site/index.html` (líneas 58–63) y los `channels` de `site/app.js`. Ninguna se genera a partir de otra.

**La semilla de `main` está desfasada.** Tiene 11 fuentes y 57 notas, todas con más de 30 días. Quien sirva `site/` en local sin ejecutar `npm run collect` verá cinco canales vacíos.

### Tabla de fuentes

| Fuente | Veredicto | Riesgos | Evidencia en código | Recomendación / Reemplazo |
| --- | --- | --- | --- | --- |
| **Banco Central del Ecuador** (`bce-boletines`, CH01) | Recomendada | Es comunicación institucional: incluye autopromoción («amplía proyección internacional de su revista»). Lectura por selectores de Elementor, frágil ante un rediseño. | `parseBce` (`content.mjs:74-84`); sin rama en `relevant`; etiquetada `official`. | Mantener. Las notas sobre la JPRFM deberían ir a Autoridades EC (ver fila siguiente). |
| **BCE · Junta Financiera** (`bce-junta`, CH02) | Recomendada, pero hoy no aporta | 0 entradas en la semilla y en la recolección fresca. Las resoluciones de la Junta («nuevas reglas para los pagos con tarjetas», «diferimiento temporal de obligaciones») sí aparecen, pero en `bce-boletines` y por tanto en CH01. | Misma función `parseBce`; `recentCount: 0` en ambas ediciones. | Comprobar si la página sigue publicando. Si no, enrutar a CH02 los boletines de `bce-boletines` cuyo titular mencione JPRFM o Junta. |
| **BCE · Datos financieros** (`bce-publicaciones`, CH02) | Usar con contexto/etiqueta | No son noticias: son publicaciones periódicas («Boletín Monetario Semanal. 13 de Noviembre 2026»). Ocupan 9 de 11 entradas del canal, sin extracto, y enlazan a PDF. | `parseBcePublications` (`content.mjs:85-97`); filtro por titular en `content.mjs:109`. | Etiquetar como «DATO OFICIAL», limitar a las 2–3 más recientes o sacarlas a una franja aparte. |
| **SEPS** (`seps`, CH02) | Usar con contexto/etiqueta | Feed oficial directo (bien), pero mezcla regulación con relaciones públicas («Fortalecemos el sector, más de 700 funcionarios…»). 1 entrada. | RSS directo; filtro amplio en `content.mjs:119`. | Mantener. Estrechar el filtro a resolución, norma, intervención, liquidación, sanción y alerta. |
| **Superintendencia de Bancos** (`superbancos`, CH02) | Reemplazar | 0 resultados en ambas ediciones. Marcada `official` aunque llega vía Google News. | `adapter: 'google'`, consulta `site:superbancos.gob.ec` (`collect.mjs:14`). | Feed directo: `https://www.superbancos.gob.ec/bancos/feed/` respondió con 10 entradas. |
| **Supercias** (`supercias`, CH02) | Reemplazar | 0–1 resultados. Mismo problema de etiqueta. | `adapter: 'google'`, consulta `site:supercias.gob.ec` (`collect.mjs:15`). | Leer directamente la página de noticias de supercias.gob.ec con un adaptador como el del BCE. No encontré feed (la ruta probada dio 404). |
| **Cobertura de autoridades EC** (`regulatory-news`, CH02) | Usar con contexto/etiqueta | 1 entrada, y es la misma nota de El Universo que ya está en CH01 (duplicado entre canales comprobado). Es periodismo de servicio («¿Cuáles son las cooperativas autorizadas?»), no cobertura regulatoria. | Consulta Google con seis `allowHosts` (`collect.mjs:16`); filtro por titular en `content.mjs:110`. | Mantener como complemento cuando CH02 tenga fuentes oficiales directas. Excluir de CH01 lo que entre aquí. |
| **Medios de Ecuador** (`ecuador-news`, CH01) | Usar con contexto/etiqueta | Vía Google News, sin extracto. Predomina el contenido de servicio y SEO de Expreso («¿Cuánto rinde invertir en pólizas…?», «¿Quieres pedir un crédito?»). Filtro temático demasiado amplio. | Consulta fija y `allowHosts` de cuatro medios (`collect.mjs:9`); filtro en `content.mjs:122`. | Expreso tiene feed directo de economía (`https://www.expreso.ec/rss/economia.xml`, 20 entradas). Para Primicias y El Universo no encontré feed (404 en las rutas probadas): mantener Google News solo para ellos. Exigir el término financiero en el titular. |
| **LatamList** (`latamlist`, CH03) | Recomendada | Notas breves de rondas y adquisiciones, cercanas al comunicado. En inglés. Bajo riesgo de desinformación, poco contexto. | RSS directo; filtro en `content.mjs:120`. | Mantener. Es la mejor candidata a «fuente canónica» cuando se deduplique entre medios. |
| **Latam Fintech Hub** (`latam-fintech-hub`, CH03) | Reemplazar la ruta | Vía Google News, sin extracto (8 de 8). Repite las mismas operaciones que LatamList. Medio de nicho con negocio de eventos; el filtro ya tiene que excluir webinars y congresos. | `googleSearch('site:latamfintech.co/articles/')` (`collect.mjs:18`); filtro en `content.mjs:111`. | Contxto (`https://contxto.com/en/feed/`, 100 entradas) como alternativa con feed propio. Si se conserva, hacerlo solo tras deduplicar entre medios. |
| **iupana** (`iupana`, CH03) | Recomendada | Reportería propia sobre tecnología bancaria en LATAM, en español. Poco volumen (2–3 notas). El filtro usa «sofi», que coincide con «Sofipos» por casualidad. | RSS directo; filtro en `content.mjs:112`. | Mantener y darle prioridad en el orden del canal. |
| **Bloomberg Línea · fintech** (`latam-bloomberg`, CH03) | Usar con contexto/etiqueta | Medio de alta autoridad, pero llega vía Google News y sin extracto. Entran notas que no son de LATAM. Dos notas sobre la misma ronda de Cocos. | Consulta con países y términos (`collect.mjs:20`); filtro en `content.mjs:113`. | Feed directo: `https://www.bloomberglinea.com/arc/outboundfeeds/rss/?outputType=xml` respondió con 100 entradas. Filtrar por tema y por país en el titular. |
| **Finextra · LATAM** (`finextra-latam`, CH03) | Eliminar | HTTP 403 desde el 14 de noviembre. Aun funcionando aportaba 1 nota: es el feed de banca minorista global filtrado por nombres de países. | `channel=retail` (`collect.mjs:21`); filtro en `content.mjs:114`. | Quitarla. La cobertura regional la dan mejor LatamList, iupana y Bloomberg Línea. |
| **PYMNTS** (`pymnts`, CH04) | Usar con contexto/etiqueta | Mezcla noticias con piezas de opinión («Stablecoins Are Becoming Commodities…») y con estudios patrocinados de PYMNTS Intelligence. Enfoque estadounidense. | RSS directo; filtro muy amplio («bank», «card») en `content.mjs:121`. | Mantener con etiqueta. Añadir un segundo medio: Payments Dive (`https://www.paymentsdive.com/feeds/news/`, 10 entradas). |
| **Finextra · Payments** (`finextra-payments`, CH04) | Recomendada, pero bloqueada | HTTP 403 desde el 14 de noviembre: 12 de las 17 notas del canal son arrastradas. Sin filtro de tema: entran «Klarna taps… as CFO» y un acuerdo antifraude entre Reino Unido y Camboya. | Solo se exige ruta `/newsarticle/` (`content.mjs:115-116`), que separa bien noticias de comunicados. | Resolver el acceso (el User-Agent actual es `NEWS-TV/1.0`; otro agente también dio 403 desde aquí). Si no se resuelve, reemplazar por Payments Dive. |
| **Finextra · Blockchain** (`finextra-crypto`, CH05) | Recomendada, pero bloqueada | Mismo 403: 8 de 18 notas arrastradas. | Ruta `/newsarticle/` más términos cripto sobre titular y extracto (`content.mjs:117`). | Igual que la anterior. Reemplazo: CoinDesk (`https://www.coindesk.com/arc/outboundfeeds/rss/`, 25 entradas) o The Block (`https://www.theblock.co/rss.xml`, 20). |
| **Chainalysis** (`chainalysis`, CH05) | Usar con contexto/etiqueta | Blog de un proveedor de cumplimiento e investigación: tiene interés comercial en destacar delito cripto y sus propios casos («How Chainalysis Led the Freeze of Nearly $10M»). Sin filtro: entran anuncios de producto («Chainalysis Supports HyperEVM…») y temas ajenos («China's AI Model Distillation Boom»). Aporta 10 de 18 notas. | Sin rama en `relevant`; `kind: 'analysis'`, que la interfaz muestra como «ANÁLISIS SECTORIAL». | Cambiar el rótulo a «BLOG DE EMPRESA». Excluir titulares con «Chainalysis Supports» y limitar a 4–5 notas. Añadir un medio periodístico para equilibrar. |

### Reemplazos y adiciones propuestos

Todos requieren revisar el contenido antes de integrarlos; aquí solo consta que el feed responde.

| Canal | Candidato | Feed | Respuesta | Nota |
| --- | --- | --- | --- | --- |
| CH01 | Expreso (directo) | `expreso.ec/rss/economia.xml` | 200, 20 entradas | Sustituye la vía Google para este medio |
| CH01 | Asobanca | `asobanca.org.ec/feed/` | 200, 4 entradas | Es el gremio bancario: etiquetar como tal, no como noticia |
| CH02 | Superintendencia de Bancos | `superbancos.gob.ec/bancos/feed/` | 200, 10 entradas | Feed oficial directo |
| CH03 | Bloomberg Línea (directo) | `bloomberglinea.com/arc/outboundfeeds/rss/?outputType=xml` | 200, 100 entradas | Feed general: necesita filtro de tema |
| CH03 | Contxto | `contxto.com/en/feed/` | 200, 100 entradas | Startups LATAM, en inglés |
| CH04 | Payments Dive | `paymentsdive.com/feeds/news/` | 200, 10 entradas | Prensa sectorial con redacción propia |
| CH05 | CoinDesk | `coindesk.com/arc/outboundfeeds/rss/` | 200, 25 entradas | Periodismo cripto; volumen alto, necesita filtro |
| CH05 | The Block | `theblock.co/rss.xml` | 200, 20 entradas | Parte del contenido es de pago |
| CH05 | CriptoNoticias | `criptonoticias.com/feed/` | 200, 10 entradas | En español y con foco LATAM, pero tono favorable al sector: usar con etiqueta |

No respondieron con un feed en la ruta probada: Primicias, El Universo, Supercias, Revista Gestión, Latam Fintech Hub, The Paypers, BIS/CPMI y Fintech Futures (403).

---

## Parte 2: Diseño y UX (TV retro)

### Concepto retro frente a legibilidad

La carcasa, la antena, el dial y el altavoz están resueltos con CSS y el concepto se entiende a primera vista. El coste lo paga el texto:

- **Titulares cortados.** El `h1` va a 35–60 px con un máximo de 3 líneas (`styles.css`, regla `.broadcast h1`). Los titulares miden 75 caracteres de media; 24 de 81 pasan de 90 y 8 pasan de 120 (máximo 162). El botón «ABRIR NOTICIA» solo existe si hay extracto (`app.js:57`), así que en las 28 notas sin extracto el titular cortado no se puede leer completo en ningún sitio.
- **Texto secundario diminuto.** De 56 declaraciones `font-size`, 40 son de 8, 9 o 10 px. Fuente, fecha, «Vía Google News», tipo de nota y estado de actualización van a 9–10 px, bajo una capa de líneas de barrido al 54 % de opacidad.
- **El contraste numérico es correcto casi siempre**; el problema es el tamaño. Las excepciones están en la tabla.
- **Dos temas en un mismo archivo.** `styles.css` contiene el tema original de madera y ámbar (líneas 1–13) y encima el de grafito y azul (líneas 15–25) que lo anula regla por regla. La variable `--amber` vale ahora un azul, el anillo de foco sigue siendo ámbar y el favicon usa un tercer esquema (verde azulado y naranja).
- **Lo retro está en el marco, no en el comportamiento.** El dial y el altavoz parecen controles pero no hacen nada.

### Tabla de diseño y UX

Severidad: **Alta** impide leer o usar, o induce a error; **Media** dificulta; **Baja** es pulido.

| Área | Problema | Impacto | Severidad | Componente / Archivo | Recomendación concreta |
| --- | --- | --- | --- | --- | --- |
| Legibilidad | Titular cortado a 3 líneas sin forma de verlo entero cuando no hay extracto | 28 de 81 notas pueden quedar ilegibles; CH02 y CH03 son los más afectados | Alta | `.broadcast h1` en `site/styles.css`; `renderScreen` en `site/app.js:49-58` | Reducir el cuerpo según la longitud (por ejemplo 3 escalones) y subir el límite a 4–5 líneas; permitir abrir el diálogo aunque no haya extracto |
| Estados | Un fallo al cargar `news.json` deja `stories: []` y la pantalla dice «Sin noticias en [canal]… amplía el período» | El usuario cree que no hay noticias cuando en realidad falló la carga; el error real está en una línea de 9 px | Alta | `loadNews` (`app.js:121-124`) y rama vacía de `renderScreen` (`app.js:60-66`) | Estado propio «SIN SEÑAL» en pantalla con botón «Reintentar» |
| Estados | «EN VIVO» y «EN EMISIÓN» están fijos en el HTML | Afirman actualidad con una edición de hasta horas y con fuentes caídas; en un producto de noticias es un problema de honestidad editorial | Alta | `.on-air` y `.screen-brand` en `site/index.html:20,24` | Sustituir por «ACTUALIZADO HACE X MIN» calculado desde `generatedAt` |
| Estados | Las notas arrastradas de una fuente caída no se distinguen | Pagos y Cripto parecen sanos con Finextra bloqueada desde hace días | Alta | `collect.mjs:54`; `renderScreen` | Marcar en `story-meta` «fuente sin respuesta desde [fecha]» usando `sources[].status` |
| Accesibilidad | La reproducción automática no se detiene cuando el foco o el puntero están sobre la noticia | Quien tabula hasta «FUENTE ORIGINAL» puede abrir otra nota porque el enlace cambió bajo el foco | Alta | `tick` (`app.js:126-133`) | Pausar el avance si `.tv-screen` contiene el foco o está bajo el puntero |
| Accesibilidad | `renderChannels` reconstruye los cinco botones en cada render | Al elegir un canal con teclado el foco se pierde; también ocurre cada 10 minutos al recargar datos | Alta | `renderChannels` (`app.js:31-39`), llamado desde `selectChannel` y `loadNews` | Crear los botones una vez y actualizar solo `aria-pressed` y el contador |
| Accesibilidad | `aria-live="off"` en la zona de emisión | Un lector de pantalla no anuncia nada al cambiar de canal o de noticia manualmente | Media | `.broadcast` en `site/index.html:25` | Región `aria-live="polite"` que se actualice solo en cambios manuales, no en el avance automático |
| Accesibilidad | Página en `lang="es"` con dos canales íntegramente en inglés | El lector de pantalla pronuncia los titulares ingleses con voz española; el dato `story.language` ya existe y solo se usa en el diálogo | Media | `renderScreen` (`app.js:52-54`) | Asignar `lang` al titular y al extracto; mostrar una marca «EN» visible |
| Accesibilidad | Atajos de una sola tecla (1–5) sin forma de desactivarlos | Incumple el criterio WCAG 2.1.4 para usuarios de entrada por voz | Media | Manejador `keydown` (`app.js:149-157`) | Opción para desactivar atajos, o exigir que el foco esté dentro del televisor |
| Accesibilidad | Contraste insuficiente en el botón de canal activo: «CH 0X» da 2,84:1 y el contador 3,12:1 sobre la parte oscura del degradado | El canal seleccionado es justo donde peor se lee su número | Media | `.channel-button[aria-pressed=true] .channel-top` y `.channel-count` en `site/styles.css` | Oscurecer el texto a `#0d1930` (6,7:1) y quitar la opacidad del contador |
| Accesibilidad | El contador de cada canal es un número sin etiqueta y no forma parte del nombre accesible | No se sabe si son notas, no leídas o posición | Baja | `renderChannels` (`app.js:34-36`) | «9 notas» en `aria-label` y en `title` |
| Controles | El botón de pantalla completa pasa de icono a texto y su `aria-label` no cambia | El texto «Salir de pantalla completa» no cabe en un botón de 31 px; el nombre accesible queda desactualizado | Media | Manejador `fullscreenchange` (`app.js:148`) | Mantener el icono y cambiar solo `aria-label` y `title` |
| Controles | «ABRIR NOTICIA» abre un diálogo con el mismo extracto, no la noticia | Promete más de lo que da y añade un clic antes de llegar a la fuente | Media | `#read-story` y `showStory` (`app.js:98-108`) | Renombrar a «LEER EXTRACTO», o enlazar directamente a la fuente |
| Controles | Etiqueta «PAUSAR» en el HTML y «Pausar» tras el primer render | Inconsistencia visible al cargar | Baja | `site/index.html:45`; `app.js:69` | Unificar |
| Estados | La vista abre en 7 días y tres canales quedan con 3 notas; en 24 horas, con 1 | Bucles muy cortos; el mensaje vacío sugiere ampliar el período incluso estando ya en 30 días | Media | `state.days` (`app.js:13`); texto en `app.js:64` | Ampliar automáticamente el período del canal si hay menos de 5 notas, indicándolo; ajustar el mensaje cuando ya se está en 30 días |
| Estados | La edición se considera al día si una sola fuente respondió en las últimas 3 horas | Con 16 fuentes caídas y una viva, el indicador sigue en azul | Media | `renderStatus` (`app.js:74-81`) | Mostrar «14 de 17 fuentes» junto a la hora; aviso a partir de un umbral de fuentes caídas |
| Estados | La última consulta correcta de cada fuente solo aparece en un `title` | No es accesible con teclado ni en pantallas táctiles | Baja | `renderSources` (`app.js:88-89`) | Texto visible en la tarjeta |
| Canales | Los ids de canal están escritos en `SOURCES`, en `channels` de `app.js`, en `index.html` y en el README | Añadir o renombrar un canal exige cuatro cambios; una nota con categoría desconocida desaparece sin aviso | Media | `collect.mjs:8-26`; `app.js:1-7`; `index.html:58-63` | Emitir `channels` dentro de `news.json` y generar con ese dato los botones, la lista de criterios y la leyenda «01 — 05» |
| Canales | La misma nota aparece en dos canales (El Universo en CH01 y CH02; Clara en CH03 y CH04; Alta en CH04 y CH05) | Es intencional según el README, pero sin marca parece un error | Baja | `deduplicate` (`content.mjs:98-106`) | Indicar «También en CH 0X» |
| Móvil | Los canales se desplazan en horizontal y el activo puede quedar fuera de vista; varios objetivos táctiles miden 28–34 px | Al pulsar la tecla o volver a la página no se ve qué canal está activo; toques imprecisos | Media | Reglas `@media(max-width:600px)` en `site/styles.css` | `scrollIntoView` del canal activo; mínimo de 44 px en pantalla completa, cierre de diálogo y controles |
| Concepto | Dos temas apilados en el mismo CSS; variable `--amber` azul; favicon con otra paleta | Cualquier cambio de color obliga a tocar dos reglas; el nombre de la variable confunde | Baja | `site/styles.css` líneas 1–13 frente a 15–25; `site/favicon.svg` | Fusionar en un solo tema con variables con nombre por función |
| Concepto | Dial y altavoz parecen controles y no responden | Clics sin efecto | Baja | `.dial`, `.speaker` en `site/index.html:37-38` | Hacer que el dial cambie de canal o quitarle aspecto de control |
| Texto | El pie y la descripción dicen «fuente verificable», y el panel aclara que no se verifican las afirmaciones | «Verificable» puede leerse como «verificada» | Baja | `site/index.html:7,52` | «Con fecha, fuente y enlace» |

### Lo que ya está bien

- Todo el contenido externo se inserta con `textContent` y los enlaces pasan por `safeUrl`.
- Hay enlace de salto, anillo de foco visible, diálogos nativos con retorno de foco y respeto a `prefers-reduced-motion`.
- La reproducción se detiene con la pestaña oculta o con un diálogo abierto, y hay botón de pausa.
- El panel Fuentes explica los criterios y distingue «Sin novedades» de «No disponible».
- El texto principal (titular 16,7:1, extracto 10,4:1, metadatos 9,5:1) supera con margen el contraste AA.

---

## Prioridades

### Los 5 cambios de mayor impacto

1. **Resolver o reemplazar Finextra.** Tres fuentes caídas sostienen el 71 % de Pagos y el 44 % de Cripto con notas que caducan a mediados de diciembre.
2. **Deduplicar entre medios en Fintech LATAM** (clave por entidad e importe, o por similitud de titular), dejando una nota por operación.
3. **Rehacer el canal Autoridades EC**: feed directo de Superbancos, lectura directa de Supercias, boletines de la Junta enrutados aquí y publicaciones de datos del BCE limitadas y etiquetadas.
4. **Hacer legible el titular completo**: escalado por longitud y diálogo disponible también sin extracto.
5. **Decir la verdad sobre el estado**: «SIN SEÑAL» cuando falla la carga, hora de actualización en lugar de «EN VIVO» y marca en las notas de fuentes caídas.

### Fuentes a eliminar o sustituir primero

1. `finextra-latam`: eliminar. Bloqueada, una nota, redundante.
2. `superbancos` y `supercias` vía Google News: sustituir por el origen oficial. Hoy dan cero resultados con etiqueta de fuente oficial.
3. `latam-fintech-hub` vía Google News: sustituir o condicionar a la deduplicación; hoy duplica a LatamList sin extracto.
4. Anuncios de producto de Chainalysis: filtrar y limitar su peso en el canal. La fuente se queda, con rótulo de blog de empresa.

### Qué pulir en la interfaz antes de añadir funciones

1. Conservar el foco al cambiar de canal (no reconstruir los botones).
2. Pausar el avance automático con foco o puntero sobre la noticia.
3. Subir el texto secundario a un mínimo de 12 px y corregir el contraste del canal activo.
4. Asignar `lang` por nota y mostrar la marca de idioma.
5. Arreglar el botón de pantalla completa y renombrar «ABRIR NOTICIA».
6. Fusionar los dos temas de `styles.css` en uno.
7. Emitir los canales desde `news.json` para dejar de mantener cuatro copias.
