#!/usr/bin/env node
// =============================================================================
// Bateria do scripts/hooks/revisao-guard.sh (+ .mjs) e revisao-marca.mjs.
//
//   node scripts/hooks/revisao-guard.test.js
//
// Entrega aos hooks o MESMO JSON que o Claude Code manda no stdin e confere:
// exit 2 = bloqueou, 0 = liberou. Cobre o que o guard TEM de barrar (PR sem
// revisao, marca velha/alheia, escape escrito no texto) e o que NAO pode
// barrar (heredoc, echo, comentario, --help, release, escape explicito) —
// guard que bloqueia demais e' desligado por quem tropeca nele. Os casos de
// heredoc/echo/comentario/--help/espaco duplo/gh.exe/escape no --body/marca
// velha vieram da revisao adversarial de 07/10/2026.
//
// HERMETICO: repositorios e diretorio de marcas em diretorio temporario
// proprio (REVISAO_DIR), apagados no fim. Nao toca a pasta do Claude.
// =============================================================================
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GUARD = path.join(__dirname, 'revisao-guard.sh');
const MARCA = path.join(__dirname, 'revisao-marca.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'revisao-test-'));
const REVISAO_DIR = path.join(TMP, 'marcas');
const env = { ...process.env, REVISAO_DIR };

const git = (dir, ...a) => spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
function repo(nome, branch) {
  const dir = path.join(TMP, nome);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'commit', '-q', '--allow-empty', '-m', `base-${nome}`);
  git(dir, 'checkout', '-q', '-b', branch);
  return dir.replace(/\\/g, '/');
}
const FEAT = repo('feat', 'feat/caixa/fechamento');
const RELEASE = repo('release', 'chore/release/v9.9.9');
const OUTRA = repo('outra', 'fix/fiscal/nfe');
const REUSO = repo('reuso', 'feat/reuso');
const COLIDE = repo('colide', 'feat/caixa/x');
const head = (dir) => git(dir, 'rev-parse', 'HEAD').stdout.trim();

function guard(cmd, cwd = FEAT, ferramenta = 'Bash') {
  const payload = JSON.stringify({ cwd, tool_name: ferramenta, tool_input: { command: cmd } });
  const r = spawnSync('bash', [GUARD], { input: payload, encoding: 'utf8', env });
  return r.status === 2 ? 'BLOQUEIA' : 'LIBERA';
}
function revisorTermina({ cwd = FEAT, agente = 'revisor-adversarial', fala, transcript } = {}) {
  const payload = { cwd, session_id: 's-teste', agent_type: agente, hook_event_name: 'SubagentStop' };
  if (fala !== undefined) payload.last_assistant_message = fala;
  if (transcript) payload.agent_transcript_path = transcript;
  spawnSync('node', [MARCA], { input: JSON.stringify(payload), encoding: 'utf8', env });
}
const marcaManual = (slug, txt) => {
  fs.mkdirSync(REVISAO_DIR, { recursive: true });
  fs.writeFileSync(path.join(REVISAO_DIR, slug), txt);
};

const PR = 'gh pr create --base main --title "x" --body "y"';
const casos = [
  // --- tem de BLOQUEAR -------------------------------------------------------
  ['PR sem revisao (cd no comando)',           () => guard(`cd "${FEAT}" && ${PR}`, TMP),                   'BLOQUEIA'],
  ['PR sem revisao (cwd do hook)',             () => guard(PR),                                              'BLOQUEIA'],
  ['PowerShell: Set-Location; gh pr create',   () => guard(`Set-Location "${FEAT}"; ${PR}`, TMP, 'PowerShell'), 'BLOQUEIA'],
  ['--head de branch sem revisao',             () => guard(`${PR} --head fix/fiscal/nfe`, RELEASE),          'BLOQUEIA'],
  ['espaco duplo: gh  pr  create',             () => guard('gh  pr  create --title x'),                      'BLOQUEIA'],
  ['gh.exe pr create',                         () => guard('gh.exe pr create --title x'),                    'BLOQUEIA'],
  ['escape escrito DENTRO do --body',          () => guard('gh pr create --title t --body "use ERP_SEM_REVISAO=1"'), 'BLOQUEIA'],
  ['revisor interrompido (sem REVISADO:)',     () => (revisorTermina({ fala: 'achei 2 problemas, parei no meio' }), guard(PR)), 'BLOQUEIA'],
  ['outro agente com a linha NAO grava',       () => (revisorTermina({ agente: 'Explore', fala: `REVISADO: feat/caixa/fechamento ${head(FEAT)}` }), guard(PR)), 'BLOQUEIA'],
  // --- NAO pode bloquear -----------------------------------------------------
  ['release sem revisao',                      () => guard(PR, RELEASE),                                     'LIBERA'],
  ['escape ERP_SEM_REVISAO=1 (prefixo)',       () => guard(`ERP_SEM_REVISAO=1 ${PR}`),                       'LIBERA'],
  ['escape no PowerShell ($env:)',             () => guard(`$env:ERP_SEM_REVISAO=1; ${PR}`, FEAT, 'PowerShell'), 'LIBERA'],
  ["heredoc <<'EOF' gravando handoff",         () => guard("cat > handoff.md <<'EOF'\nproximos passos:\ngh pr create --base main\nEOF"), 'LIBERA'],
  ['heredoc <<EOF anexando no arquivo',        () => guard('cat >> notas.md <<EOF\ngh pr create depois\nEOF\ngit status'), 'LIBERA'],
  ['echo gh pr create',                        () => guard('echo gh pr create'),                             'LIBERA'],
  ['comentario: git status # gh pr create',    () => guard('git status # depois gh pr create'),              'LIBERA'],
  ['gh pr create --help',                      () => guard('gh pr create --help'),                           'LIBERA'],
  ['gh pr create so CITADO no commit',         () => guard('git commit -m "depois rode gh pr create"'),      'LIBERA'],
  ['gh pr list / view',                        () => guard('gh pr list && gh pr view 12'),                   'LIBERA'],
  ['comando sem gh',                           () => guard('go test ./...'),                                 'LIBERA'],
  // --- marca -----------------------------------------------------------------
  ['revisor termina com REVISADO -> liberada', () => (revisorTermina({ fala: `sem achados\n\nREVISADO: feat/caixa/fechamento ${head(FEAT)}` }), guard(`cd "${FEAT}" && ${PR}`, TMP)), 'LIBERA'],
  ['commit de correcao depois da revisao',     () => (git(FEAT, 'commit', '-q', '--allow-empty', '-m', 'corrige achado'), guard(PR)), 'LIBERA'],
  ['marca de UMA branch nao libera OUTRA',     () => guard(PR, OUTRA),                                       'BLOQUEIA'],
  ['marca vai p/ branch da linha, nao do cwd', () => (revisorTermina({ cwd: RELEASE, fala: `REVISADO: fix/fiscal/nfe ${head(OUTRA)}` }), guard(PR, OUTRA)), 'LIBERA'],
  ['nome reaproveitado: sha de outro historico', () => (marcaManual('feat__reuso', `branch: feat/reuso\nsha: ${head(FEAT)}\n`), guard(PR, REUSO)), 'BLOQUEIA'],
  ['colisao de slug (feat/caixa__x x feat/caixa/x)', () => (marcaManual('feat__caixa__x', `branch: feat/caixa__x\nsha: ${head(COLIDE)}\n`), guard(PR, COLIDE)), 'BLOQUEIA'],
  // --- reverificacao (N1-N3): o comando real nao e' a 1a palavra limpa -------
  ['continuacao \\ + LF: git push && \\<LF>gh pr create', () => guard('git push -u origin HEAD && \\\n  gh pr create --title x', COLIDE), 'BLOQUEIA'],
  ['continuacao dentro do comando: gh pr \\<LF>create', () => guard('gh pr \\\ncreate --title x', COLIDE), 'BLOQUEIA'],
  ['PowerShell: crase + CRLF no meio', () => guard('gh pr `\r\ncreate --title x', COLIDE, 'PowerShell'), 'BLOQUEIA'],
  ['url=$(gh pr create ...)', () => guard('url=$(gh pr create --title x)', COLIDE), 'BLOQUEIA'],
  ['PowerShell: $url = gh pr create', () => guard('$url = gh pr create --title x', COLIDE, 'PowerShell'), 'BLOQUEIA'],
  ['if ...; then gh pr create; fi', () => guard('if true; then gh pr create --title x; fi', COLIDE), 'BLOQUEIA'],
  ['(gh pr create) e time gh pr create', () => (guard('(gh pr create --title x)', COLIDE) === 'BLOQUEIA' && guard('time gh pr create', COLIDE) === 'BLOQUEIA' ? 'BLOQUEIA' : 'LIBERA'), 'BLOQUEIA'],
  ['--body "-h" e texto, nao ajuda', () => guard('gh pr create --title x --body "-h"', COLIDE), 'BLOQUEIA'],
  ["ANSI-C $'it\\'s' antes do gh", () => guard("echo $'it\\'s' && gh pr create --title x", COLIDE), 'BLOQUEIA'],
  ['aspas duplas com \\ no Windows: cd "C:\\...\\feat" (marca valida)', () => guard(`cd "${FEAT.replace(/\//g, '\\')}" && ${PR}`, COLIDE), 'LIBERA'],
  ['"C:\\Program Files\\GitHub CLI\\gh.exe" pr create', () => guard('"C:\\Program Files\\GitHub CLI\\gh.exe" pr create --title x', COLIDE), 'BLOQUEIA'],
  ['marca com ..\\..\\ NAO grava fora da pasta', () => {
    revisorTermina({ fala: `REVISADO: ..\\..\\fora ${head(FEAT)}` });
    revisorTermina({ fala: `REVISADO: ../../fora ${head(FEAT)}` });
    return fs.existsSync(path.join(TMP, 'fora')) || fs.existsSync(path.join(path.dirname(TMP), 'fora')) ? 'GRAVOU FORA' : 'BLOQUEIA';
  }, 'BLOQUEIA'],
];

let falhas = 0;
for (const [desc, rodar, esperado] of casos) {
  const obtido = rodar();
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} [${esperado.padEnd(8)}] ${desc}${ok ? '' : `  -> obtido ${obtido}`}`);
}

// Fallback: sem last_assistant_message, a linha vem da transcricao do agente.
const TRANSCRICAO = path.join(TMP, 'agente.jsonl');
fs.writeFileSync(TRANSCRICAO, [
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'lendo o diff' }] } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `sem achados\nREVISADO: feat/reuso ${head(REUSO)}` }] } }),
].join('\n'));
revisorTermina({ cwd: REUSO, transcript: TRANSCRICAO });
const viaTranscricao = guard(PR, REUSO) === 'LIBERA';
if (!viaTranscricao) falhas++;
console.log(`${viaTranscricao ? 'OK   ' : 'FALHA'} [LIBERA  ] linha REVISADO lida da transcricao do agente`);

// Handback: o relatorio sai num tool_use SubagentHandback (input.message), sem
// bloco text, e o hook recebe last_assistant_message vazio. Formato copiado de
// transcricao real do revisor (PR #1696/#1711, 07-08/10/2026).
const HANDBACK = repo('handback', 'fix/hooks/handback');
const TRANSCRICAO_HB = path.join(TMP, 'handback.jsonl');
fs.writeFileSync(TRANSCRICAO_HB, [
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'lendo o diff' }] } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: '[handback-send-enforce] Call SubagentHandback({message: <your full report>}) now' } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'SubagentHandback',
    input: { message: `APROVADO\n\nREVISADO: fix/hooks/handback ${head(HANDBACK)}` } }] } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 't1', type: 'tool_result', content: [{ type: 'text', text: '{"success":true}' }] }] } }),
].join('\r\n'));
const semMarcaAntes = guard(PR, HANDBACK) === 'BLOQUEIA';
revisorTermina({ cwd: HANDBACK, fala: '', transcript: TRANSCRICAO_HB });
const viaHandback = semMarcaAntes && guard(PR, HANDBACK) === 'LIBERA';
if (!viaHandback) falhas++;
console.log(`${viaHandback ? 'OK   ' : 'FALHA'} [LIBERA  ] linha REVISADO lida do handback (tool_use) na transcricao`);

// So o SubagentHandback conta: revisor interrompido logo apos um Bash cujo
// comando traz a linha REVISADO nao gera marca (revisao adversarial, 08/10).
const BASH_TU = repo('bash-tu', 'fix/hooks/bash-tu');
const TRANSCRICAO_BASH = path.join(TMP, 'bash.jsonl');
fs.writeFileSync(TRANSCRICAO_BASH, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash',
  input: { command: `printf 'x\nREVISADO: fix/hooks/bash-tu ${head(BASH_TU)}\n' | node revisao-marca.mjs` } }] } }));
revisorTermina({ cwd: BASH_TU, fala: '', transcript: TRANSCRICAO_BASH });
const bashNaoMarca = guard(PR, BASH_TU) === 'BLOQUEIA';
if (!bashNaoMarca) falhas++;
console.log(`${bashNaoMarca ? 'OK   ' : 'FALHA'} [BLOQUEIA] REVISADO dentro de tool_use Bash nao gera marca`);

const conteudo = fs.readFileSync(path.join(REVISAO_DIR, 'feat__caixa__fechamento'), 'utf8');
const marcaOk = /^branch: feat\/caixa\/fechamento$/m.test(conteudo) && /^sha: [0-9a-f]{40}$/m.test(conteudo);
if (!marcaOk) falhas++;
console.log(`${marcaOk ? 'OK   ' : 'FALHA'} [CONTEUDO] marca grava branch e SHA de 40 hex`);

fs.rmSync(TMP, { recursive: true, force: true });
const total = casos.length + 4;
console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
