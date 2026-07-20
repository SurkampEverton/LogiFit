-- 0062 — Vínculo da company com o cadastro dela na Focus NFe (ADR 0105).
--
-- Contexto: no modelo BYO (ADR 0105) a conta Focus é do tenant, e configurar a
-- empresa lá (credenciais do portal municipal, IM, série) é passo do tenant.
-- O painel da Focus nem sempre expõe esses campos, então o LogiFit oferece a
-- tela que empurra a configuração via `PUT /v2/empresas/{id}`.
--
-- **Nenhuma credencial do portal municipal é armazenada aqui.** A senha é
-- repassada à Focus e descartada: ela dá acesso a dados tributários do
-- contribuinte e permite emitir em nome dele — é segredo que a LogiFit escolhe
-- não guardar. Só persistimos o id do cadastro na Focus (para não relistar por
-- CNPJ a cada operação) e quando a configuração foi feita, para a UI conseguir
-- dizer "configurado em <data>" sem saber o conteúdo.
--
-- @volume_estimate_yearly: 0 (colunas em tabela existente; sem crescimento próprio)

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS focus_empresa_id text,
  ADD COLUMN IF NOT EXISTS municipal_credentials_configured_at timestamptz;

COMMENT ON COLUMN companies.focus_empresa_id IS
  'Id do cadastro desta company na conta Focus NFe do tenant (ADR 0105). Resolvido por CNPJ na primeira configuração.';

COMMENT ON COLUMN companies.municipal_credentials_configured_at IS
  'Quando login/senha do portal municipal foram enviados à Focus. As credenciais NAO sao armazenadas — só o carimbo de tempo.';
