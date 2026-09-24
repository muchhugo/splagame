/**
 * Roster e ACL FICTÍCIOS do laboratório de desenvolvimento. Não há contas reais:
 * qualquer pessoa com acesso à máquina escolhe um usuário da lista. Por isso todo
 * endpoint que usa este roster recusa NODE_ENV=production.
 */
export interface LabUser {
  id: string;
  displayName: string;
}

export const LAB_CHANNEL_ID = 'canal-arena-dev';
export const LAB_COMMUNITY_ID = 'comunidade-lab';

export const LAB_ROSTER: readonly LabUser[] = Object.freeze([
  { id: 'ana', displayName: 'Ana' },
  { id: 'bruno', displayName: 'Bruno' },
  { id: 'carla', displayName: 'Carla' },
  { id: 'davi', displayName: 'Davi' },
  { id: 'elis', displayName: 'Elis' },
  { id: 'fabio', displayName: 'Fábio' },
  { id: 'gabi', displayName: 'Gabi' },
  { id: 'hugo', displayName: 'Hugo' },
]);

export const LAB_USER_IDS = LAB_ROSTER.map((u) => u.id);

/**
 * Membros do canal #canal-arena-dev: todo o roster, exceto `hugo`, que existe
 * justamente para testar o caminho "usuário sem acesso" (403).
 */
const CHANNEL_MEMBERS: Readonly<Record<string, ReadonlySet<string>>> = {
  [LAB_CHANNEL_ID]: new Set(LAB_USER_IDS.filter((id) => id !== 'hugo')),
};

/** activitySessionId aceito pelo backend do laboratório (criado pela página host). */
export const ACTIVITY_SESSION_ID_RE = /^[a-z0-9-]{4,64}$/;

export function findLabUser(userId: string): LabUser | undefined {
  return LAB_ROSTER.find((u) => u.id === userId);
}

export function isChannelMember(userId: string, channelId: string = LAB_CHANNEL_ID): boolean {
  return CHANNEL_MEMBERS[channelId]?.has(userId) ?? false;
}

export function channelMemberIds(channelId: string = LAB_CHANNEL_ID): string[] {
  return LAB_USER_IDS.filter((id) => isChannelMember(id, channelId));
}
