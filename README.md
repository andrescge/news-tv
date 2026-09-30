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

El recopilador une varios feeds RSS y las páginas públicas de boletines del BCE. Google News sirve para descubrir publicaciones de medios ecuatorianos y dominios institucionales; cada entrada conserva la fuente identificada y el rótulo «Vía Google News». Noticias sin fecha verificable, con fecha futura o con más de 30 días no entran al sitio. Cada canal muestra inicialmente los últimos 7 días; el control de período permite cambiar a 24 horas o 30 días.

| Canal | Qué entra |
| --- | --- |
| Ecuador financiero | Boletines del BCE y resultados de Google News atribuidos a Primicias, El Universo, Expreso o Bloomberg Línea. Los medios deben coincidir con términos financieros y contexto ecuatoriano. |
| Autoridades EC | Boletines de la Junta del BCE, datos monetarios y financieros oficiales del BCE, entradas de SEPS, Superintendencia de Bancos y Supercias, y cobertura de medios seleccionados sobre esas autoridades. Las noticias de medios se identifican como tales y no como documentos oficiales. |
| Fintech LATAM | Artículos de LatamList, Latam Fintech Hub y Finextra Retail sobre empresas o mercados latinoamericanos; se excluyen eventos y contenido ajeno a banca, fintech, pagos, crédito o seguros. |
| Pagos globales | Artículos de PYMNTS con términos de pagos, banca o fintech; artículos editoriales de la sección Payments de Finextra. |
| Cripto | Artículos editoriales de Finextra Blockchain con términos cripto y publicaciones de análisis de Chainalysis. |

Se eliminan entradas duplicadas por enlace o titular/medio dentro de cada canal; una noticia pertinente a dos canales puede aparecer en ambos. Se ordenan por fecha de publicación antes de limitar cada fuente y se conservan hasta 25 noticias por canal. No hay puntaje de popularidad ni verificación independiente de las afirmaciones de los medios: es una selección automática por fuente, fecha, tema y tipo de artículo. Si una fuente no ofrece extracto, la pantalla muestra el titular y un enlace directo, sin texto de relleno ni resumen inventado.

Los boletines del BCE y SEPS se identifican como publicaciones oficiales. Chainalysis se identifica como análisis empresarial. Los artículos de Finextra se limitan a sus publicaciones editoriales (`newsarticle`) para evitar mezclar comunicados de empresas con noticias. Los extractos se muestran como texto plano y las notas completas se leen en el sitio de origen. El panel Fuentes muestra qué orígenes respondieron y cuáles no tienen novedades.

Si una fuente falla, el recopilador conserva sus entradas válidas de la edición anterior, respetando el límite de 30 días. La página muestra el estado y la última consulta correcta de cada fuente. Si fallan todas, la recopilación termina con error y conserva la edición anterior.

## Publicación y actualización

El repositorio público está en [GitHub](https://github.com/andrescge/news-tv) y GitHub Pages usa el workflow [Actualizar noticias y publicar](https://github.com/andrescge/news-tv/actions/workflows/publish.yml). Cada push a `main` publica una nueva versión. El workflow también consulta las fuentes cada hora, al minuto 17, y publica la edición actualizada; conserva la última edición en la rama `data`. Para adelantar una actualización, abre el workflow en GitHub y elige **Run workflow**. Los horarios del sitio se muestran en `America/Guayaquil`.

GitHub puede retrasar ejecuciones programadas. También desactiva los workflows programados de repositorios públicos tras 60 días sin actividad: revisa la pestaña **Actions** si la actualización aparece atrasada.

## Atribución

La primera versión de NEWS·TV se derivó de [DEV·TV, de shouvik12](https://github.com/shouvik12/devtv), publicado con licencia MIT. Se conserva el texto de esa licencia en [LICENSE](./LICENSE). Los titulares y extractos pertenecen a sus respectivas fuentes.
