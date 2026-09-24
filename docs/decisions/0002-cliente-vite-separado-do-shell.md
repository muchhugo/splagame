# 0002 — Jogo em Vite + React, numa origem separada do shell Next.js

**Contexto.** O briefing sugere React/Next.js no shell. O jogo roda num iframe com
`sandbox="allow-scripts allow-same-origin …"`, o que só é seguro se o jogo estiver numa
**origem diferente** do host. O runtime 3D (Babylon, Rapier WASM, WebAudio) não deve passar por
SSR.

**Decisão.** O shell de laboratório é Next.js 16 (`apps/activity-shell`). O jogo é uma
aplicação Vite + React 19 (`apps/game-client`) servida em outra origem (porta 5173 em dev).
React cuida de menus e HUD; o loop da engine não passa pelo estado React.

**Consequência.** O isolamento do iframe é real, e o bundle do jogo é estático e pode ir para
qualquer CDN. O host precisa conhecer a origem do jogo, e o jogo precisa conhecer a origem do
host (`VITE_ALLOWED_HOST_ORIGINS`), o que é intencional.
