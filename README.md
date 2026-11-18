# NEWS·TV

Televisión de noticias de banca, autoridades financieras, fintech, pagos y cripto para profesionales de Ecuador y LATAM, además de prensa sobre empresas de emprendedores Endeavor en la región. Hay seis canales (las teclas 1 a 6 sintonizan cada uno); cada uno muestra una noticia a la vez y avanza automáticamente dentro del mismo canal. Cada noticia conserva fecha, fuente y enlace; también muestra un extracto cuando la fuente lo proporciona.

**Sitio público:** [andrescge.github.io/news-tv](https://andrescge.github.io/news-tv/). La carcasa de grafito y la pantalla CRT están dibujadas con CSS; no se usa ninguna fotografía de terceros.

## Uso local

Requiere Node.js 24 o posterior. Desde la raíz:

```bash
npm ci
npm test
npm run collect
npx serve site
```

Abre la URL local que muestre `serve`. El sitio es HTML, CSS y JavaScript puro; solo la recopilación necesita Node.js. La página carga `site/data/news.json`, que contiene la última edición obtenida.

## Fuentes y criterios

El recopilador une 52 fuentes: feeds RSS, páginas públicas del BCE y de Supercias, el feed del Registro Oficial y búsquedas de Google News para medios sin feed propio (cada entrada de Google conserva el medio identificado y el rótulo «Vía Google News»). Noticias sin fecha verificable, con fecha futura o con más de 30 días no entran al sitio.

Cada fuente declara su **nivel** y su **acceso**, y ambos viajan a cada nota:

- **Nivel 1:** fuente oficial (banco central, superintendencia, ministerio, Registro Oficial, organismo internacional) o medio de referencia.
- **Nivel 2:** medio especializado del sector.
- **Nivel 3:** organización, gremio o empresa que publica su propia posición (Endeavor Argentina, Fintech Business Weekly, Chainalysis). Nunca supera el 20 % de un canal.
- **Acceso:** `open` (abierto), `paywall` (de pago) o `mixed` (parte de las notas son de pago).

| Canal | Fuentes (nivel · acceso) | Qué entra |
| --- | --- | --- |
| Ecuador financiero | Boletines del BCE (1 · abierto); Primicias, economía y empresas (1 · abierto); El Universo (1 · mixto); Forbes Ecuador (2 · abierto, vía Google); Bloomberg Línea · Ecuador (1 · abierto, vía Google) | El titular debe tratar de banca, crédito, seguros, cooperativas, tarjetas, depósitos, remesas, deuda, FMI, riesgo país o presupuesto. Se excluyen promociones de consumo (Black Friday, concursos). De Bloomberg Línea solo entran titulares que nombran a Ecuador y un tema financiero o fiscal. Los boletines del BCE sobre la Junta pasan a Autoridades EC. |
| Autoridades EC | BCE: resoluciones de la Junta, resoluciones administrativas y datos monetarios y financieros (1 · abierto); Registro Oficial (1 · abierto); SEPS, Superintendencia de Bancos, Supercias y Ministerio de Economía y Finanzas (1 · abierto); prensa sobre reguladores de El Universo y Primicias (1 · mixto, vía Google) | Resoluciones, normas, sanciones, alertas sobre entidades no autorizadas, calificaciones de riesgo y comunicados sobre deuda, presupuesto y organismos multilaterales. Se excluyen actos protocolarios, capacitaciones y aniversarios. La prensa sobre reguladores se identifica como noticia, no como documento oficial. |
| Fintech LATAM | El Economista, La República, Bloomberg Línea, Expansión y Diario Financiero (1 · abiertos, mixto o de pago); iupana, LatamList y Contxto (2) | Fintech, neobancos y bancos digitales, pagos, billeteras, finanzas abiertas y reguladores del sector en la región. Se excluyen eventos, convocatorias y galas. La misma operación contada por varios medios queda en una sola nota. |
| Pagos globales | BCE, BCE · Supervisión, BIS (discursos e investigación), Reserva Federal, Banco de Inglaterra, Autoridad Bancaria Europea y Financial Stability Board (1 · abierto); Financial Times · Banking y Fintech, The Wall Street Journal · Markets (1 · de pago); Expansión · Banca (1 · mixto); Payments Dive, Banking Dive, Finextra y PYMNTS (2 · abierto); The Banker y American Banker (2 · de pago); Fintech Business Weekly (3 · mixto) | Pagos, banca, supervisión, estabilidad financiera, euro digital, stablecoins y fintech. Se excluyen contenido patrocinado, columnas de opinión de Finextra y política monetaria. De la Reserva Federal solo entran comunicados sobre pagos, activos digitales o consultas y normas. |
| Cripto | Cinco Días, Reuters, Financial Times, Expansión y Bloomberg Línea (1); The Block, CoinDesk y CriptoNoticias (2); Chainalysis (3 · blog de empresa) | Regulación, stablecoins, tokenización, monedas digitales de bancos centrales, delito, sanciones, hackeos y custodia. Se excluyen precios, análisis de mercado, ETF y memecoins. De The Block, CoinDesk y CriptoNoticias solo se leen sus secciones de regulación, negocio o sucesos. |
| Endeavor LATAM | Prensa sobre empresas Endeavor (2 · mixto, vía Google, con el medio real de cada nota); Endeavor Argentina (3 · organización) | Notas de prensa cuyo titular nombra a una empresa de emprendedores Endeavor de la región (ver «Empresas Endeavor»), publicadas por un medio de la lista de medios aceptados: prensa con redacción propia, de referencia o especializada. No entran agencias de comunicados, blogs de empresas o de exchanges, agregadores, webs de promociones ni páginas de cotizaciones. No es contenido de Endeavor: las notas de endeavor.org y de las sedes nacionales se descartan en la búsqueda, y el blog de Endeavor Argentina conserva su rótulo de organización. Se excluyen notas de cotización y mercado bursátil (precio de la acción, precio objetivo, tickers) y titulares promocionales (cupones, «0% de inicial», sorteos, «por tiempo limitado», premios a usuarios). |

Los discursos de banqueros centrales del BIS se leen una sola vez: los que tratan de cripto, stablecoins, tokenización o monedas digitales van a Cripto, y el resto a Pagos globales.

Los filtros de cada fuente están en `FILTERS` (`scripts/content.mjs`) y se prueban con titulares reales en `tests/content.test.mjs`. No hay puntaje de popularidad ni verificación independiente de las afirmaciones de los medios: es una selección automática por fuente, fecha, tema y tipo de artículo. Si una fuente no ofrece extracto, la pantalla muestra el titular y un enlace directo, sin texto de relleno ni resumen inventado. Los extractos se limitan a 280 caracteres: si el texto no cabe, se corta en el último límite de palabra y termina en «…»; si cabe, se muestra entero y sin «…».

### Períodos, acumulación y composición del canal

La edición cubre cuatro períodos: **24 horas, 7, 15 y 30 días**. Como muchos feeds solo conservan de uno a cinco días, cada ejecución **acumula**: suma a lo que trae el feed las notas que esa misma fuente aportó a la edición anterior, si siguen dentro de los 30 días y siguen pasando el filtro actual. No se repiten notas, y las de una fuente retirada de la lista no se conservan. Si una fuente falla, sus notas conservadas llevan la marca `stale` y la fuente queda con `status: 'error'` y la fecha de su última consulta correcta. Si fallan todas, la recopilación termina con error y no reemplaza la edición anterior.

Luego se compone cada canal:

1. **Una sola copia por nota.** La misma nota en dos canales (mismo enlace, mismo medio y titular, o el mismo titular largo en dos fuentes, como un discurso que publican el BCE y el BIS) queda en un solo canal, en este orden de prioridad: Autoridades EC, Ecuador financiero, Fintech LATAM, Cripto, Pagos globales y Endeavor LATAM. Se conserva la copia con extracto y enlace directo.
2. **Tope por fuente y período.** Cada fuente aporta como máximo su `limit` en cada período, eligiendo notas repartidas en el tiempo para que el período de 15 a 30 días no quede vacío.
3. **Tope de canal.** Hasta 80 notas, repartidas entre los cuatro períodos.
4. **Nivel 3.** Como máximo el 20 % del canal.

### Registro Oficial

El feed del Registro Oficial publica el sumario de cada edición. El recopilador agrupa las normas por órgano emisor y solo conserva las de la Junta de Política y Regulación Financiera y Monetaria, las superintendencias de Bancos, Economía Popular y Solidaria y Compañías, el BCE, COSEDE, el SRI y la UAFE. Descarta informes que solo se «conocen», designaciones, delegaciones, estatutos y personerías jurídicas, y las ediciones jurídicas, constitucionales y especiales. Cada edición da una nota: el titular es la primera norma financiera y el extracto nombra la edición y las demás normas que trae. La primera vez lee 16 páginas del feed (alrededor de un mes); después, tres.

### Google News

Google responde con error 429 a ráfagas de consultas, así que sus fuentes se piden de una en una, con una pausa de 2,5 segundos y un reintento. Las demás fuentes se piden en paralelo, también con un reintento.

### Empresas Endeavor

**Origen de la lista.** `scripts/data/endeavor-latam.json` contiene las empresas de la región América Latina del [directorio de Endeavor](https://endeavor.org/entrepreneur-companies/), con nombre, oficinas locales, vertical y enlace a su ficha. Se genera con la API pública de endeavor.org y no se edita a mano. Para regenerarla:

```bash
npm run endeavor                      # reescribe scripts/data/endeavor-latam.json
node scripts/endeavor.mjs --output <ruta>
```

El script recorre todas las páginas de la API, se queda con las empresas de la región, une las que el directorio repite por oficina y se niega a escribir si obtiene menos de 100.

**Cruce con las noticias.** Toda nota de cualquier canal pasa por `matchEndeavor` (`scripts/content.mjs`). Si su titular (o, para nombres inequívocos, su extracto) nombra a una empresa de la lista, la nota lleva el campo `endeavor: { company, country, vertical, url }` y la pantalla muestra el rótulo «EMPRESA ENDEAVOR · empresa · país», enlazado a la ficha del directorio. Las notas etiquetadas siguen en su canal de origen. Reglas:

- Siempre palabra completa: «Bold» no coincide dentro de «Boldface», ni un nombre unido a otra palabra por punto o guion.
- Nombres inequívocos: sin distinguir mayúsculas ni tildes, en titular o extracto.
- Nombres ambiguos (lista editable `ENDEAVOR_AMBIGUOUS`; además, todo nombre de tres caracteres o menos): solo en el titular, con la grafía del directorio o con inicial mayúscula, y solo si el titular tiene contexto de negocio o fintech (`ENDEAVOR_CONTEXT`: fintech, startup, ronda, pagos, crédito, alianza, app…) y no trae ruido conocido (`ENDEAVOR_NOISE`: minería, cargos políticos). Se descartan además cuando el nombre va junto a otra palabra con mayúscula (una persona: «Clara Brugada») o cuando, en un titular con mayúsculas en cada palabra, aparece en mitad de la frase. Así, «Clara levanta USD 80 millones» se etiqueta y «una mañana clara en Quito» no; «R2» sin contexto no.
- Nombres excluidos (`ENDEAVOR_EXCLUDED`): palabras demasiado comunes para un cruce automático (Prima, Torre, Take, ISA…).
- Alias (`ENDEAVOR_ALIASES`): otras grafías usadas por la prensa, como «Addi» para ADDI o «Mercado Libre».

**Canal Endeavor LATAM.** La fuente «Prensa sobre empresas Endeavor» consulta Google News con los nombres unidos por `OR` en lotes de hasta 28 palabras (`ENDEAVOR_SEARCH`). Empieza por las empresas fintech de la región y las que tienen oficina Endeavor en Ecuador (hoy 109 empresas en 10 lotes, que con las ediciones en español e inglés de Google suman 20 consultas); los nombres ambiguos van en lotes propios con un calificador común («fintech» o «startup»). Cada ejecución consulta 4 lotes y guarda en `tracked['endeavor-prensa']` dónde quedó la rotación; la siguiente sigue desde ahí y la acumulación de 30 días llena el canal con el tiempo. Una nota entra solo si el cruce confirma la empresa en el titular, si su medio está en la lista de medios aceptados y si el titular no es promocional. Se conserva el medio real y el rótulo «Vía Google News».

**Medios aceptados en Endeavor LATAM.** La lista `ENDEAVOR_PRESS_HOSTS` (`scripts/content.mjs`) reúne, por dominio, la prensa con redacción propia que puede entrar en el canal: los medios que el proyecto ya usa como fuentes de nivel 1 y 2, prensa de referencia de cada país de la región (El Cronista, Forbes Argentina, Gestión, El Universal, El Nacional, La Razón de México, El CEO…) y medios especializados (iProUP, DPL News, The Paypers, Latam Fintech Hub, Dealroom, Lexology…). Como las notas llegan por Google News, se comprueba el dominio del medio real, no el de Google; valen también sus subdominios. Un medio que no está en la lista no entra, aunque nombre a una empresa de la red. Para sumar uno, se añade su dominio en el grupo que corresponda y un caso en las pruebas. Aparte, `ENDEAVOR_PROMO` descarta titulares promocionales. Como la acumulación vuelve a aplicar el filtro vigente, las notas de ediciones anteriores que no cumplen la regla salen en la siguiente recopilación. Si Google responde 429, la ejecución se detiene en ese lote y la siguiente lo retoma.

### Seguimiento de resoluciones del BCE

Las páginas de [resoluciones de la Junta](https://www.bce.fin.ec/junta-de-politica-y-regulacion-financiera-y-monetaria/resoluciones/resoluciones-emitidas/) y de [resoluciones administrativas](https://www.bce.fin.ec/banco-central-del-ecuador/resoluciones-administrativas/) listan código, descripción y PDF, pero no la fecha. El recopilador usa como fecha la de carga del PDF (cabecera `Last-Modified`), la consulta una sola vez por documento y la guarda en `tracked` dentro de `news.json`; cada nota lo indica en su extracto. Solo se consultan las resoluciones del año en curso que pasan el filtro:

- **Junta:** se excluyen las administrativas (`-A`) y de gobierno interno (`-G`), los informes que la Junta solo «conoce» y las designaciones.
- **Administrativas:** entran las que tratan de pagos, transferencias, moneda, depósitos y retiros de especies, encaje, liquidez, reservas, tarifas, corresponsales o entidades financieras; se excluyen memorandos, oficios, delegaciones, designaciones, talento humano y contratación.

Cada nota lleva además el tipo de su fuente: publicación oficial (BCE, superintendencias, ministerio, Registro Oficial, bancos centrales y organismos internacionales), noticia, blog de empresa (Chainalysis) o contenido de organización (Endeavor Argentina, Fintech Business Weekly). La prensa sobre empresas Endeavor es noticia, no contenido de Endeavor. Las publicaciones oficiales y de organizaciones reflejan la posición de quien las emite. Los extractos se muestran como texto plano y las notas completas se leen en el sitio de origen. El panel Fuentes muestra qué orígenes respondieron, cuáles no tienen novedades y la última consulta correcta de cada uno.

Para revisar una edición generada en otra ruta: `node scripts/validate.mjs <ruta>` (sin ruta, valida `site/data/news.json`).

## Publicación y actualización

El repositorio público está en [GitHub](https://github.com/andrescge/news-tv) y GitHub Pages usa el workflow [Actualizar noticias y publicar](https://github.com/andrescge/news-tv/actions/workflows/publish.yml). Cada push a `main` publica una nueva versión. El workflow también consulta las fuentes cada hora, al minuto 17, y publica la edición actualizada; conserva la última edición en la rama `data`. Para adelantar una actualización, abre el workflow en GitHub y elige **Run workflow**. Los horarios del sitio se muestran en `America/Guayaquil`.

GitHub puede retrasar ejecuciones programadas. También desactiva los workflows programados de repositorios públicos tras 60 días sin actividad: revisa la pestaña **Actions** si la actualización aparece atrasada.

## Atribución

La primera versión de NEWS·TV se derivó de [DEV·TV, de shouvik12](https://github.com/shouvik12/devtv), publicado con licencia MIT. Se conserva el texto de esa licencia en [LICENSE](./LICENSE). Los titulares y extractos pertenecen a sus respectivas fuentes.
