import { GAME_VERSION, MATCH_ROOM_NAME } from '@borrifo/game-contracts';
import { issueDevCredential, TEST_DEV_SECRET } from '@borrifo/test-utils';
import { MAP_HASH } from './helpers';

/** Pede uma vaga pelo matchmaking HTTP (o caminho em que o limite por IP age), com cabeçalhos à escolha. */
export async function reserve(url: string, sid: string, user: string, headers: Record<string, string> = {}) {
  const credential = await issueDevCredential(TEST_DEV_SECRET, { userId: user, name: user, activitySessionId: sid });
  const r = await fetch(`${url}/matchmake/joinOrCreate/${MATCH_ROOM_NAME}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ activitySessionId: sid, credential, clientVersion: GAME_VERSION, mapHash: MAP_HASH }),
  });
  return { status: r.status, body: await r.text() };
}
