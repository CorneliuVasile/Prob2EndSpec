import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server.js';

const dir = mkdtempSync(join(tmpdir(), 'questly-edge-'));
const path = join(dir, 'persist.sqlite');
const at = '2026-10-24T09:00:00+03:00';
const headers = { 'x-now': at };
const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
let app = buildApp(path);
try {
  const quest = await app.inject({method:'POST',url:'/quests',headers,payload:{title:'Read',difficulty:'medium',recurrence:'daily'}});
  assert(quest.statusCode === 201, 'create quest');
  const id = quest.json().id as string;
  const [first, second] = await Promise.all([
    app.inject({method:'POST',url:`/quests/${id}/complete`,headers}),
    app.inject({method:'POST',url:`/quests/${id}/complete`,headers})
  ]);
  assert([first.statusCode, second.statusCode].sort().join(',') === '200,201', 'duplicate completion should be idempotent');
  const completionId = first.json().completion.id as string;
  const me = (await app.inject({method:'GET',url:'/me',headers})).json();
  assert(me.xp === 27 && me.streak === 1, 'one day grants 25 + 2 XP');
  await app.close();
  app = buildApp(path);
  const persisted = (await app.inject({method:'GET',url:'/me',headers})).json();
  assert(persisted.xp === 27, 'XP persists across app restart');
  assert((await app.inject({method:'GET',url:'/quests',headers})).json().length === 1, 'quest persists');
  const undone = await app.inject({method:'DELETE',url:`/completions/${completionId}`,headers});
  assert(undone.statusCode === 204, 'undo completion');
  const after = (await app.inject({method:'GET',url:'/me',headers})).json();
  assert(after.xp === 0 && after.streak === 0, 'undo recalculates XP and streak');
  const again = await app.inject({method:'POST',url:`/quests/${id}/complete`,headers});
  assert(again.statusCode === 201, 'quest can be completed again after undo');
  const badTimezone = await app.inject({method:'PUT',url:'/me',headers,payload:{timezone:'Never/A_Real_Zone'}});
  assert(badTimezone.statusCode === 400, 'invalid timezone rejected');
  console.log('PASS: duplicate completion, SQLite restart, undo/recomplete, invalid timezone');
} finally {
  await app.close();
  rmSync(dir,{recursive:true,force:true});
}
