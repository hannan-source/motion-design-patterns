// Customers pack: the people a business talks to and the deals in progress with them.
// See packs.js for the contract this file keeps.

import { S, opt } from './defs.js';

const OPEN = ['new', 'talking', 'proposal'];

export const CRM_ENTITIES = [
  { id: 'contacts', module: 'crm', name: 'Contacts', one: 'Contact', title: 'name',
    info: 'People the business talks to: leads, buyers at a customer, partners. A contact can belong to a customer in Masters. Keep only what is needed to do business with them; a contact can be erased on request from Privacy.',
    fields: [['name', 'Name', 'text', { req: true, list: true, personal: true }], ['company', 'Company', 'text', { list: true }], ['customer', 'Customer', 'ref', { ref: 'customers' }],
      ['kind', 'Kind', 'select', { def: 'lead', list: true, options: opt(['lead', 'Lead'], ['customer', 'Customer'], ['partner', 'Partner'], ['supplier', 'Supplier'], ['other', 'Other']) }],
      ['email', 'Email', 'text', { list: true, personal: true }], ['phone', 'Phone', 'text', { personal: true }], ['country', 'Country', 'text', {}],
      ['source', 'Came from', 'select', { options: opt('Referral', 'Website', 'Social', 'Trade show', 'Outreach', 'Walk-in', 'Other') }], ['owner', 'Looked after by', 'user', { list: true }], ['notes', 'Notes', 'long', {}]] },
  { id: 'deals', module: 'crm', name: 'Deals', one: 'Deal', no: 'DL', title: 'title',
    info: 'Something a contact may buy, from first conversation to won or lost. The value is an estimate until it is won. Nothing here is an invoice: a won deal is the cue to raise the order.',
    statuses: S(['new', 'New'], ['talking', 'Talking', 'info'], ['proposal', 'Proposal sent', 'warn'], ['won', 'Won', 'ok'], ['lost', 'Lost', 'crit']), initial: 'new', editWhen: [...OPEN, 'won', 'lost'],
    fields: [['title', 'Deal', 'text', { req: true, list: true }], ['contact', 'Contact', 'ref', { ref: 'contacts', list: true }], ['value', 'Value', 'money', { list: true }],
      ['currency', 'Currency', 'select', { def: 'INR', options: opt('INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD') }], ['closeBy', 'Expected by', 'date', { list: true }], ['owner', 'Looked after by', 'user', { list: true }],
      ['nextStep', 'Next step', 'text', {}], ['lostWhy', 'Why it was lost', 'text', { ro: true }], ['closedOn', 'Closed on', 'date', { ro: true }], ['notes', 'Notes', 'long', {}]],
    actions: [{ id: 'deal.forward', label: 'Move forward', when: ['new', 'talking'] }, { id: 'deal.won', label: 'Won', when: OPEN }, { id: 'deal.lost', label: 'Lost', when: OPEN, form: [['why', 'Why it was lost', 'text', { req: true }]] }, { id: 'deal.reopen', label: 'Reopen', when: ['won', 'lost'] }] },
];

export const CRM_ACTIONS = {
  'deal.forward': { run(ctx, _p, doc) { ctx.setStatus('deals', doc, OPEN[OPEN.indexOf(doc.status) + 1]); } },
  'deal.won': { run(ctx, _p, doc) { doc.closedOn = ctx.today; ctx.setStatus('deals', doc, 'won'); if (doc.owner) ctx.notify(doc.owner, `Deal won: ${doc.title}`, 'e-deals'); return { message: 'Marked as won. Raise the order for it when it is confirmed.' }; } },
  'deal.lost': { run(ctx, p, doc) { doc.closedOn = ctx.today; doc.lostWhy = String(p.why || '').trim(); ctx.setStatus('deals', doc, 'lost'); } },
  'deal.reopen': { run(ctx, _p, doc) { doc.closedOn = ''; doc.lostWhy = ''; ctx.setStatus('deals', doc, 'talking'); } },
};
