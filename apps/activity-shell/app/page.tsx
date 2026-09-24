import { cookies } from 'next/headers';
import LabHost from './_components/LabHost';
import { getLabConfig } from '@/lib/server/lab';
import { LAB_SESSION_COOKIE, verifyLabSession } from '@/lib/session';
import type { LabUser } from '@/lib/roster';

// A configuração vem do ambiente em tempo de execução (nunca pré-renderizar no build).
export const dynamic = 'force-dynamic';

export default async function Page() {
  const cfg = getLabConfig();
  let initialUser: LabUser | null = null;
  if (!cfg.isProduction && cfg.labSessionSecret) {
    const jar = await cookies();
    initialUser = await verifyLabSession(jar.get(LAB_SESSION_COOKIE)?.value, cfg.labSessionSecret).catch(() => null);
  }
  // Somente dados públicos atravessam para o cliente: nada de segredos nem da URL/chaves do LiveKit.
  return (
    <LabHost
      activityUrl={cfg.activityUrl}
      activityOrigin={cfg.activityOrigin}
      voiceConfigured={cfg.livekit !== null}
      initialUser={initialUser}
      isProduction={cfg.isProduction}
      standaloneEnabled={cfg.standaloneEnabled}
      labGameOrigin={cfg.labGameOrigin}
      problems={cfg.problems}
    />
  );
}
