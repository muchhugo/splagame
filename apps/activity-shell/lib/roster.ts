/**
 * Roster e ACL FICTÍCIOS do laboratório de desenvolvimento. Não há contas reais:
 * qualquer pessoa com acesso à máquina escolhe um usuário da lista. Por isso todo
 * endpoint que usa este roster recusa NODE_ENV=production.
 */
export interface LabUser {
  id: string;
  /** Nome de usuário (sempre existe). */
  username: string;
  /** Nome de exibição do perfil (pode faltar, como no Trivo). */
  displayName: string;
  /** Apelido nesta comunidade (opcional; tem prioridade). */
  nickname?: string;
}

export const LAB_CHANNEL_ID = 'canal-arena-dev';
export const LAB_COMMUNITY_ID = 'comunidade-lab';

/**
 * Perfis fictícios que exercitam a regra de nome (apelido → nome de exibição →
 * usuário) e os limites: apelido longo (cortado em 24), com emoji, com marcação
 * (vira texto) e perfil sem nome de exibição.
 */
export const LAB_ROSTER: readonly LabUser[] = Object.freeze([
  { id: 'ana', username: 'ana.souza', displayName: 'Ana', nickname: 'Aninha' },
  { id: 'bruno', username: 'bruno.lima', displayName: 'Bruno' },
  { id: 'carla', username: 'carla', displayName: 'Carla', nickname: 'Carla ✨' },
  { id: 'davi', username: 'davi_r', displayName: 'Davi', nickname: 'Davi, o Destruidor de Moringas' },
  { id: 'elis', username: 'elis', displayName: 'Elis', nickname: 'Elis <b>negrito</b>' },
  { id: 'fabio', username: 'fabio_22', displayName: '' },
  { id: 'gabi', username: 'gabi', displayName: 'Gabriela', nickname: 'Gabi' },
  // duas contas diferentes com o MESMO nome: tudo deve ser ligado por id, nunca pelo texto
  { id: 'joao-silva', username: 'joao.silva', displayName: 'João' },
  { id: 'joao-souza', username: 'joao.souza', displayName: 'João' },
  { id: 'hugo', username: 'hugo', displayName: 'Hugo' },
]);

/** Nome da conta no host do laboratório (sem apelido de comunidade). */
export function accountName(u: LabUser): string {
  return u.displayName || u.username;
}

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
