#!/usr/bin/env node
// =============================================================================
// Bateria do scripts/hooks/pre-push-guard.sh (R-GIT-1).
//
//   node scripts/hooks/pre-push-guard.test.js [caminho-do-guard]
//
// Entrega ao guard o MESMO JSON que o Claude Code manda no stdin do hook, e
// confere o exit code: 2 = bloqueou, 0 = liberou. Cobre os dois lados — o que
// ele TEM de barrar (commit/push na principal, push mirando main) e o que ele
// NAO pode barrar (worktree em feature branch), porque um guard que bloqueia
// demais e' desligado por quem tropeca nele, e ai nao guarda mais nada.
//
// HERMETICO: cria os repositorios de teste em um diretorio temporario proprio e
// apaga no fim. Nao depende de worktree existente nem de caminho desta maquina.
//
// O guard voltou a ser versionado em 07/10/2026 (tinha saido em 19/08). Se o
// arquivo faltar mesmo assim (checkout antigo), o teste sai com codigo 2 dizendo
// isso, em vez de "passar" sem ter testado nada.
//
// O caso "mensagem CITADA mencionando cd real" existe por um bug real: a
// primeira tentativa de corrigir o falso positivo das aspas (20/08/2026) leu o
// `cd` do comando cru, e com isso um `cd` dentro de `git commit -m "..."`
// passava a valer como comando — liberando commit na main. Se alguem reescrever
// a extracao do `cd`, e esse caso que impede o buraco de voltar.
// =============================================================================
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function raiz() {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('[ERRO] rode de dentro do repositorio.'); process.exit(2); }
  return path.dirname(r.stdout.trim());
}

const PRINCIPAL = raiz();
const GUARD = process.argv[2] || path.join(PRINCIPAL, 'scripts', 'hooks', 'pre-push-guard.sh');

if (!fs.existsSync(GUARD)) {
  console.error(`[ERRO] guard nao encontrado: ${GUARD}`);
  console.error('       Ele e versionado desde 07/10/2026: atualize o checkout (git pull) ou');
  console.error('       passe o caminho do guard como argumento.');
  process.exit(2);
}

// Repositorios de teste: um em feature branch, outro em caminho COM ESPACO.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));
function repo(nome, branch) {
  const dir = path.join(TMP, nome);
  fs.mkdirSync(dir, { recursive: true });
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base');
  git('checkout', '-q', '-b', branch);
  return dir.replace(/\\/g, '/');
}
const FEATURE = repo('feature', 'chore/release-v9.9.9');
const COM_ESPACO = repo('com espaco', 'feat/x');

const casos = [
  ['cd COM aspas + push de tag',                 `cd "${FEATURE}"\ngit push origin v9.9.9`,              'LIBERA'],
  ['cd SEM aspas + push de tag',                 `cd ${FEATURE}\ngit push origin v9.9.9`,                'LIBERA'],
  ['cd com aspas simples + push de tag',         `cd '${FEATURE}'\ngit push origin v9.9.9`,              'LIBERA'],
  ['cd com ESPACO no caminho + push de tag',     `cd "${COM_ESPACO}"\ngit push origin v9.9.9`,           'LIBERA'],
  ['cd + push de feature branch',                `cd "${FEATURE}"\ngit push -u origin chore/release-v9.9.9`, 'LIBERA'],
  ['cd + commit no worktree',                    `cd "${FEATURE}"\ngit commit -F msg.txt`,               'LIBERA'],
  ['comando sem push/commit',                    `cd "${FEATURE}"\ngit status`,                          'LIBERA'],
  ['push mirando main, de dentro do worktree',   `cd "${FEATURE}"\ngit push origin main`,                'BLOQUEIA'],
  ['push HEAD:main de dentro do worktree',       `cd "${FEATURE}"\ngit push origin HEAD:main`,           'BLOQUEIA'],
  ['push de tag ESTANDO na principal',           `git push origin v9.9.9`,                               'BLOQUEIA'],
  ['commit ESTANDO na principal',                `git commit -m "x"`,                                    'BLOQUEIA'],
  ['cd para a principal + commit',               `cd "${PRINCIPAL}"\ngit commit -F msg.txt`,             'BLOQUEIA'],
  ['cd para a principal + push',                 `cd "${PRINCIPAL}"\ngit push origin v9.9.9`,            'BLOQUEIA'],
  ['mensagem CITADA mencionando cd real',        `git commit -m "veja cd ${FEATURE} e depois push"`,     'BLOQUEIA'],
];

let falhas = 0;
for (const [desc, cmd, esperado] of casos) {
  const payload = JSON.stringify({ cwd: PRINCIPAL, tool_input: { command: cmd }, command: cmd });
  const r = spawnSync('bash', [GUARD], { input: payload, encoding: 'utf8' });
  const obtido = r.status === 2 ? 'BLOQUEIA' : 'LIBERA';
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} [${esperado.padEnd(8)}] ${desc}${ok ? '' : `  -> obtido ${obtido}`}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
