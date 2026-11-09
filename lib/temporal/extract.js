/**
 * Metadata extraction for temporal evidence. Only publisher-declared dates are `published`;
 * HTTP Last-Modified is an update hint, never a publication time. The raw string is retained
 * on every candidate so a reviewer can audit the parser's choice.
 * @module dsh-sherlock/temporal/extract
 */
import { parseDate } from './time.js'

/**
 * @param {import('./fetch.js').FetchRecord} record
 * @returns {{title:string|null,byline:string|null,canonicalUrl:string|null,timeCandidates:object[],feedEntries:any[],sourceClass?:string}}
 */
export function extractPage(record) {
  const text = record.text || ''
  const candidates = []
  const add = (field, raw, source, confidence) => {
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value || value.length > 120) return
    const parsed = parseDate(value)
    candidates.push({
      field,
      raw: value,
      source,
      confidence,
      parsed: parsed ? { earliest: parsed.earliest, latest: parsed.latest, precision: parsed.precision, timeZone: parsed.timeZone, uncertain: parsed.uncertain } : null,
    })
  }

  for (const data of jsonLdBlocks(text)) {
    for (const node of flattenJsonLd(data)) {
      add('published', node.datePublished, 'jsonld.datePublished', 'high')
      add('updated', node.dateModified, 'jsonld.dateModified', 'medium')
      add('published', node.dateCreated, 'jsonld.dateCreated', 'medium')
    }
  }
  for (const [property, value] of metaTags(text)) {
    const key = property.toLowerCase()
    if (key === 'article:published_time' || key === 'og:article:published_time' || key === 'datepublished') add('published', value, `meta.${key}`, 'medium')
    if (key === 'article:modified_time' || key === 'og:updated_time' || key === 'datemodified') add('updated', value, `meta.${key}`, 'medium')
  }
  for (const match of text.matchAll(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    add('published', match[1], 'html.time.datetime', 'medium')
  }
  add('updated', record.headers['last-modified'], 'http.last-modified', 'low')
  add('observed', record.fetchedAt, 'workbench.observed', 'high')

  return {
    title: extractTitle(text) ?? null,
    byline: extractByline(text),
    canonicalUrl: extractCanonical(text, record.finalUrl),
    timeCandidates: dedupeCandidates(candidates),
    feedEntries: extractFeedEntries(text, record.finalUrl),
  }
}

/** @param {string} html */
function* jsonLdBlocks(html) {
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      yield JSON.parse(match[1].trim())
    } catch {
      // Broken JSON-LD is common; leave it for a gap, do not throw.
    }
  }
}

/** @param {unknown} value @returns {any[]} */
function flattenJsonLd(value) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd)
  /** @type {any} */ const object = value
  const nodes = [object]
  if (object['@graph']) nodes.push(...flattenJsonLd(object['@graph']))
  return nodes
}

/** @param {string} html */
function metaTags(html) {
  const rows = []
  for (const match of html.matchAll(/<meta\b([^>]+)>/gi)) {
    const attrs = parseAttrs(match[1])
    const key = attrs.property ?? attrs.name ?? attrs.itemprop
    if (key && attrs.content) rows.push([key, attrs.content])
  }
  return rows
}

/** @param {string} source */
function parseAttrs(source) {
  const attrs = /** @type {Record<string,string>} */ ({})
  for (const match of source.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? ''
  }
  return attrs
}

/** @param {string} html */
function extractTitle(html) {
  const og = metaTags(html).find(([key]) => key.toLowerCase() === 'og:title')
  if (og?.[1]) return decodeEntities(og[1]).slice(0, 300)
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? decodeEntities(stripTags(match[1])).slice(0, 300) : null
}

/** @param {string} html */
function extractByline(html) {
  const rows = metaTags(html)
  const author = rows.find(([key]) => ['author', 'article:author', 'og:article:author'].includes(key.toLowerCase()))
  return author?.[1] ? decodeEntities(author[1]).slice(0, 200) : null
}

/** @param {string} html @param {string} base */
function extractCanonical(html, base) {
  for (const match of html.matchAll(/<link\b([^>]+)>/gi)) {
    const attrs = parseAttrs(match[1])
    if ((attrs.rel ?? '').toLowerCase() === 'canonical' && attrs.href) {
      try { return new URL(attrs.href, base).toString() } catch { return null }
    }
  }
  const og = metaTags(html).find(([key]) => key.toLowerCase() === 'og:url')
  if (og?.[1]) {
    try { return new URL(og[1], base).toString() } catch { return null }
  }
  return null
}

/** @param {string} text @param {string} base */
function extractFeedEntries(text, base) {
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(text)) return []
  const entries = []
  const blocks = text.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? []
  for (const block of blocks.slice(0, 50)) {
    const link = firstTag(block, 'link')
    const title = firstTag(block, 'title')
    const published = firstTag(block, 'pubDate') ?? firstTag(block, 'published') ?? firstTag(block, 'updated')
    if (!link) continue
    let url
    try { url = new URL(link, base).toString() } catch { continue }
    entries.push({ url, title: title ? decodeEntities(stripTags(title)).slice(0, 300) : null, dateRaw: published ?? null })
  }
  return entries
}

/** @param {string} block @param {string} tag */
function firstTag(block, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block)
  return match ? match[1].trim() : null
}

/** @param {string} html */
function stripTags(html) { return html.replace(/<[^>]*>/g, '') }

/** @param {string} value */
function decodeEntities(value) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

/** @param {any[]} candidates */
function dedupeCandidates(candidates) {
  const seen = new Set()
  return candidates.filter((candidate) => {
    const key = `${candidate.field}\u0000${candidate.raw}\u0000${candidate.parsed?.earliest ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Classify source type without making an authority claim. `official` means a government domain,
 * `court` a court domain, `media` a known news domain, `unknown` otherwise.
 * @param {string} domain
 */
export function classifySource(domain) {
  const host = domain.toLowerCase()
  if (/(^|\.)(court\.gov\.cn)$/.test(host) || host.includes('court.gov')) return 'court'
  if (/(^|\.)(gov\.cn|gov)$/.test(host) || host.endsWith('.gov.cn')) return 'official'
  if (/(^|\.)(edu\.cn|edu)$/.test(host) || host.endsWith('.edu.cn')) return 'academic'
  if (host.endsWith('wikipedia.org') || host.endsWith('wikidata.org')) return 'reference'
  if (/(reuters|apnews|bbc|xinhuanet|people\.com\.cn|thepaper\.cn|caixin|nytimes|wsj|bloomberg|ft\.com)/.test(host)) return 'media'
  return 'unknown'
}
