import { describe, expect, it } from 'vitest';
import { cleanName, resolveDisplayName, sanitizeAvatarUrl } from '../src';

describe('nome e avatar de perfil', () => {
  it('prioridade: apelido → nome de exibição → usuário → padrão', () => {
    expect(resolveDisplayName({ nickname: 'Aninha', displayName: 'Ana', username: 'ana' })).toBe('Aninha');
    expect(resolveDisplayName({ nickname: '   ', displayName: 'Ana', username: 'ana' })).toBe('Ana');
    expect(resolveDisplayName({ displayName: '', username: 'fabio_22' })).toBe('fabio_22');
    expect(resolveDisplayName({})).toBe('Jogador');
    expect(resolveDisplayName({ nickname: 42 as unknown as string, displayName: 'Ana' })).toBe('Ana');
  });
  it('texto limpo: sem controle/direção, sem < >, espaços normalizados, até 24 caracteres (emoji conta 1)', () => {
    expect(cleanName('  Elis‮  <b>x</b>\n')).toBe('Elis bx/b');
    expect([...cleanName('🎨'.repeat(40))].length).toBe(24);
    expect(cleanName('a​b')).toBe('ab');
  });
  it('avatar: só https de host permitido, sem credenciais na URL', () => {
    const hosts = ['avatars.trivo.test'];
    expect(sanitizeAvatarUrl('https://avatars.trivo.test/a.png', hosts)).toBe('https://avatars.trivo.test/a.png');
    expect(sanitizeAvatarUrl('http://avatars.trivo.test/a.png', hosts)).toBeNull();
    expect(sanitizeAvatarUrl('https://outro.test/a.png', hosts)).toBeNull();
    expect(sanitizeAvatarUrl('https://u:p@avatars.trivo.test/a.png', hosts)).toBeNull();
    expect(sanitizeAvatarUrl('javascript:alert(1)', hosts)).toBeNull();
    expect(sanitizeAvatarUrl('https://avatars.trivo.test/a.png', [])).toBeNull();
  });
});
