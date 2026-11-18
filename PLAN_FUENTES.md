# Plan de fuentes de NEWS·TV

Fecha: 17 de noviembre de 2026 · Auditoría de `scripts/collect.mjs` · No se modificó ningún archivo de código para este plan.

## Veredicto

De las 21 fuentes configuradas: **7 se mantienen tal cual, 6 se mantienen con cambios, 5 se reemplazan y 3 se eliminan.**

Lo más urgente es Finextra: sus tres feeds devuelven HTTP 403 desde el 14 de noviembre y sostienen 12 de las 17 notas de Pagos y 8 de las 18 de Cripto con contenido arrastrado que caduca a mediados de diciembre.

## Alcance y evidencia

- **Qué se auditó:** las 21 entradas de `SOURCES` (`scripts/collect.mjs`, líneas 9–29) y su filtro en `relevant()` (`scripts/content.mjs`, líneas 130–153). Cuatro de ellas (`bce-junta-resoluciones`, `bce-resoluciones-admin`, `endeavor-ar`, `endeavor-global`) existen solo en el árbol de trabajo, sin confirmar.
- **No hay APIs.** Hay 10 feeds RSS directos, 6 búsquedas RSS de Google News y 5 páginas HTML del BCE leídas con selectores (dos de ellas consultan además la cabecera de cada PDF).
- **Datos:** recolección real ejecutada el 18 de noviembre a las 04:42 UTC contra una copia temporal (84 notas, 18 de 21 fuentes respondieron), más la edición publicada en la rama `data`.
- **Alternativas:** de cada feed propuesto solo consta que respondió y cuántas entradas traía; no se revisó su contenido.
- **Valoración editorial:** se basa en conocimiento general de cada medio y en los titulares de la edición, no en un estudio de propiedad o financiación.

Escala: rigor, originalidad y transparencia van de **Alto** (mejor) a **Bajo**; en clickbait, **Bajo** es lo deseable. «Transparencia» valora si el lector puede saber quién publica, cuándo y con qué interés, tal como la nota llega al sitio.

## Tabla comparativa

| # | Fuente (`id`) | Canal | Vía | Estado hoy | Rigor | Originalidad | Transparencia | Clickbait | Decisión |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | BCE · Resoluciones de la Junta (`bce-junta-resoluciones`) | Autoridades | HTML + cabecera del PDF | 2 notas | Alto | Alta | Media | Bajo | **Mantener** |
| 2 | BCE · Resoluciones administrativas (`bce-resoluciones-admin`) | Autoridades | HTML + cabecera del PDF | 1 nota | Alto | Alta | Media | Bajo | **Mantener** |
| 3 | Banco Central del Ecuador (`bce-boletines`) | Ecuador | HTML | 6 notas | Alto | Alta | Alta | Bajo | **Mantener** |
| 4 | LatamList (`latamlist`) | LATAM | RSS | 8 notas | Medio | Media | Alta | Bajo | **Mantener** |
| 5 | iupana (`iupana`) | LATAM | RSS | 3 pasan, 1 visible | Alto | Alta | Alta | Bajo | **Mantener** |
| 6 | SEPS (`seps`) | Autoridades | RSS | 1 nota | Alto | Alta | Alta | Bajo | **Mantener** |
| 7 | Endeavor Argentina (`endeavor-ar`) | LATAM | RSS | 4 pasan, 1 visible | Medio | Media | Baja | Bajo | **Mantener** |
| 8 | Medios de Ecuador (`ecuador-news`) | Ecuador | Google News | 4 notas, 0 con extracto | Medio | Media | Baja | Medio | **Mantener con cambios** |
| 9 | Cobertura de autoridades EC (`regulatory-news`) | Autoridades | Google News | 1 nota, duplicada en Ecuador | Medio | Baja | Baja | Medio | **Mantener con cambios** |
| 10 | BCE · Datos financieros (`bce-publicaciones`) | Autoridades | HTML | 9 notas, 0 con extracto | Alto | Alta | Alta | Bajo | **Mantener con cambios** |
| 11 | PYMNTS (`pymnts`) | Pagos | RSS | 5 notas | Medio | Media | Media | Medio | **Mantener con cambios** |
| 12 | Chainalysis (`chainalysis`) | Cripto | RSS | 10 notas | Medio | Alta | Baja | Medio | **Mantener con cambios** |
| 13 | Bloomberg Línea · fintech (`latam-bloomberg`) | LATAM | Google News | 8 pasan, 0 con extracto | Alto | Alta | Baja | Bajo | **Mantener con cambios** (feed directo) |
| 14 | Superintendencia de Bancos (`superbancos`) | Autoridades | Google News | 0 notas | Alto | Alta | Baja | Bajo | **Reemplazar** |
| 15 | Supercias (`supercias`) | Autoridades | Google News | 0 notas | Alto | Alta | Baja | Bajo | **Reemplazar** |
| 16 | Latam Fintech Hub (`latam-fintech-hub`) | LATAM | Google News | 8 notas, 0 con extracto | Medio | Baja | Baja | Bajo | **Reemplazar** |
| 17 | Finextra · Payments (`finextra-payments`) | Pagos | RSS | HTTP 403; 12 arrastradas | Alto | Alta | Alta | Bajo | **Reemplazar** si sigue bloqueada |
| 18 | Finextra · Blockchain (`finextra-crypto`) | Cripto | RSS | HTTP 403; 8 arrastradas | Alto | Alta | Alta | Bajo | **Reemplazar** si sigue bloqueada |
| 19 | Finextra · LATAM (`finextra-latam`) | LATAM | RSS | HTTP 403; 1 arrastrada | Alto | Alta | Alta | Bajo | **Eliminar** |
| 20 | BCE · Junta Financiera (`bce-junta`) | Autoridades | HTML | 0 notas | Alto | Alta | Alta | Bajo | **Eliminar** |
| 21 | Endeavor (`endeavor-global`) | LATAM | RSS | 0 notas | Medio | Media | Baja | Medio | **Eliminar** |

Para las fuentes vía Google News, rigor y originalidad califican al medio de origen; la transparencia baja porque el enlace pasa por Google, la nota llega sin extracto y la selección depende de un ranking ajeno.

## Detalle por decisión

### Mantener (7)

- **Resoluciones del BCE (1 y 2).** Son el documento primario. La transparencia es «Media» porque la fecha mostrada es la de carga del PDF, no la de la resolución; el extracto ya lo advierte. El filtro de relevancia es una decisión editorial propia: deja fuera, por ejemplo, el Informe de Estabilidad Financiera.
- **Banco Central del Ecuador (3).** Comunicación institucional con extracto y fecha. Incluye autopromoción ocasional. Pendiente menor: sus notas sobre la JPRFM aparecen en el canal Ecuador y no en Autoridades.
- **LatamList (4).** Notas breves de rondas y adquisiciones, cercanas al comunicado; poco contexto pero bajo riesgo. Sirve como fuente de referencia al deduplicar operaciones.
- **iupana (5).** Reportería propia sobre tecnología bancaria en la región. Problema ajeno a la fuente: pasan 3 notas y solo se ve 1 porque el canal llega a su tope de 25.
- **SEPS (6).** Feed oficial directo. El filtro es amplio y deja pasar relaciones públicas; conviene estrecharlo, pero no cambia la decisión.
- **Endeavor Argentina (7).** Contenido de la propia organización sobre sus emprendedores: útil, pero no es periodismo y hoy se rotula «ANÁLISIS SECTORIAL». Se mantiene a condición de corregir el rótulo (ver «Cambios transversales»).

### Mantener con cambios (6)

| Fuente | Problema | Cambio |
| --- | --- | --- |
| Medios de Ecuador | 3 de 4 titulares son de servicio («¿Cubren los seguros…?», «Estas son las falsas cooperativas…»). Filtro por «pago», «economía» o «dólar» en titular o extracto. | Exigir el término financiero en el titular. Leer Expreso por su feed directo y dejar Google News solo para Primicias y El Universo. |
| Cobertura de autoridades EC | Aporta 1 nota y es la misma de El Universo que ya sale en Ecuador. | Excluir del canal Ecuador lo que entre aquí. |
| BCE · Datos financieros | Son publicaciones periódicas, no noticias, y ocupan 9 de las 14 entradas del canal. | Tope de 3 y rótulo «DATO OFICIAL». |
| PYMNTS | Mezcla noticia, opinión y estudios patrocinados; filtro muy amplio («bank», «card»). | Estrechar el filtro y añadir un segundo medio de pagos para no depender de uno. |
| Chainalysis | Blog de un proveedor con interés comercial; sin filtro entran anuncios de producto y temas ajenos. Aporta 10 de 18 notas. | Rótulo «BLOG DE EMPRESA», excluir «Chainalysis Supports…», tope de 5. |
| Bloomberg Línea | Medio sólido, pero llega vía Google News sin extracto y con notas ajenas a LATAM. | Cambiar al feed directo del medio y filtrar por tema y país en el titular. |

### Reemplazar (5)

| Fuente | Por qué | Alternativa concreta | Comprobado |
| --- | --- | --- | --- |
| Superintendencia de Bancos | 0 resultados; se rotula «oficial» aunque llega del índice de Google. | `https://www.superbancos.gob.ec/bancos/feed/` | 200, 10 entradas |
| Supercias | 0 resultados; mismo problema de rótulo. | Leer la página de noticias de supercias.gob.ec con un adaptador HTML como los del BCE. | No encontré feed (404 en la ruta probada); falta inspeccionar la página |
| Latam Fintech Hub | Sin extracto y repite las operaciones de LatamList (Akua, Cocos, Palomma, Nexu). | Contxto: `https://contxto.com/en/feed/` | 200, 100 entradas |
| Finextra · Payments | HTTP 403 desde el 14 de noviembre, también con otro User-Agent desde esta máquina. | Payments Dive: `https://www.paymentsdive.com/feeds/news/` | 200, 10 entradas |
| Finextra · Blockchain | Mismo bloqueo. | CoinDesk: `https://www.coindesk.com/arc/outboundfeeds/rss/` · The Block: `https://www.theblock.co/rss.xml` | 200, 25 y 20 entradas |

Finextra es buena fuente: si el acceso se recupera (por ejemplo, pidiendo permiso al medio), lo correcto es mantenerla y añadir las alternativas como segundo medio, no sustituirla.

### Eliminar (3)

- **Finextra · LATAM.** Es el feed global de banca minorista filtrado por nombres de países: aportaba 1 nota incluso cuando respondía.
- **BCE · Junta Financiera.** 0 notas en septiembre y en noviembre. Su función la cubren ahora las resoluciones de la Junta (fuente 1) y los boletines del BCE (fuente 3). Antes de borrarla, confirmar que la página dejó de publicarse.
- **Endeavor global.** 0 notas: en dos meses publicó una sola historia latinoamericana, en inglés y con titulares de revista. Los feeds de México, Colombia y Ecuador no respondieron; Chile es un blog de opinión y Perú publicó una entrada en 2026.

### Adiciones opcionales

| Canal | Candidato | Feed | Comprobado | Advertencia |
| --- | --- | --- | --- | --- |
| Ecuador | Expreso (directo) | `https://www.expreso.ec/rss/economia.xml` | 200, 20 entradas | Mucho contenido de servicio: necesita filtro por titular |
| Ecuador | Asobanca | `https://asobanca.org.ec/feed/` | 200, 4 entradas | Es el gremio bancario: rotular como organización |
| Cripto | CriptoNoticias | `https://www.criptonoticias.com/feed/` | 200, 10 entradas | En español y con foco regional, pero favorable al sector |

Sin feed en la ruta probada: Primicias, El Universo, Revista Gestión, The Paypers, BIS/CPMI y Fintech Futures (403).

## Cambios transversales

Afectan a varias fuentes y condicionan el resultado de los reemplazos:

1. **Deduplicar entre medios.** `deduplicate` solo compara dentro del mismo medio, así que una ronda cubierta por tres medios sale tres veces. Sin esto, añadir Contxto o Bloomberg Línea directo aumenta la repetición.
2. **Nuevo tipo de fuente para organizaciones y empresas.** Hoy solo existen `official`, `news` y `analysis`. Endeavor, Chainalysis y Asobanca necesitan un cuarto valor con rótulo propio.
3. **Tope por fuente configurable.** El tope actual es fijo (8 en LATAM, 25 en el resto). Los cambios de BCE Datos y Chainalysis requieren un tope por entrada de `SOURCES`.
4. **Marcar las notas arrastradas** de fuentes caídas, para que un bloqueo como el de Finextra sea visible en pantalla.

## Archivos y pruebas afectados

| Cambio | Archivos | Pruebas en `tests/content.test.mjs` |
| --- | --- | --- |
| Eliminar `finextra-latam` | `scripts/collect.mjs` (línea 23), `scripts/content.mjs` (rama en línea 144), `README.md`, `site/index.html` | Quitar dos aserciones de «las categorías temáticas filtran artículos ajenos al sector» (Jeeves y London bank) |
| Eliminar `bce-junta` | `scripts/collect.mjs` (línea 10), `README.md`, `site/index.html` | Ninguna: `parseBce` sigue en uso por `bce-boletines` |
| Eliminar `endeavor-global` | `scripts/collect.mjs` (línea 25), `scripts/content.mjs` (línea 138), `README.md` | Quitar dos aserciones de «Endeavor solo aporta notas de la región…»; conservar la de la coletilla del feed |
| Reemplazar `superbancos` | `scripts/collect.mjs` (línea 16: adaptador `rss`, nueva URL, sin `allowHosts`), `README.md`, `site/index.html` | Añadir un caso de filtro para el feed directo |
| Reemplazar `supercias` | `scripts/collect.mjs` (línea 17), `scripts/content.mjs` (nuevo analizador HTML), `README.md`, `site/index.html`, `CLAUDE.md` (lista de adaptadores) | Prueba nueva del analizador con HTML de muestra |
| Reemplazar `latam-fintech-hub` por Contxto | `scripts/collect.mjs` (línea 20), `scripts/content.mjs` (línea 141), `README.md`, `site/index.html` | Sustituir la aserción del webinar por casos de Contxto |
| Reemplazar Finextra por Payments Dive y CoinDesk | `scripts/collect.mjs` (líneas 27–28), `scripts/content.mjs` (líneas 145–148), `README.md`, `site/index.html` | Sustituir la aserción de `finextra-crypto` y añadir casos para las nuevas |
| Bloomberg Línea por feed directo | `scripts/collect.mjs` (línea 22), `scripts/content.mjs` (línea 143), `README.md` | Las dos aserciones de `latam-bloomberg` siguen valiendo; añadir un caso que rechace notas sin país |
| Estrechar filtros (`ecuador-news`, `seps`, `pymnts`, `chainalysis`) | `scripts/content.mjs` (líneas 149–152 y rama nueva para Chainalysis), `README.md` | Añadir casos positivos y negativos por fuente; hoy `ecuador-news`, `seps`, `pymnts` y `chainalysis` no tienen ninguno |
| Deduplicar entre medios | `scripts/content.mjs` (`deduplicate`), `README.md` | Cambia «las distintas coberturas sobreviven mientras los duplicados se eliminan»: hoy exige que dos medios con el mismo titular se conserven |
| Nuevo tipo de fuente | `scripts/collect.mjs` (`kind`), `site/app.js` (rótulos en líneas 51, 86 y 104), `README.md`, `CLAUDE.md` | Sin pruebas de interfaz en el repositorio; se verifica a mano en el navegador |
| Tope por fuente | `scripts/collect.mjs` (`fetchSource`), `README.md` | Sin cobertura: `collect.mjs` no tiene pruebas |
| Marcar notas arrastradas | `scripts/collect.mjs` (rama de fallo en `run`), `site/app.js` (`renderScreen`) | Sin cobertura |

`scripts/validate.mjs` no cambia en ningún caso. Cada cambio en `SOURCES` obliga a actualizar la tabla del `README.md` y la lista de criterios de `site/index.html`, que se mantienen a mano.

## Orden propuesto

1. **Finextra:** intentar recuperar el acceso; si no, incorporar Payments Dive y CoinDesk y eliminar `finextra-latam`.
2. **Autoridades EC:** feed directo de Superbancos, lectura directa de Supercias, eliminar `bce-junta`, tope a BCE Datos.
3. **Deduplicación entre medios**, antes de tocar más fuentes de LATAM.
4. **Fintech LATAM:** Contxto en lugar de Latam Fintech Hub, Bloomberg Línea directo, eliminar `endeavor-global`.
5. **Rótulos y filtros:** nuevo tipo de fuente, filtros de Chainalysis, PYMNTS, SEPS y Medios de Ecuador.
