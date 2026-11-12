// Talking to the outside: Shopify (orders in) and Meta (ad spend in). Each function takes the
// environment and a fetch, asks the other system, and returns plain rows in the shape the
// service's own actions take ('shopify.ingest', 'media.ingest'). Nothing here touches the database.
//
// Customer details are kept to the least that production needs: a name and a country. Email,
// phone and street address are never asked for, so they are never stored.

import { createHmac, timingSafeEqual } from 'node:crypto';

const clean = (s) => String(s ?? '').trim();
const channelOf = (source = '', medium = '') => {
  const s = `${source} ${medium}`.toLowerCase();
  if (/facebook|instagram|meta|\bfb\b|\big\b/.test(s)) return 'Meta';
  if (/google|adwords|gclid|youtube/.test(s)) return 'Google';
  if (/email|klaviyo|newsletter|mailchimp/.test(s)) return 'Email';
  if (/influencer|creator/.test(s)) return 'Influencer';
  if (/affiliate/.test(s)) return 'Affiliate';
  return clean(source) ? 'Other' : 'Direct';
};

export const shopifyReady = (env) => !!(env.SHOPIFY_STORE && env.SHOPIFY_TOKEN);
const shopHost = (env) => clean(env.SHOPIFY_STORE).replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const ORDERS = `query($q: String!, $after: String) { orders(first: 50, after: $after, query: $q, sortKey: CREATED_AT) {
  pageInfo { hasNextPage endCursor }
  nodes { name createdAt note displayFinancialStatus displayFulfillmentStatus
    customer { displayName } shippingAddress { countryCodeV2 }
    totalPriceSet { shopMoney { amount currencyCode } }
    customerJourneySummary { lastVisit { utmParameters { source medium campaign } } }
    lineItems(first: 50) { nodes { title quantity sku variantTitle customAttributes { key value } } } } } }`;

/** Orders created on or after `since` (YYYY-MM-DD), through Shopify's Admin GraphQL API. */
export async function pullShopifyOrders({ env, fetchImpl = fetch, since }) {
  if (!shopifyReady(env)) throw new Error('Shopify is not connected.');
  const url = `https://${shopHost(env)}/admin/api/${env.SHOPIFY_API_VERSION || '2026-07'}/graphql.json`;
  const out = []; let after = null;
  for (let page = 0; page < 40; page++) {
    const res = await fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', 'x-shopify-access-token': env.SHOPIFY_TOKEN }, body: JSON.stringify({ query: ORDERS, variables: { q: `created_at:>=${since}`, after } }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.errors) throw new Error(`Shopify did not answer as expected (${res.status}${body.errors ? `: ${JSON.stringify(body.errors).slice(0, 200)}` : ''}).`);
    const conn = body.data?.orders; if (!conn) break;
    for (const o of conn.nodes || []) {
      const utm = o.customerJourneySummary?.lastVisit?.utmParameters || {};
      out.push({
        orderNo: clean(o.name), date: clean(o.createdAt).slice(0, 10), customerName: clean(o.customer?.displayName), country: clean(o.shippingAddress?.countryCodeV2),
        currency: clean(o.totalPriceSet?.shopMoney?.currencyCode) || 'INR', amount: Number(o.totalPriceSet?.shopMoney?.amount) || 0, note: clean(o.note),
        paid: ['PAID', 'PARTIALLY_REFUNDED', 'PARTIALLY_PAID'].includes(o.displayFinancialStatus), shipped: o.displayFulfillmentStatus === 'FULFILLED',
        channel: channelOf(utm.source, utm.medium), campaign: clean(utm.campaign),
        lines: (o.lineItems?.nodes || []).map((l) => ({ sku: clean(l.sku), title: clean(l.title), variant: clean(l.variantTitle), qty: l.quantity || 1, notes: (l.customAttributes || []).filter((a) => !String(a.key).startsWith('_')).map((a) => `${a.key}: ${a.value}`).join('\n') })),
      });
    }
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

/** Is this webhook really from Shopify? `raw` is the body exactly as it arrived. */
export function shopifyWebhookOk(env, raw, header) {
  if (!env.SHOPIFY_WEBHOOK_SECRET || !header) return false;
  const want = createHmac('sha256', env.SHOPIFY_WEBHOOK_SECRET).update(raw, 'utf8').digest();
  let got; try { got = Buffer.from(String(header), 'base64'); } catch { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}
/** An order as Shopify's webhooks send it (orders/paid, orders/create), in the shape 'shopify.ingest' takes. */
export function fromShopifyWebhook(o = {}) {
  const u = new URLSearchParams(String(o.landing_site || '').split('?')[1] || '');
  return {
    orderNo: clean(o.name), date: clean(o.created_at).slice(0, 10), customerName: [o.customer?.first_name, o.customer?.last_name].map(clean).filter(Boolean).join(' '), country: clean(o.shipping_address?.country_code),
    currency: clean(o.currency) || 'INR', amount: Number(o.total_price) || 0, note: clean(o.note), paid: ['paid', 'partially_refunded', 'partially_paid'].includes(o.financial_status), shipped: o.fulfillment_status === 'fulfilled',
    channel: channelOf(u.get('utm_source') || o.source_name === 'web' ? u.get('utm_source') || '' : o.source_name, u.get('utm_medium') || ''), campaign: clean(u.get('utm_campaign')),
    lines: (o.line_items || []).map((l) => ({ sku: clean(l.sku), title: clean(l.title), variant: clean(l.variant_title), qty: l.quantity || 1, notes: (l.properties || []).filter((p) => !String(p.name).startsWith('_')).map((p) => `${p.name}: ${p.value}`).join('\n') })),
  };
}

export const metaReady = (env) => !!(env.META_AD_ACCOUNT && env.META_TOKEN);
/** Spend by day and campaign from Meta's Marketing API, in the shape 'media.ingest' takes. */
export async function pullMetaSpend({ env, fetchImpl = fetch, since, until }) {
  if (!metaReady(env)) throw new Error('Meta is not connected.');
  const acct = clean(env.META_AD_ACCOUNT).replace(/^act_/, '');
  let url = `https://graph.facebook.com/${env.META_API_VERSION || 'v23.0'}/act_${acct}/insights?${new URLSearchParams({ level: 'campaign', time_increment: '1', fields: 'campaign_name,spend,impressions,clicks,actions,action_values,account_currency', time_range: JSON.stringify({ since, until }), limit: '500' })}`;
  const rows = [];
  for (let page = 0; url && page < 20; page++) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${env.META_TOKEN}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Meta did not answer as expected (${res.status}${body.error ? `: ${String(body.error.message).slice(0, 200)}` : ''}).`);
    const pick = (list, type) => Number((list || []).find((a) => a.action_type === type || a.action_type === `offsite_conversion.fb_pixel_${type}`)?.value) || 0;
    for (const r of body.data || []) rows.push({ date: r.date_start, channel: 'Meta', campaign: clean(r.campaign_name), spend: Number(r.spend) || 0, currency: clean(r.account_currency) || 'INR', impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0, purchases: pick(r.actions, 'purchase'), revenue: pick(r.action_values, 'purchase') });
    url = body.paging?.next || null;
  }
  return rows;
}
