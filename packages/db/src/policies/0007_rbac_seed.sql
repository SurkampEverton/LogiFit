-- packages/db/src/policies/0007_rbac_seed.sql
-- Sprint 01a Faixa C — seed canônico de system roles + permissions catálogo.
--
-- **IDEMPOTENTE** via INSERT ... ON CONFLICT DO NOTHING. Roda em todo migrate
-- — adicionar role/permission nova = nova linha aqui ou migration dedicada
-- (preferida pra audit trail).
--
-- Convenção:
--   - System roles (tenant_id=NULL, system=true) — não editáveis, idênticas
--     em todos os tenants
--   - Permissions: chave canônica `namespace.action` (member.read, invoice.cancel)
--   - `requires_mfa=true` em roles profissionais (regra 43)
--
-- **Esta lista é o piso mínimo Sprint 01a.** Sprint 02 (CRM) adiciona
-- permissions específicas; sprint 04 (financeiro) adiciona invoice.* / dre.*;
-- sprint 20 (fisio) adiciona prontuario.* / evolucao.* etc.

-- ─── System roles ────────────────────────────────────────────────────────
INSERT INTO roles (key, label, description, tenant_id, requires_mfa, system) VALUES
  ('super_admin',  'Super Admin LogiFit', 'Equipe LogiFit interna — suporte/operação',                   NULL, true,  true),
  ('tenant_owner', 'Dono do Tenant',      'Cria/gerencia tenant, billing, configurações globais',        NULL, true,  true),
  ('gerente',      'Gerente',             'Administrador operacional do tenant (não dono)',              NULL, false, true),
  ('recepcao',     'Recepção',            'Operação de atendimento (cadastro, agenda, cobrança simples)',NULL, false, true),
  ('medico',       'Médico',              'Profissional CRM — prontuário com ICP-Brasil obrigatória',    NULL, true,  true),
  ('fisio',        'Fisioterapeuta',      'Profissional CREFITO — evolução SOAP + alta',                 NULL, true,  true),
  ('nutri',        'Nutricionista',       'Profissional CRN — plano alimentar + diário',                 NULL, true,  true),
  ('personal',     'Personal Trainer',    'Profissional CREF — prescrição treino + acompanhamento',      NULL, true,  true),
  ('enfermeiro',   'Enfermeiro',          'Profissional COREN — atendimento clínico assistido',          NULL, true,  true),
  ('dpo',          'DPO',                 'Data Protection Officer (LGPD art. 41) — privacy@',           NULL, true,  true),
  ('contador_externo', 'Contador Externo',   'Acesso read-only ao fiscal (LGPD scope mínimo)',           NULL, false, true),
  ('member',       'Aluno/Paciente',      'Member self-service (portal /meu/*) — opera só os próprios dados', NULL, false, true)
ON CONFLICT DO NOTHING;

-- ─── Permissions catálogo ────────────────────────────────────────────────
-- Lista MVP — sprints donos adicionam mais via migration dedicada.
INSERT INTO permissions (key, label, description, category, is_high_risk) VALUES
  -- Identidade
  ('user.read',                'Ler usuários',          'Listar usuários do tenant',                       'identidade', false),
  ('user.write',               'Criar/editar usuários', 'Convidar + editar (não alterar role)',            'identidade', false),
  ('user.role.update',         'Alterar role de user',  'Mudar role/scope de outro user — HIGH RISK',      'identidade', true),
  ('user.delete',              'Desativar usuário',     'Desabilitar conta (não DELETE — soft)',            'identidade', true),
  ('role.read',                'Ler roles',             'Listar roles do tenant',                          'identidade', false),
  ('role.write',               'Criar/editar role custom', 'Custom roles per-tenant — não system',         'identidade', false),
  ('grant.create',             'Conceder grant direto', 'Bypass de role pra user específico — HIGH RISK',  'identidade', true),

  -- Identidade / persons
  ('person.read',              'Ler pessoas',           'Listar persons (PF/PJ) do tenant',                'identidade', false),
  ('person.write',             'Criar/editar pessoa',   'Cadastrar PF/PJ + atualizar dados',               'identidade', false),
  ('person.archive',           'Arquivar pessoa',       'Soft-delete (mantém histórico)',                  'identidade', false),
  ('cnpj.lookup',              'Consultar CNPJ',        'Buscar dados Receita Federal',                    'identidade', false),
  ('cnpj.settings',            'Configurar provider CNPJ', 'BrasilAPI/ReceitaWS/CNPJá! + credentials',     'identidade', false),

  -- Empresa
  ('company.read',             'Ler empresas',          'Listar matriz/filial do tenant',                  'empresa', false),
  ('company.write',            'Criar/editar company',  'Configurar matriz + filiais (regra 21)',          'empresa', false),
  ('company.tenant_settings',  'Config tenant',         'topology, financial_mode, cross_company_access',  'empresa', true),
  ('unit.read',                'Ler units',             'Listar locais físicos',                           'empresa', false),
  ('unit.write',               'Criar/editar unit',     'Cadastrar/editar local físico',                   'empresa', false),

  -- Member (CRM)
  ('member.read',              'Ler members',           'Listar alunos/pacientes',                         'crm',     false),
  ('member.write',             'Criar/editar member',   'Cadastrar + atualizar dados',                     'crm',     false),
  ('member.anonymize',         'Anonimizar member',     'LGPD direito ao esquecimento — HIGH RISK',        'crm',     true),

  -- Sessão / segurança
  ('session.read.own',         'Ver próprias sessões',  '/meu/sessoes — listar dispositivos ativos',       'seguranca', false),
  ('session.revoke.own',       'Encerrar próprias sessões', 'Revoke por dispositivo',                      'seguranca', false),
  ('session.revoke.others',    'Encerrar sessões de outros users', 'Admin force-logout — HIGH RISK',      'seguranca', true),
  ('mfa.enroll',               'Habilitar MFA',         'Configurar TOTP / WebAuthn',                      'seguranca', false),
  ('mfa.reset.others',         'Resetar MFA de outros', 'Admin recovery sem perda de conta — HIGH RISK',  'seguranca', true)
ON CONFLICT DO NOTHING;

-- ─── Grants iniciais: super_admin tem TUDO; tenant_owner quase tudo ──────
-- super_admin: todas as permissions
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'super_admin'
ON CONFLICT DO NOTHING;

-- tenant_owner: tudo EXCETO super_admin-only (none por enquanto)
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'tenant_owner'
ON CONFLICT DO NOTHING;

-- gerente: tudo de operacional, exceto config tenant + high-risk identity
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'gerente'
  AND p.key IN (
    'user.read', 'user.write',
    'role.read',
    'person.read', 'person.write', 'person.archive', 'cnpj.lookup',
    'company.read', 'unit.read', 'unit.write',
    'member.read', 'member.write',
    'session.read.own', 'session.revoke.own', 'mfa.enroll'
  )
ON CONFLICT DO NOTHING;

-- recepcao: operação de atendimento básico
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'recepcao'
  AND p.key IN (
    'person.read', 'person.write', 'cnpj.lookup',
    'member.read', 'member.write',
    'session.read.own', 'session.revoke.own', 'mfa.enroll'
  )
ON CONFLICT DO NOTHING;

-- Profissionais (medico/fisio/nutri/personal/enfermeiro): leitura básica +
-- session/mfa. Permissions clínicas chegam nas sprints donas.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r
CROSS JOIN permissions p
WHERE r.key IN ('medico', 'fisio', 'nutri', 'personal', 'enfermeiro')
  AND p.key IN (
    'person.read', 'member.read',
    'session.read.own', 'session.revoke.own', 'mfa.enroll'
  )
ON CONFLICT DO NOTHING;

-- member: só os próprios dados
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'member'
  AND p.key IN ('session.read.own', 'session.revoke.own', 'mfa.enroll')
ON CONFLICT DO NOTHING;
