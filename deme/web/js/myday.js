// My day: a person's own attendance, leave, KRAs and tasks, whatever their role.
// The two forms are drawn once; everything read from records is redrawn when it changes.

import { api, data } from './api.js';
import { info, esc, toast, busy, statusTag, num, $ } from './ui.js';
import { iso, today, fmtDate, fmtDay, fmtTime } from '../shared/util.js';

const LEAVE_TYPES = ['Casual', 'Sick', 'Earned', 'Unpaid'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const day = (isoDate) => fmtDate(`${isoDate}T00:00:00`);
const range = (from, to) => (from === to ? day(from) : `${day(from)} to ${day(to)}`);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

/** Working days (Monday to Saturday) of this month spent on leave: approved requests plus days HR marked as leave. */
function leaveDays(mine, T) {
  const month = T.slice(0, 7);
  const set = new Set((mine.month || []).filter((a) => a.status === 'leave').map((a) => a.date));
  for (const l of mine.leaves || []) {
    if (l.status !== 'approved' || !l.from || !l.to) continue;
    const d = new Date(`${l.from}T00:00:00`);
    for (let i = 0; i < 400 && iso(d) <= l.to; i++, d.setDate(d.getDate() + 1)) if (iso(d).slice(0, 7) === month && d.getDay() !== 0) set.add(iso(d));
  }
  return set.size;
}

export function mount(el) {
  el.innerHTML = `
    <div class="workspace work"><div class="workspace-inner">
      <div class="view-head">
        <div class="title-row"><h1 class="reveal">My day</h1>${info('Your own attendance, leave, KRAs and tasks. Check in when you arrive and check out when you leave. HR sees the same entries under People and approves leave there.', 'My day')}</div>
        <p class="wk-date">${esc(fmtDay(today()))}</p>
      </div>
      <p class="md-unlinked" id="mdUnlinked" hidden>Your login is not linked to an employee record yet. HR can link it.</p>
      <div class="md-cols">
        <div class="md-col">
          <section class="panel wk-edge md-check" id="mdCheck" aria-label="Attendance today"></section>
          <section id="mdMonth" aria-labelledby="mdMonthH"></section>
          <section class="panel" id="mdLeave" aria-labelledby="mdLeaveH">
            <div class="panel-head"><div class="title-row"><h2 id="mdLeaveH">Leave</h2>${info('Apply here; HR approves or rejects the request. Approved leave other than unpaid leave is paid in payroll.', 'Leave')}</div></div>
            <form class="panel-pad md-form" id="mdLeaveForm" novalidate>
              <div class="field"><label for="mdFrom">From</label><input class="input" type="date" id="mdFrom" required></div>
              <div class="field"><label for="mdTo">To</label><input class="input" type="date" id="mdTo" required></div>
              <div class="field"><label for="mdType">Type</label><select class="select" id="mdType">${LEAVE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select></div>
              <div class="field"><label for="mdReason">Reason</label><input class="input" type="text" id="mdReason" autocomplete="off"></div>
              <div class="md-wide"><button class="btn btn-primary" type="submit">Apply for leave</button></div>
            </form>
            <div id="mdLeaves"></div>
          </section>
        </div>
        <div class="md-col">
          <section class="panel" id="mdTasks" aria-labelledby="mdTasksH" hidden></section>
          <section class="panel" id="mdKras" aria-labelledby="mdKrasH"></section>
          <section class="panel" aria-labelledby="mdPassH">
            <div class="panel-head"><h2 id="mdPassH">Change my password</h2></div>
            <form class="panel-pad md-form" id="mdPassForm" novalidate>
              <div class="field"><label for="mdPw1">New password</label><input class="input" type="password" id="mdPw1" autocomplete="new-password" minlength="8" required></div>
              <div class="field"><label for="mdPw2">New password again</label><input class="input" type="password" id="mdPw2" autocomplete="new-password" minlength="8" required></div>
              <p class="error md-wide" id="mdPassErr" role="alert" hidden></p>
              <div class="md-wide"><button class="btn btn-primary" type="submit">Change password</button></div>
            </form>
          </section>
        </div>
      </div>
    </div></div>`;

  function renderCheck(mine) {
    const t = mine.today, inAt = t?.inAt, outAt = t?.outAt;
    const state = !inAt ? 'out' : !outAt ? 'in' : 'done';
    const times = (inAt ? `<div><p class="eyebrow">In</p><p class="md-time">${esc(fmtTime(inAt))}</p></div>` : '') + (outAt ? `<div><p class="eyebrow">Out</p><p class="md-time">${esc(fmtTime(outAt))}</p></div>` : '');
    $('#mdCheck', el).innerHTML = `
      <p class="eyebrow">${esc(mine.employee.name)}${mine.employee.designation ? ` · ${esc(mine.employee.designation)}` : ''}</p>
      <p class="md-state">${state === 'out' ? 'Not checked in' : state === 'in' ? 'Checked in' : 'Checked in and out'}</p>
      ${times ? `<div class="md-times">${times}</div>` : ''}
      ${state === 'done' ? '' : `<button type="button" class="btn btn-primary wk-bigbtn" id="mdCheckBtn" data-do="${state === 'out' ? 'hr.checkin' : 'hr.checkout'}">${state === 'out' ? 'Check in' : 'Check out'}</button>`}`;
  }

  function renderMonth(mine, T) {
    const month = mine.month || [];
    const tile = (label, n) => `<div class="kpi"><p class="kpi-label">${label}</p><p class="kpi-value">${esc(num(n))}</p></div>`;
    $('#mdMonth', el).innerHTML = `
      <p class="eyebrow md-month-h" id="mdMonthH">This month · ${esc(MONTHS[Number(T.slice(5, 7)) - 1])}</p>
      <div class="kpis">${tile('Days present', month.filter((a) => a.status === 'present').length)}${tile('Half days', month.filter((a) => a.status === 'half').length)}${tile('Leave days', leaveDays(mine, T))}</div>`;
  }

  function renderLeaves(mine) {
    const list = [...(mine.leaves || [])].sort((a, b) => String(b.from).localeCompare(String(a.from)));
    $('#mdLeaves', el).innerHTML = list.length
      ? `<ul class="md-list">${list.map((l) => `<li><div class="md-row-main"><strong>${esc(range(l.from, l.to))}</strong><span class="md-row-sub">${esc(l.type || 'Leave')} · ${esc(plural(daysBetween(l.from, l.to), 'day'))}${l.reason ? ` · ${esc(l.reason)}` : ''}</span></div>${statusTag('leaves', l.status)}</li>`).join('')}</ul>`
      : '<p class="wk-none md-line">No leave requests yet.</p>';
  }

  function renderKras(mine) {
    const list = [...(mine.kras || [])].sort((a, b) => String(b.period).localeCompare(String(a.period), undefined, { numeric: true }));
    const cell = (v, suffix = '') => (v === undefined || v === null || v === '' ? '<span class="faint">–</span>' : esc(`${typeof v === 'number' ? num(v, 2) : v}${suffix}`));
    $('#mdKras', el).innerHTML = `
      <div class="panel-head"><div class="title-row"><h2 id="mdKrasH">My KRAs</h2>${info('Key result areas set for you by HR for each period, each with a target, a weight and a score once it is reviewed.', 'My KRAs')}</div></div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Period</th><th>KRA</th><th>Target</th><th class="num">Weight</th><th class="num">Score</th></tr></thead>
        <tbody>${list.map((k) => `<tr><td>${cell(k.period)}</td><td>${cell(k.title)}</td><td>${cell(k.target)}</td><td class="num">${cell(k.weight, '%')}</td><td class="num">${cell(k.score)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="wk-none">No KRAs set for you yet.</p>'}`;
  }

  function renderTasks(T) {
    const box = $('#mdTasks', el);
    box.hidden = !data.canRead('tasks');
    if (box.hidden) return;
    const list = data.all('tasks').filter((t) => t.assignee === data.user.id && t.status !== 'done').sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
    const canDo = data.canWrite('tasks');
    box.innerHTML = `
      <div class="panel-head"><h2 id="mdTasksH">My tasks</h2>${list.length ? `<span class="wk-n">${esc(num(list.length))}</span>` : ''}</div>
      ${list.length ? `<ul class="md-list">${list.map((t) => `<li>
          <div class="md-row-main"><strong>${esc(t.title)}</strong><span class="md-row-sub">${esc([data.title('projects', t.project), t.due ? `Due ${day(t.due)}` : 'No due date'].filter(Boolean).join(' · '))}</span></div>
          <div class="md-row-end">${t.due && t.due < T ? '<span class="tag tag-crit">Overdue</span>' : statusTag('tasks', t.status)}${canDo ? `<button type="button" class="btn btn-sm btn-outline" data-task="${esc(t.id)}">Done</button>` : ''}</div>
        </li>`).join('')}</ul>`
    : '<p class="wk-none">No open tasks for you.</p>'}`;
  }

  function render() {
    const T = iso(today());
    const mine = data.mine || {};
    const linked = !!mine.employee;
    $('#mdUnlinked', el).hidden = linked;
    $('.md-cols', el).classList.toggle('is-unlinked', !linked);
    for (const id of ['#mdCheck', '#mdMonth', '#mdLeave', '#mdKras']) $(id, el).hidden = !linked;
    if (linked) { renderCheck(mine); renderMonth(mine, T); renderLeaves(mine); renderKras(mine); }
    renderTasks(T);
  }

  // Listen on this screen's own root, not on el: el is the router's #view and outlives this screen.
  $('.workspace', el).addEventListener('click', (e) => {
    const check = e.target.closest('#mdCheckBtn'), task = e.target.closest('[data-task]');
    if (check) busy(check, async () => { const out = await api.act(check.dataset.do); toast(out.message || 'Saved.'); });
    else if (task) busy(task, async () => { const out = await api.act('task.done', {}, { entity: 'tasks', id: task.dataset.task }); toast(out.message || 'Task done.'); });
  });

  const leaveForm = $('#mdLeaveForm', el);
  $('#mdFrom', el).addEventListener('change', (e) => { const to = $('#mdTo', el); to.min = e.target.value; if (!to.value || to.value < e.target.value) to.value = e.target.value; });
  leaveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(leaveForm.querySelector('button[type="submit"]'), async () => {
      const out = await api.act('hr.applyLeave', { from: $('#mdFrom', el).value, to: $('#mdTo', el).value, type: $('#mdType', el).value, reason: $('#mdReason', el).value.trim() });
      leaveForm.reset(); $('#mdTo', el).min = '';
      toast(out.message || 'Leave applied for.');
    });
  });

  const passForm = $('#mdPassForm', el), passErr = $('#mdPassErr', el);
  passForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const a = $('#mdPw1', el).value, b = $('#mdPw2', el).value;
    const problem = a.length < 8 ? 'Use a password of at least 8 characters.' : a !== b ? 'The two passwords are not the same. Type the new password again.' : '';
    passErr.textContent = problem; passErr.hidden = !problem;
    if (problem) { (a.length < 8 ? $('#mdPw1', el) : $('#mdPw2', el)).focus(); return; }
    busy(passForm.querySelector('button[type="submit"]'), async () => {
      await api.updateUser(data.user.id, { password: a });
      passForm.reset();
      toast('Your password is changed.');
    });
  });

  render();
  return data.on(render);
}
