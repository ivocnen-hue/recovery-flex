# Recovery Frontend V2 — Fase 1

Frontend estático profissional do Recovery. A UI apresenta respostas validadas do Worker; não contém parsing de planilhas, conciliação, regras ou cálculos financeiros.

## Stack

React, TypeScript, Vite, React Router, TanStack Query, Zod, Vitest e React Testing Library. O visual usa CSS próprio por sistema de design.

## Setup e comandos

Instale com pnpm install, copie .env.example para .env e inicie com pnpm dev.

- pnpm typecheck: valida os tipos.
- pnpm lint: valida padrões do código.
- pnpm test: roda testes de contrato, UI e regressão.
- pnpm build: gera o bundle estático.

Variáveis públicas:

- VITE_API_BASE_URL: origem do Worker, sem secrets.
- VITE_DEMO_MODE: true usa apenas src/mocks/demoData.ts; false tenta os endpoints reais.

Nunca coloque tokens em variáveis VITE_*, pois elas entram no bundle público. Autenticação futura deve usar cookie HttpOnly.

## Arquitetura

- src/app: router, providers e Error Boundary.
- src/pages: Dashboard, Auditorias, Nova Auditoria e Findings.
- src/components: layout, tabelas, estados e cadeia de evidências.
- src/api: único local autorizado a usar fetch; query keys e serviços.
- src/contracts: schemas Zod e tipos inferidos.
- src/hooks: ligação TanStack Query entre páginas, API e demo mode.
- src/lib: formatação apenas visual e erros.
- src/mocks: demonstração isolada.
- tests/fixtures: exemplos do contrato do Worker.

## Contrato da API

Cada resposta segue fetch → status HTTP → JSON → Zod → UI. Uma divergência gera SCHEMA_MISMATCH; o frontend não tenta reparar ou inferir campos. O diagnóstico guarda apenas endpoint, status, versão, nomes dos campos e issues Zod — nunca linhas de planilhas.

O código legado expõe somente a chamada real POST /api/map-file. Ela não executa o fluxo canônico e não foi reutilizada. As abstrações abaixo aguardam implementação no Worker:

- GET /api/v1/audits
- GET /api/v1/audits/:id
- POST /api/v1/audits
- POST /api/v1/audits/:id/sources
- POST /api/v1/audits/:id/run
- GET /api/v1/audits/:id/findings
- GET /api/v1/audits/:id/evidence

Enquanto isso, VITE_DEMO_MODE=true mostra um badge claro e nunca mistura mocks com respostas reais. Executar auditoria retorna NOT_IMPLEMENTED; não há fallback local.

## Evolução

Para página nova, crie a pasta em src/pages, registre a rota em src/app/router.tsx e a navegação no AppShell. Para endpoint novo, adicione primeiro o schema Zod, depois o método em src/api e sua query key. Componentes de domínio ficam em sua pasta; primitivas genéricas ficam em components/ui.
