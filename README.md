# NEWS·TV

Televisión de noticias de banca, autoridades financieras, fintech, pagos y cripto para profesionales de Ecuador y LATAM. Hay cinco canales; cada uno muestra una noticia a la vez y avanza automáticamente dentro del mismo canal. Cada noticia conserva fecha, fuente y enlace; también muestra un extracto cuando la fuente lo proporciona.

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

El recopilador une varios feeds RSS y páginas públicas del BCE y de Supercias. Google News sirve para descubrir publicaciones de medios que no ofrecen feed propio; cada entrada conserva la fuente identificada y el rótulo «Vía Google News». Noticias sin fecha verificable, con fecha futura o con más de 30 días no entran al sitio. Cada canal muestra inicialmente los últimos 7 días; el control de período permite cambiar a 24 horas o 30 días.

| Canal | Qué entra |
| --- | --- |
| Ecuador financiero | Boletines del BCE; noticias de economía de Primicias leídas de su propio feed; resultados de Google News atribuidos a El Universo, Expreso o Bloomberg Línea; análisis de Asobanca, identificados como contenido del gremio bancario; y anuncios de crédito de BanEcuador y la Corporación Financiera Nacional (hasta dos por entidad). El titular de los medios debe contener un término financiero (banca, crédito, seguros, cooperativas, tarjetas, depósitos, remesas…). |
| Autoridades EC | Resoluciones de la Junta de Política y Regulación Financiera y Monetaria y resoluciones administrativas del BCE (ver «Seguimiento de resoluciones del BCE»), boletines del BCE que tratan de la Junta, las tres publicaciones de datos monetarios y financieros más recientes del BCE, avisos y normas de SEPS, Superintendencia de Bancos y Supercias leídos de sus propios sitios, comunicados del Ministerio de Economía y Finanzas sobre deuda, presupuesto y organismos multilaterales, y publicaciones de la UAFE sobre lavado de activos. Se añade cobertura de medios seleccionados sobre esas autoridades, identificada como periodística y no como documento oficial. |
| Fintech LATAM | Artículos de LatamList, Latam Fintech Hub, iupana, Bloomberg Línea, Valora Analitik y Contxto sobre empresas o mercados latinoamericanos, y publicaciones de Endeavor Argentina, Colombia Fintech, LAVCA y FELABAN, identificadas como contenido de la organización. Se excluyen eventos y contenido ajeno a banca, fintech, pagos, crédito o seguros. Cada medio aporta como máximo ocho notas por edición (las organizaciones, tres o cuatro) y la misma operación contada por varios medios queda en una sola nota. |
| Pagos globales | Artículos de PYMNTS cuyo titular trata de pagos, banca o fintech; noticias de Payments Dive y de Electronic Payments International, sin contenido patrocinado; Payments Cards & Mobile; Digital Transactions; comunicados de la Reserva Federal y del Banco Central Europeo sobre pagos, euro digital o activos digitales; artículos editoriales de la sección Payments de Finextra. |
| Cripto | Artículos editoriales de Finextra Blockchain con términos cripto; notas de política, regulación e infraestructura financiera de CoinDesk y The Block (hasta ocho cada uno, sin precios de mercado); la sección de regulación y adopción de CriptoNoticias, en español; publicaciones de Chainalysis y TRM Labs sobre delito, sanciones y adopción, identificadas como blog de empresa; y posiciones de Coin Center, identificadas como contenido de una organización. |

Se eliminan entradas duplicadas por enlace o titular/medio dentro de cada canal; una noticia pertinente a dos canales puede aparecer en ambos. En Fintech LATAM, además, cuando varios medios cuentan la misma operación (misma empresa e importe, o dos nombres propios en común, con hasta cuatro días de diferencia) se conserva una sola nota: la que trae extracto y enlace directo. Se ordenan por fecha de publicación antes de limitar cada fuente y se conservan hasta 40 noticias por canal; cada fuente tiene además su propio tope, para que ninguna acapare el canal. No hay puntaje de popularidad ni verificación independiente de las afirmaciones de los medios: es una selección automática por fuente, fecha, tema y tipo de artículo. Si una fuente no ofrece extracto, la pantalla muestra el titular y un enlace directo, sin texto de relleno ni resumen inventado.

### Seguimiento de resoluciones del BCE

Las páginas de [resoluciones de la Junta](https://www.bce.fin.ec/junta-de-politica-y-regulacion-financiera-y-monetaria/resoluciones/resoluciones-emitidas/) y de [resoluciones administrativas](https://www.bce.fin.ec/banco-central-del-ecuador/resoluciones-administrativas/) listan código, descripción y PDF, pero no la fecha. El recopilador usa como fecha la de carga del PDF (cabecera `Last-Modified`), la consulta una sola vez por documento y la guarda en `tracked` dentro de `news.json`; cada nota lo indica en su extracto. Solo se consultan las resoluciones del año en curso que pasan el filtro:

- **Junta:** se excluyen las administrativas (`-A`) y de gobierno interno (`-G`), los informes que la Junta solo «conoce» y las designaciones.
- **Administrativas:** entran las que tratan de pagos, transferencias, moneda, depósitos y retiros de especies, encaje, liquidez, reservas, tarifas, corresponsales o entidades financieras; se excluyen memorandos, oficios, delegaciones, designaciones, talento humano y contratación.

Cada nota lleva el tipo de su fuente: publicación oficial (BCE, superintendencias, ministerio, banca pública y bancos centrales), noticia, blog de empresa (Chainalysis, TRM Labs) o contenido de organización (Endeavor, Asobanca, Colombia Fintech, LAVCA, FELABAN, Coin Center). Las publicaciones oficiales y de organizaciones reflejan la posición de quien las emite. Los artículos de Finextra se limitan a sus publicaciones editoriales (`newsarticle`) para evitar mezclar comunicados de empresas con noticias. Los extractos se muestran como texto plano y las notas completas se leen en el sitio de origen. El panel Fuentes muestra qué orígenes respondieron y cuáles no tienen novedades.

Si una fuente falla, el recopilador conserva sus entradas válidas de la edición anterior, respetando el límite de 30 días. La página muestra el estado y la última consulta correcta de cada fuente. Si fallan todas, la recopilación termina con error y conserva la edición anterior.

## Publicación y actualización

El repositorio público está en [GitHub](https://github.com/andrescge/news-tv) y GitHub Pages usa el workflow [Actualizar noticias y publicar](https://github.com/andrescge/news-tv/actions/workflows/publish.yml). Cada push a `main` publica una nueva versión. El workflow también consulta las fuentes cada hora, al minuto 17, y publica la edición actualizada; conserva la última edición en la rama `data`. Para adelantar una actualización, abre el workflow en GitHub y elige **Run workflow**. Los horarios del sitio se muestran en `America/Guayaquil`.

GitHub puede retrasar ejecuciones programadas. También desactiva los workflows programados de repositorios públicos tras 60 días sin actividad: revisa la pestaña **Actions** si la actualización aparece atrasada.

## Atribución

La primera versión de NEWS·TV se derivó de [DEV·TV, de shouvik12](https://github.com/shouvik12/devtv), publicado con licencia MIT. Se conserva el texto de esa licencia en [LICENSE](./LICENSE). Los titulares y extractos pertenecen a sus respectivas fuentes.
