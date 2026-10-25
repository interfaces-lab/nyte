export const SCHEMA = `
create table calls (scenario text, step text, session text, checkout text, at integer, changed integer, snapshot text);
create table leases (scenario text, step text, checkout text, session text, since integer, until integer);
create table kept (scenario text, step text, tree text);
create table dispatches (scenario text, step text, key text, owner text, decision text);
`;

export const NEVER_LOSE_WORK = `
select c.scenario, c.step, c.session, c.checkout, c.at
from calls c
where c.changed = 1
  and (
    (select count(distinct l.session) from leases l
      where l.scenario = c.scenario and l.step = c.step and l.checkout = c.checkout
        and l.since <= c.at and (l.until is null or c.at < l.until)) <> 1
    or not exists (select 1 from leases l
      where l.scenario = c.scenario and l.step = c.step and l.checkout = c.checkout and l.session = c.session
        and l.since <= c.at and (l.until is null or c.at < l.until))
    or c.snapshot is null
    or not exists (select 1 from kept k where k.scenario = c.scenario and k.step = c.step and k.tree = c.snapshot)
  )
`;

export const ONE_OWNER = `
select scenario, step, key, count(*) as dispatches, count(distinct owner) as owners
from dispatches
group by scenario, step, key
having count(*) <> 1 or count(distinct owner) <> 1
`;
