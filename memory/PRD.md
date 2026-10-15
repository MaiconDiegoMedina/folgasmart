# FolgaSmart — PRD

## Problema original
Informar nome, cargo e setor do funcionário e o app distribuir as folgas mantendo o maior número de funcionários operando, principalmente nos dias marcados como de maior movimento. Hoje: 1 folga semanal (6x1); em breve: escala 5x2.

## Escolhas do usuário
Cadastro manual + algoritmo automático; histórico de movimento via CSV; sem login; calendário semanal + exportação; interface em PT-BR.

## Arquitetura
- Backend FastAPI + MongoDB: employees, movement (documento único), schedule (documento único)
- Algoritmo guloso: custo = (folgas no dia + 1) × peso do movimento + penalidade por setor + 1000 para dia de pico
- Frontend React: Header (modo 6x1/5x2, gerar, exportar), ScheduleGrid, MovementPanel (recharts), EmployeesPanel

## Implementado (jun/2026)
- CRUD de funcionários, importação de CSV (delimitador , ou ;, datas ISO/BR, números no formato BR), picos detectados automaticamente e ajustáveis manualmente
- Geração da escala 6x1/5x2, edição manual célula a célula, cobertura por dia, alertas
- Exportação em CSV (Excel) e impressão/PDF, CSV modelo

## Backlog
- P1: editar funcionário pela interface; preferência de folga por funcionário; mínimo de pessoas por setor
- P1: folgas consecutivas no 5x2; rodízio entre semanas (folga no domingo alternada)
- P2: histórico de escalas; compartilhamento via WhatsApp
